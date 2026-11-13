package api

import (
	"context"
	"sort"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"
)

// Older boards only have 1s/10s/60s rollups. Building 5m/1h rollups from the
// existing 60s documents is cheap and makes long-range charts fast without
// scanning the raw collection.
var vizRollupBackfillTargets = []int{300, 3600}

type vizRollupSourceDoc struct {
	BucketStart time.Time              `bson:"bucket_start"`
	Count       int64                  `bson:"count"`
	MinFields   map[string]interface{} `bson:"min_fields"`
	MaxFields   map[string]interface{} `bson:"max_fields"`
	SumFields   map[string]interface{} `bson:"sum_fields"`
}

type vizRollupBackfillBucket struct {
	GranularitySec int
	BucketStart    time.Time
	Count          int64
	MinFields      map[string]interface{}
	MaxFields      map[string]interface{}
	SumFields      map[string]interface{}
	LastTS         time.Time
}

type vizRollupBackfillKey struct {
	granularitySec int
	bucketUnix     int64
}

func aggregateVizRollupBackfill(docs []vizRollupSourceDoc) []vizRollupBackfillBucket {
	buckets := make(map[vizRollupBackfillKey]*vizRollupBackfillBucket)
	for _, doc := range docs {
		for _, granularitySec := range vizRollupBackfillTargets {
			bucketStart := rollupBucketStart(doc.BucketStart, granularitySec)
			key := vizRollupBackfillKey{granularitySec: granularitySec, bucketUnix: bucketStart.Unix()}
			bucket, ok := buckets[key]
			if !ok {
				bucket = &vizRollupBackfillBucket{
					GranularitySec: granularitySec,
					BucketStart:    bucketStart,
					MinFields:      make(map[string]interface{}),
					MaxFields:      make(map[string]interface{}),
					SumFields:      make(map[string]interface{}),
				}
				buckets[key] = bucket
			}
			bucket.Count += doc.Count
			docLastTS := doc.BucketStart.Add(time.Minute)
			if raw, ok := doc.MaxFields["last_ts"]; ok {
				if ts, ok := raw.(time.Time); ok {
					docLastTS = ts
				}
			}
			if docLastTS.After(bucket.LastTS) {
				bucket.LastTS = docLastTS
			}

			for field, raw := range doc.MinFields {
				value, ok := extractVizValue(raw)
				if !ok {
					continue
				}
				current, exists := bucket.MinFields[field]
				if !exists {
					bucket.MinFields[field] = value
					continue
				}
				if currentValue, ok := extractVizValue(current); !ok || value < currentValue {
					bucket.MinFields[field] = value
				}
			}
			for field, raw := range doc.MaxFields {
				if field == "last_ts" {
					continue
				}
				value, ok := extractVizValue(raw)
				if !ok {
					continue
				}
				current, exists := bucket.MaxFields[field]
				if !exists {
					bucket.MaxFields[field] = value
					continue
				}
				if currentValue, ok := extractVizValue(current); !ok || value > currentValue {
					bucket.MaxFields[field] = value
				}
			}
			for field, raw := range doc.SumFields {
				value, ok := extractVizValue(raw)
				if !ok {
					continue
				}
				current, exists := bucket.SumFields[field]
				if !exists {
					bucket.SumFields[field] = value
					continue
				}
				if currentValue, ok := extractVizValue(current); ok {
					bucket.SumFields[field] = currentValue + value
				}
			}
		}
	}

	out := make([]vizRollupBackfillBucket, 0, len(buckets))
	for _, bucket := range buckets {
		bucket.MaxFields["last_ts"] = bucket.LastTS
		out = append(out, *bucket)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].GranularitySec != out[j].GranularitySec {
			return out[i].GranularitySec < out[j].GranularitySec
		}
		return out[i].BucketStart.Before(out[j].BucketStart)
	})
	return out
}

func (h *Handler) backfillVizRollups(ctx context.Context, boardID string) error {
	cur, err := h.db.VizRollups().Find(
		ctx,
		bson.M{"board_id": boardID, "granularity_sec": 60},
		options.Find().
			SetSort(bson.D{{Key: "bucket_start", Value: 1}}).
			SetProjection(bson.M{
				"bucket_start": 1,
				"count":        1,
				"min_fields":   1,
				"max_fields":   1,
				"sum_fields":   1,
			}),
	)
	if err != nil {
		return err
	}
	defer cur.Close(ctx)

	docs := make([]vizRollupSourceDoc, 0, 1024)
	for cur.Next(ctx) {
		var doc vizRollupSourceDoc
		if err := cur.Decode(&doc); err != nil {
			continue
		}
		docs = append(docs, doc)
	}
	if err := cur.Err(); err != nil {
		return err
	}
	if len(docs) == 0 {
		return nil
	}

	buckets := aggregateVizRollupBackfill(docs)
	now := time.Now().UTC()
	writes := make([]mongo.WriteModel, 0, len(buckets))
	for _, bucket := range buckets {
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.M{
				"board_id":        boardID,
				"granularity_sec": bucket.GranularitySec,
				"bucket_start":    bucket.BucketStart,
			}).
			SetUpdate(bson.M{
				"$setOnInsert": bson.M{
					"board_id":        boardID,
					"granularity_sec": bucket.GranularitySec,
					"bucket_start":    bucket.BucketStart,
					"count":           bucket.Count,
					"min_fields":      bucket.MinFields,
					"max_fields":      bucket.MaxFields,
					"sum_fields":      bucket.SumFields,
					"created_at":      now,
					"updated_at":      now,
				},
			}).
			SetUpsert(true))
	}

	for start := 0; start < len(writes); start += vizRollupBulkChunk {
		end := start + vizRollupBulkChunk
		if end > len(writes) {
			end = len(writes)
		}
		if _, err := h.db.VizRollups().BulkWrite(
			ctx,
			writes[start:end],
			options.BulkWrite().SetOrdered(false),
		); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) ensureVizRollupBackfill(ctx context.Context, boardID string) {
	if boardID == "" {
		return
	}
	now := time.Now().UTC()
	result := h.db.Boards().FindOneAndUpdate(
		ctx,
		bson.M{
			"_id":                   boardID,
			"viz_rollup_backfilled": bson.M{"$ne": true},
			"$or": []bson.M{
				{"viz_rollup_backfilling": bson.M{"$ne": true}},
				{"viz_rollup_backfill_started_at": bson.M{"$lt": now.Add(-time.Hour)}},
			},
		},
		bson.M{"$set": bson.M{
			"viz_rollup_backfilling":         true,
			"viz_rollup_backfill_started_at": now,
		}},
	)
	if err := result.Err(); err != nil {
		if err != mongo.ErrNoDocuments {
			h.logger.Warn("failed to claim viz rollup backfill", zap.String("board_id", boardID), zap.Error(err))
		}
		return
	}

	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		if err := h.backfillVizRollups(bg, boardID); err != nil {
			h.logger.Warn("viz rollup backfill failed", zap.String("board_id", boardID), zap.Error(err))
			h.markVizRollupBackfill(boardID, false)
			return
		}
		h.markVizRollupBackfill(boardID, true)
		h.logger.Info("viz rollup backfill completed", zap.String("board_id", boardID))
	}()
}

func (h *Handler) markVizRollupBackfill(boardID string, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	update := bson.M{"$unset": bson.M{
		"viz_rollup_backfilling":         "",
		"viz_rollup_backfill_started_at": "",
	}}
	if ok {
		update["$set"] = bson.M{
			"viz_rollup_backfilled":    true,
			"viz_rollup_backfilled_at": time.Now().UTC(),
		}
	}
	if _, err := h.db.Boards().UpdateOne(ctx, bson.M{"_id": boardID}, update); err != nil {
		h.logger.Warn("failed to update viz rollup backfill state", zap.String("board_id", boardID), zap.Error(err))
	}
}
