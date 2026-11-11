package api

import (
	"context"
	"math"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

const uartPresenceBucketSec = 60

type uartPresenceBucketKey struct {
	boardID    string
	bucketUnix int64
}

type uartPresenceBucket struct {
	Start time.Time
	Count int64
}

func uartPresenceBucketStart(ts time.Time) time.Time {
	if ts.IsZero() {
		return time.Time{}
	}
	unix := ts.UTC().Unix()
	bucket := (unix / int64(uartPresenceBucketSec)) * int64(uartPresenceBucketSec)
	return time.Unix(bucket, 0).UTC()
}

// aggregateUartPresenceBuckets counts rows per board and minute. Every row is
// counted, including frames without parsed numeric fields, because presence is
// about stored data rather than chartable values.
func aggregateUartPresenceBuckets(samples []models.UartData) map[uartPresenceBucketKey]int64 {
	counts := make(map[uartPresenceBucketKey]int64)
	for _, sample := range samples {
		if sample.BoardID == "" || sample.Timestamp.IsZero() {
			continue
		}
		bucket := uartPresenceBucketStart(sample.Timestamp)
		counts[uartPresenceBucketKey{
			boardID:    sample.BoardID,
			bucketUnix: bucket.Unix(),
		}] += 1
	}
	return counts
}

func (h *Handler) upsertUartPresence(ctx context.Context, samples []models.UartData) error {
	counts := aggregateUartPresenceBuckets(samples)
	if len(counts) == 0 {
		return nil
	}

	now := time.Now().UTC()
	writes := make([]mongo.WriteModel, 0, len(counts))
	for key, count := range counts {
		bucketStart := time.Unix(key.bucketUnix, 0).UTC()
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.M{
				"board_id":     key.boardID,
				"bucket_start": bucketStart,
			}).
			SetUpdate(bson.M{
				"$set": bson.M{
					"board_id":     key.boardID,
					"bucket_start": bucketStart,
				},
				"$inc": bson.M{"count": count},
				"$setOnInsert": bson.M{
					"created_at": now,
				},
			}).
			SetUpsert(true))
	}

	for start := 0; start < len(writes); start += vizRollupBulkChunk {
		end := start + vizRollupBulkChunk
		if end > len(writes) {
			end = len(writes)
		}
		if _, err := h.db.UartPresence().BulkWrite(
			ctx,
			writes[start:end],
			options.BulkWrite().SetOrdered(false),
		); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) loadUartPresenceBuckets(
	ctx context.Context,
	boardID string,
	start time.Time,
	end time.Time,
) ([]uartPresenceBucket, error) {
	filter := bson.M{
		"board_id": boardID,
		"bucket_start": bson.M{
			"$gte": uartPresenceBucketStart(start),
			"$lte": end,
		},
	}
	cur, err := h.db.UartPresence().Find(ctx, filter,
		options.Find().
			SetSort(bson.D{{Key: "bucket_start", Value: 1}}).
			SetProjection(bson.M{"bucket_start": 1, "count": 1}),
	)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	out := make([]uartPresenceBucket, 0, 256)
	for cur.Next(ctx) {
		var row struct {
			BucketStart time.Time `bson:"bucket_start"`
			Count       int64     `bson:"count"`
		}
		if err := cur.Decode(&row); err != nil {
			continue
		}
		if row.Count <= 0 {
			continue
		}
		out = append(out, uartPresenceBucket{Start: row.BucketStart, Count: row.Count})
	}
	if err := cur.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// uartPresenceBucketsToBins spreads minute buckets across the requested bins.
// Counts are apportioned by overlap so density stays meaningful when a bucket
// spans several narrow bins.
func uartPresenceBucketsToBins(
	start time.Time,
	end time.Time,
	bins int,
	buckets []uartPresenceBucket,
) ([]bool, []int64) {
	present := make([]bool, max(bins, 0))
	counts := make([]int64, max(bins, 0))
	if bins <= 0 || !end.After(start) || len(buckets) == 0 {
		return present, counts
	}

	startMs := start.UnixMilli()
	spanMs := end.UnixMilli() - startMs
	if spanMs <= 0 {
		return present, counts
	}
	const bucketMs = int64(uartPresenceBucketSec) * 1000

	pointer := 0
	for i := 0; i < bins; i += 1 {
		binStart := startMs + spanMs*int64(i)/int64(bins)
		binEnd := startMs + spanMs*int64(i+1)/int64(bins)
		if binEnd <= binStart {
			continue
		}

		for pointer < len(buckets) {
			bucketStart := buckets[pointer].Start.UnixMilli()
			if bucketStart+bucketMs > binStart {
				break
			}
			pointer += 1
		}

		var weighted float64
		covered := false
		for index := pointer; index < len(buckets); index += 1 {
			bucketStart := buckets[index].Start.UnixMilli()
			if bucketStart >= binEnd {
				break
			}
			overlap := min(bucketStart+bucketMs, binEnd) - max(bucketStart, binStart)
			if overlap <= 0 {
				continue
			}
			covered = true
			weighted += float64(buckets[index].Count) * float64(overlap) / float64(bucketMs)
		}
		present[i] = covered
		counts[i] = int64(math.Round(weighted))
	}
	return present, counts
}

// ensureUartPresenceBackfill starts a one-time background rebuild of presence
// for a board. Until it finishes the spectrum endpoint keeps using the raw
// aggregation fallback.
func (h *Handler) ensureUartPresenceBackfill(ctx context.Context, boardID string) {
	if boardID == "" {
		return
	}
	now := time.Now().UTC()
	result := h.db.Boards().FindOneAndUpdate(
		ctx,
		bson.M{
			"_id":                 boardID,
			"presence_backfilled": bson.M{"$ne": true},
			"$or": []bson.M{
				{"presence_backfilling": bson.M{"$ne": true}},
				{"presence_backfill_started_at": bson.M{"$lt": now.Add(-time.Hour)}},
			},
		},
		bson.M{"$set": bson.M{
			"presence_backfilling":         true,
			"presence_backfill_started_at": now,
		}},
	)
	if err := result.Err(); err != nil {
		if err != mongo.ErrNoDocuments {
			h.logger.Warn("failed to claim uart presence backfill", zap.String("board_id", boardID), zap.Error(err))
		}
		return
	}

	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		if err := h.backfillUartPresence(bg, boardID); err != nil {
			h.logger.Warn("uart presence backfill failed", zap.String("board_id", boardID), zap.Error(err))
			h.markUartPresenceBackfill(boardID, false)
			return
		}
		h.markUartPresenceBackfill(boardID, true)
	}()
}

func (h *Handler) markUartPresenceBackfill(boardID string, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	update := bson.M{"$unset": bson.M{"presence_backfilling": ""}}
	if ok {
		update["$set"] = bson.M{
			"presence_backfilled":    true,
			"presence_backfilled_at": time.Now().UTC(),
		}
	}
	if _, err := h.db.Boards().UpdateOne(ctx, bson.M{"_id": boardID}, update); err != nil {
		h.logger.Warn("failed to update uart presence backfill state", zap.String("board_id", boardID), zap.Error(err))
	}
}

func (h *Handler) backfillUartPresence(ctx context.Context, boardID string) error {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"board_id": boardID}}},
		{{Key: "$group", Value: bson.M{
			"_id": bson.M{
				"$floor": bson.M{
					"$divide": bson.A{
						bson.M{"$toLong": "$timestamp"},
						int64(uartPresenceBucketSec) * 1000,
					},
				},
			},
			"count": bson.M{"$sum": 1},
		}}},
	}
	cur, err := h.db.UartData().Aggregate(
		ctx,
		pipeline,
		options.Aggregate().SetAllowDiskUse(true).SetBatchSize(5000),
	)
	if err != nil {
		return err
	}
	defer cur.Close(ctx)

	now := time.Now().UTC()
	writes := make([]mongo.WriteModel, 0, 1024)
	flush := func() error {
		if len(writes) == 0 {
			return nil
		}
		for start := 0; start < len(writes); start += vizRollupBulkChunk {
			end := start + vizRollupBulkChunk
			if end > len(writes) {
				end = len(writes)
			}
			if _, err := h.db.UartPresence().BulkWrite(
				ctx,
				writes[start:end],
				options.BulkWrite().SetOrdered(false),
			); err != nil {
				return err
			}
		}
		writes = writes[:0]
		return nil
	}

	for cur.Next(ctx) {
		var row struct {
			Bucket int64 `bson:"_id"`
			Count  int64 `bson:"count"`
		}
		if err := cur.Decode(&row); err != nil {
			continue
		}
		if row.Count <= 0 {
			continue
		}
		bucketStart := time.Unix(row.Bucket*int64(uartPresenceBucketSec), 0).UTC()
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.M{
				"board_id":     boardID,
				"bucket_start": bucketStart,
			}).
			SetUpdate(bson.M{
				"$set": bson.M{
					"board_id":     boardID,
					"bucket_start": bucketStart,
				},
				"$max": bson.M{"count": row.Count},
				"$setOnInsert": bson.M{
					"created_at": now,
				},
			}).
			SetUpsert(true))

		if len(writes) >= vizRollupBulkChunk {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := cur.Err(); err != nil {
		return err
	}
	return flush()
}
