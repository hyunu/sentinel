package api

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var vizRollupGranularitySecs = []int{1, 10, 60}

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

func (h *Handler) upsertVizRollups(ctx context.Context, samples []models.UartData) error {
	now := time.Now().UTC()
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
			filter := bson.M{
				"board_id":        sample.BoardID,
				"granularity_sec": granularitySec,
				"bucket_start":    bucketStart,
			}

			setFields := bson.M{
				"board_id":        sample.BoardID,
				"granularity_sec": granularitySec,
				"bucket_start":    bucketStart,
				"updated_at":      now,
			}
			incFields := bson.M{"count": 1}
			minFields := bson.M{}
			maxFields := bson.M{"last_ts": sample.Timestamp}

			for fieldName, value := range numeric {
				encodedField := encodeRollupFieldKey(fieldName)
				minFields["min_fields."+encodedField] = value
				maxFields["max_fields."+encodedField] = value
				incFields["sum_fields."+encodedField] = value
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

			if _, err := h.db.VizRollups().UpdateOne(ctx, filter, update, options.Update().SetUpsert(true)); err != nil {
				return err
			}
		}
	}
	return nil
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
		return 60, true
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
	return 60, true
}

func readRollupFieldValue(fields map[string]interface{}, fieldName string) (float64, bool) {
	if len(fields) == 0 {
		return 0, false
	}
	raw, ok := fields[encodeRollupFieldKey(fieldName)]
	if !ok {
		return 0, false
	}
	return extractVizValue(raw)
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
	granularitySec, useRollup := chooseVizRollupGranularity(total, effectiveLimit, start, hasStart, end, hasEnd)
	if !useRollup {
		return nil, false, nil
	}

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

	findOpts := options.Find().
		SetSort(bson.D{{Key: "bucket_start", Value: 1}}).
		SetProjection(bson.M{
			"bucket_start": 1,
			"count":        1,
			"min_fields":   1,
			"max_fields":   1,
			"sum_fields":   1,
		})

	cursor, err := h.db.VizRollups().Find(ctx, rollupFilter, findOpts)
	if err != nil {
		return nil, false, err
	}
	defer cursor.Close(ctx)

	bucketSpan := time.Duration(granularitySec) * time.Second
	points := make([]vizDataPoint, 0, effectiveLimit)
	for cursor.Next(ctx) {
		var doc vizRollupDoc
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		if doc.Count <= 0 {
			continue
		}

		minValues := make(map[string]interface{})
		avgValues := make(map[string]interface{})
		maxValues := make(map[string]interface{})

		for _, item := range items {
			fieldName := item.FieldRef.FieldName
			if fieldName == "" {
				continue
			}
			if minV, ok := readRollupFieldValue(doc.MinFields, fieldName); ok {
				minValues[item.Label] = minV
			}
			if maxV, ok := readRollupFieldValue(doc.MaxFields, fieldName); ok {
				maxValues[item.Label] = maxV
			}
			if sumV, ok := readRollupFieldValue(doc.SumFields, fieldName); ok {
				avgValues[item.Label] = sumV / float64(doc.Count)
			}
		}

		points = appendRollupPoint(points, doc.BucketStart, minValues)
		points = appendRollupPoint(points, doc.BucketStart.Add(bucketSpan/2), avgValues)
		points = appendRollupPoint(points, doc.BucketStart.Add(bucketSpan-time.Millisecond), maxValues)
	}
	if err := cursor.Err(); err != nil {
		return nil, false, err
	}

	if len(points) == 0 {
		return nil, false, nil
	}

	sort.Slice(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	points = trimVizPoints(points, effectiveLimit)
	return points, true, nil
}
