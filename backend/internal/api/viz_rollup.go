package api

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var vizRollupGranularitySecs = []int{1, 10, 60, 300, 3600}

type vizRollupDoc struct {
	BucketStart time.Time              `bson:"bucket_start"`
	Count       int64                  `bson:"count"`
	MinFields   map[string]interface{} `bson:"min_fields"`
	MaxFields   map[string]interface{} `bson:"max_fields"`
	SumFields   map[string]interface{} `bson:"sum_fields"`
}

func encodeRollupFieldKey(field string) string {
	replacer := strings.NewReplacer(".", "\uFF0E", "$", "\uFF04")
	return replacer.Replace(field)
}

func rollupBucketStart(ts time.Time, granularitySec int) time.Time {
	if granularitySec <= 0 {
		return ts.UTC()
	}
	unix := ts.UTC().Unix()
	bucket := (unix / int64(granularitySec)) * int64(granularitySec)
	return time.Unix(bucket, 0).UTC()
}

func extractNumericParsedFields(parsed map[string]interface{}) map[string]float64 {
	if len(parsed) == 0 {
		return nil
	}
	out := make(map[string]float64)
	for key, raw := range parsed {
		if v, ok := extractVizValue(raw); ok {
			out[key] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

type vizRollupBucketKey struct {
	boardID        string
	granularitySec int
	bucketUnix     int64
}

// vizRollupBucket is the in-memory aggregate for one (granularity, bucket)
// before it is written back with a single upsert.
type vizRollupBucket struct {
	BoardID        string
	GranularitySec int
	BucketStart    time.Time
	Count          int64
	MinFields      map[string]float64
	MaxFields      map[string]float64
	SumFields      map[string]float64
	LastTS         time.Time
}

// aggregateVizRollupBuckets folds samples into bucket aggregates so ingest can
// issue one upsert per bucket instead of one per sample per granularity.
func aggregateVizRollupBuckets(samples []models.UartData) []vizRollupBucket {
	buckets := make(map[vizRollupBucketKey]*vizRollupBucket)
	for _, sample := range samples {
		if sample.BoardID == "" || sample.Timestamp.IsZero() {
			continue
		}
		numeric := extractNumericParsedFields(sample.ParsedFields)
		if len(numeric) == 0 {
			continue
		}

		for _, granularitySec := range vizRollupGranularitySecs {
			bucketStart := rollupBucketStart(sample.Timestamp, granularitySec)
			key := vizRollupBucketKey{
				boardID:        sample.BoardID,
				granularitySec: granularitySec,
				bucketUnix:     bucketStart.Unix(),
			}
			bucket, ok := buckets[key]
			if !ok {
				bucket = &vizRollupBucket{
					BoardID:        sample.BoardID,
					GranularitySec: granularitySec,
					BucketStart:    bucketStart,
					MinFields:      make(map[string]float64, len(numeric)),
					MaxFields:      make(map[string]float64, len(numeric)),
					SumFields:      make(map[string]float64, len(numeric)),
				}
				buckets[key] = bucket
			}

			bucket.Count += 1
			if sample.Timestamp.After(bucket.LastTS) {
				bucket.LastTS = sample.Timestamp
			}
			for fieldName, value := range numeric {
				if current, exists := bucket.MinFields[fieldName]; !exists || value < current {
					bucket.MinFields[fieldName] = value
				}
				if current, exists := bucket.MaxFields[fieldName]; !exists || value > current {
					bucket.MaxFields[fieldName] = value
				}
				bucket.SumFields[fieldName] += value
			}
		}
	}

	out := make([]vizRollupBucket, 0, len(buckets))
	for _, bucket := range buckets {
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

const vizRollupBulkChunk = 1000

func (h *Handler) upsertVizRollups(ctx context.Context, samples []models.UartData) error {
	buckets := aggregateVizRollupBuckets(samples)
	if len(buckets) == 0 {
		return nil
	}

	now := time.Now().UTC()
	writes := make([]mongo.WriteModel, 0, len(buckets))
	for _, bucket := range buckets {
		filter := bson.M{
			"board_id":        bucket.BoardID,
			"granularity_sec": bucket.GranularitySec,
			"bucket_start":    bucket.BucketStart,
		}

		setFields := bson.M{
			"board_id":        bucket.BoardID,
			"granularity_sec": bucket.GranularitySec,
			"bucket_start":    bucket.BucketStart,
			"updated_at":      now,
		}
		incFields := bson.M{"count": bucket.Count}
		minFields := bson.M{}
		maxFields := bson.M{"last_ts": bucket.LastTS}

		for fieldName, value := range bucket.MinFields {
			encodedField := encodeRollupFieldKey(fieldName)
			minFields["min_fields."+encodedField] = value
			maxFields["max_fields."+encodedField] = bucket.MaxFields[fieldName]
			incFields["sum_fields."+encodedField] = bucket.SumFields[fieldName]
		}

		update := bson.M{
			"$set": setFields,
			"$setOnInsert": bson.M{
				"created_at": now,
			},
			"$inc": incFields,
			"$min": minFields,
			"$max": maxFields,
		}
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(filter).
			SetUpdate(update).
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

// estimateVizRowCount sums precomputed rollup counts for the range instead of
// scanning raw documents. It falls back to an exact count only when no rollup
// exists (legacy data or an empty board).
func (h *Handler) estimateVizRowCount(ctx context.Context, filter bson.M) (int64, bool, error) {
	boardID, ok := filter["board_id"].(string)
	if !ok || boardID == "" {
		return 0, false, nil
	}
	start, hasStart, end, hasEnd := getVizFilterBounds(filter)
	for i := len(vizRollupGranularitySecs) - 1; i >= 0; i -= 1 {
		granularitySec := vizRollupGranularitySecs[i]
		rollupFilter := bson.M{
			"board_id":        boardID,
			"granularity_sec": granularitySec,
		}
		if hasStart || hasEnd {
			rangeFilter := bson.M{}
			if hasStart {
				rangeFilter["$gte"] = rollupBucketStart(start, granularitySec)
			}
			if hasEnd {
				rangeFilter["$lte"] = rollupBucketStart(end, granularitySec)
			}
			rollupFilter["bucket_start"] = rangeFilter
		}

		cur, err := h.db.VizRollups().Find(
			ctx,
			rollupFilter,
			options.Find().SetProjection(bson.M{"count": 1}),
		)
		if err != nil {
			return 0, false, err
		}
		var total int64
		found := false
		for cur.Next(ctx) {
			var row struct {
				Count int64 `bson:"count"`
			}
			if err := cur.Decode(&row); err != nil {
				continue
			}
			total += row.Count
			found = true
		}
		curErr := cur.Err()
		cur.Close(ctx)
		if curErr != nil {
			return 0, false, curErr
		}
		if found {
			return total, true, nil
		}
	}
	return 0, false, nil
}

func (h *Handler) vizCountForFilter(ctx context.Context, filter bson.M) (int64, error) {
	if total, ok, err := h.estimateVizRowCount(ctx, filter); err != nil {
		return 0, err
	} else if ok {
		return total, nil
	}
	return h.db.UartData().CountDocuments(ctx, filter)
}

func getVizFilterBounds(filter bson.M) (start time.Time, hasStart bool, end time.Time, hasEnd bool) {
	tsFilterRaw, ok := filter["timestamp"]
	if !ok {
		return time.Time{}, false, time.Time{}, false
	}
	tsFilter, ok := tsFilterRaw.(bson.M)
	if !ok {
		return time.Time{}, false, time.Time{}, false
	}
	if raw, ok := tsFilter["$gte"]; ok {
		if t, ok := raw.(time.Time); ok {
			start, hasStart = t, true
		}
	}
	if !hasStart {
		if raw, ok := tsFilter["$gt"]; ok {
			if t, ok := raw.(time.Time); ok {
				start, hasStart = t, true
			}
		}
	}
	if raw, ok := tsFilter["$lte"]; ok {
		if t, ok := raw.(time.Time); ok {
			end, hasEnd = t, true
		}
	}
	if !hasEnd {
		if raw, ok := tsFilter["$lt"]; ok {
			if t, ok := raw.(time.Time); ok {
				end, hasEnd = t, true
			}
		}
	}
	return start, hasStart, end, hasEnd
}

func chooseVizRollupGranularity(total int64, limit int, start time.Time, hasStart bool, end time.Time, hasEnd bool) (int, bool) {
	if total <= int64(limit*2) {
		return 0, false
	}

	if !hasStart || !hasEnd {
		// All-range queries have no bounds, and a sparse board can cover
		// months. Use at least 60s so the overview reads a bounded number of
		// rollup documents; zooming in still loads finer detail.
		switch {
		case total <= 200000:
			return 60, true
		case total <= 2000000:
			return 300, true
		default:
			return 3600, true
		}
	}

	rangeSec := end.Sub(start).Seconds()
	if rangeSec <= 0 {
		return 1, true
	}
	targetBuckets := int(math.Max(1, float64(limit/3)))

	for _, granularitySec := range vizRollupGranularitySecs {
		bucketEstimate := rangeSec / float64(granularitySec)
		if bucketEstimate <= float64(targetBuckets) {
			return granularitySec, true
		}
	}
	// Even the coarsest rollup exceeds the target; use it anyway so very long
	// ranges do not fall back to a finer granularity with more buckets.
	return vizRollupGranularitySecs[len(vizRollupGranularitySecs)-1], true
}

func readRollupFieldValue(fields map[string]interface{}, fieldName string) (float64, bool) {
	if len(fields) == 0 {
		return 0, false
	}
	for _, candidate := range fieldNameCandidates(fieldName) {
		raw, ok := fields[encodeRollupFieldKey(candidate)]
		if !ok {
			continue
		}
		return extractVizValue(raw)
	}
	return 0, false
}

func appendRollupPoint(dst []vizDataPoint, timestamp time.Time, values map[string]interface{}) []vizDataPoint {
	if len(values) == 0 {
		return dst
	}
	return append(dst, vizDataPoint{Timestamp: timestamp, Values: values})
}

func trimVizPoints(points []vizDataPoint, limit int) []vizDataPoint {
	if limit <= 0 || len(points) <= limit {
		return points
	}
	if limit == 1 {
		return points[:1]
	}
	trimmed := make([]vizDataPoint, 0, limit)
	step := float64(len(points)-1) / float64(limit-1)
	lastIdx := -1
	for i := 0; i < limit; i++ {
		idx := int(math.Round(float64(i) * step))
		if idx < 0 {
			idx = 0
		}
		if idx >= len(points) {
			idx = len(points) - 1
		}
		if idx == lastIdx {
			continue
		}
		trimmed = append(trimmed, points[idx])
		lastIdx = idx
	}
	if len(trimmed) == 0 {
		return points[:limit]
	}
	if trimmed[len(trimmed)-1].Timestamp != points[len(points)-1].Timestamp {
		trimmed = append(trimmed, points[len(points)-1])
	}
	if len(trimmed) > limit {
		trimmed = trimmed[:limit]
	}
	return trimmed
}

// nextFinerVizRollupGranularity returns the next available finer resolution.
// Older boards may only have 1s/10s/60s rollups, so a request that prefers 1h
// must fall back instead of falling through to a raw scan.
func nextFinerVizRollupGranularity(granularitySec int) int {
	for i, g := range vizRollupGranularitySecs {
		if g == granularitySec && i > 0 {
			return vizRollupGranularitySecs[i-1]
		}
	}
	return 0
}

func (h *Handler) queryVizSeriesFromRollups(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	effectiveLimit int,
	total int64,
) ([]vizDataPoint, bool, error) {
	boardID, ok := filter["board_id"].(string)
	if !ok || boardID == "" {
		return nil, false, nil
	}

	start, hasStart, end, hasEnd := getVizFilterBounds(filter)
	preferredGranularity, useRollup := chooseVizRollupGranularity(total, effectiveLimit, start, hasStart, end, hasEnd)
	if !useRollup {
		return nil, false, nil
	}

	buildRollupFilter := func(granularitySec int) bson.M {
		rollupFilter := bson.M{
			"board_id":        boardID,
			"granularity_sec": granularitySec,
		}
		if hasStart || hasEnd {
			rangeFilter := bson.M{}
			if hasStart {
				rangeFilter["$gte"] = rollupBucketStart(start, granularitySec)
			}
			if hasEnd {
				rangeFilter["$lte"] = rollupBucketStart(end, granularitySec)
			}
			rollupFilter["bucket_start"] = rangeFilter
		}
		return rollupFilter
	}

	// Prefer the computed resolution, but fall back to finer rollups when the
	// board predates 5m/1h rollups. Without this, long ranges would miss the
	// rollup collection entirely and fall back to scanning raw documents.
	granularitySec := preferredGranularity
	rollupFilter := buildRollupFilter(granularitySec)
	var rollupCount int64
	for granularitySec > 0 {
		n, err := h.db.VizRollups().CountDocuments(ctx, rollupFilter)
		if err != nil {
			return nil, false, err
		}
		if n > 0 {
			rollupCount = n
			break
		}
		granularitySec = nextFinerVizRollupGranularity(granularitySec)
		if granularitySec > 0 {
			rollupFilter = buildRollupFilter(granularitySec)
		}
	}
	if rollupCount == 0 {
		return nil, false, nil
	}
	if granularitySec < preferredGranularity {
		// Legacy board: build 5m/1h rollups in the background so the next
		// long-range request can use them instead of 60s documents.
		h.ensureVizRollupBackfill(ctx, boardID)
	}

	findOpts := options.Find().
		SetSort(bson.D{{Key: "bucket_start", Value: 1}}).
		SetProjection(bson.M{
			"bucket_start": 1,
			"count":        1,
			"sum_fields":   1,
		})

	cursor, err := h.db.VizRollups().Find(ctx, rollupFilter, findOpts)
	if err != nil {
		return nil, false, err
	}
	defer cursor.Close(ctx)

	// Each rollup group produces one averaged point. If there are more buckets
	// than the chart can usefully display, merge adjacent buckets before
	// expanding them. This keeps response construction independent of the raw
	// data volume for long ranges.
	targetBuckets := effectiveLimit
	if targetBuckets < 1 {
		targetBuckets = 1
	}
	mergeFactor := int((rollupCount + int64(targetBuckets) - 1) / int64(targetBuckets))
	if mergeFactor < 1 {
		mergeFactor = 1
	}

	bucketSpan := time.Duration(granularitySec) * time.Second
	points := make([]vizDataPoint, 0, effectiveLimit)
	var groupStart, groupLast time.Time
	var groupCount int64
	groupSum := make(map[string]float64)
	grouped := 0

	flushGroup := func() {
		if groupCount <= 0 {
			return
		}
		avgValues := make(map[string]interface{}, len(groupSum))
		for label, value := range groupSum {
			avgValues[label] = value / float64(groupCount)
		}
		span := groupLast.Sub(groupStart) + bucketSpan
		mid := groupStart.Add(span / 2)
		points = appendRollupPoint(points, mid, avgValues)
		groupStart = time.Time{}
		groupCount = 0
		groupSum = make(map[string]float64)
		grouped = 0
	}

	for cursor.Next(ctx) {
		var doc vizRollupDoc
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		if doc.Count <= 0 {
			continue
		}
		if groupCount == 0 {
			groupStart = doc.BucketStart
		}
		groupLast = doc.BucketStart
		groupCount += doc.Count

		for _, item := range items {
			fieldName := item.FieldRef.FieldName
			if fieldName == "" {
				continue
			}
			if sumV, ok := readRollupFieldValue(doc.SumFields, fieldName); ok {
				groupSum[item.Label] += sumV
			}
		}

		grouped++
		if grouped >= mergeFactor {
			flushGroup()
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, false, err
	}
	flushGroup()

	if len(points) == 0 {
		return nil, false, nil
	}

	sort.Slice(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	points = trimVizPoints(points, effectiveLimit)
	return points, true, nil
}
