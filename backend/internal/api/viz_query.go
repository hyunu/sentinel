package api

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	vizDefaultPointLimit  = 8000
	vizFullLoadPointLimit = 500000
)

type vizDataPoint struct {
	Timestamp time.Time              `json:"timestamp"`
	Values    map[string]interface{} `json:"values"`
}

type vizQueryMeta struct {
	TotalMatched int64 `json:"total_matched"`
	Returned     int   `json:"returned"`
	Downsampled  bool  `json:"downsampled"`
}

type vizSampleDoc struct {
	Timestamp    time.Time              `bson:"timestamp"`
	ParsedFields map[string]interface{} `bson:"parsed_fields"`
}

type vizBucketDocEntry struct {
	Timestamp    time.Time              `bson:"timestamp"`
	ParsedFields map[string]interface{} `bson:"parsed_fields"`
}

type vizBucketGroup struct {
	Bucket int64               `bson:"_id"`
	Docs   []vizBucketDocEntry `bson:"docs"`
}

func extractVizValue(v interface{}) (float64, bool) {
	switch vv := v.(type) {
	case float64:
		return vv, true
	case int:
		return float64(vv), true
	case int32:
		return float64(vv), true
	case int64:
		return float64(vv), true
	default:
		return 0, false
	}
}

func normalizeVizPointLimit(limit int) int {
	if limit <= 0 {
		return vizDefaultPointLimit
	}
	if limit > vizFullLoadPointLimit {
		return vizFullLoadPointLimit
	}
	return limit
}

func queryTimeoutForVizLimit(limit int) time.Duration {
	return 30 * time.Second
}

func buildVizProjection(items []models.VizItem) bson.M {
	projection := bson.M{"timestamp": 1}
	for _, item := range items {
		field := item.FieldRef.FieldName
		if field == "" {
			continue
		}
		projection["parsed_fields."+field] = 1
	}
	return projection
}

func vizValuesFromDoc(d *vizSampleDoc, items []models.VizItem) map[string]interface{} {
	vals := make(map[string]interface{})
	if d.ParsedFields == nil {
		return vals
	}
	for _, item := range items {
		if v, ok := d.ParsedFields[item.FieldRef.FieldName]; ok {
			if fv, ok := extractVizValue(v); ok {
				vals[item.Label] = fv
			}
		}
	}
	return vals
}

func vizValuesFromParsed(parsed map[string]interface{}, items []models.VizItem) map[string]interface{} {
	vals := make(map[string]interface{})
	if parsed == nil {
		return vals
	}
	for _, item := range items {
		if v, ok := parsed[item.FieldRef.FieldName]; ok {
			if fv, ok := extractVizValue(v); ok {
				vals[item.Label] = fv
			}
		}
	}
	return vals
}

func rowMaxField(parsed map[string]interface{}, items []models.VizItem) (float64, bool) {
	max := -math.MaxFloat64
	found := false
	for _, item := range items {
		if v, ok := parsed[item.FieldRef.FieldName]; ok {
			if fv, ok := extractVizValue(v); ok {
				found = true
				if fv > max {
					max = fv
				}
			}
		}
	}
	if !found {
		return 0, false
	}
	return max, true
}

func rowMinField(parsed map[string]interface{}, items []models.VizItem) (float64, bool) {
	min := math.MaxFloat64
	found := false
	for _, item := range items {
		if v, ok := parsed[item.FieldRef.FieldName]; ok {
			if fv, ok := extractVizValue(v); ok {
				found = true
				if fv < min {
					min = fv
				}
			}
		}
	}
	if !found {
		return 0, false
	}
	return min, true
}

func expandBucketMinMax(docs []vizBucketDocEntry, items []models.VizItem) []vizDataPoint {
	if len(docs) == 0 {
		return nil
	}

	type pick struct {
		ts   time.Time
		vals map[string]interface{}
	}

	picks := make([]pick, 0, 4)
	seen := make(map[int64]struct{}, 4)

	addEntry := func(entry vizBucketDocEntry) {
		key := entry.Timestamp.UnixNano()
		if _, ok := seen[key]; ok {
			return
		}
		vals := vizValuesFromParsed(entry.ParsedFields, items)
		if len(vals) == 0 {
			return
		}
		seen[key] = struct{}{}
		picks = append(picks, pick{ts: entry.Timestamp, vals: vals})
	}

	addEntry(docs[0])
	if len(docs) > 1 {
		addEntry(docs[len(docs)-1])
	}

	peakIdx := 0
	valleyIdx := 0
	peakScore := -math.MaxFloat64
	valleyScore := math.MaxFloat64
	hasPeak := false
	hasValley := false

	for i, doc := range docs {
		if maxV, ok := rowMaxField(doc.ParsedFields, items); ok {
			if !hasPeak || maxV > peakScore {
				peakScore = maxV
				peakIdx = i
				hasPeak = true
			}
		}
		if minV, ok := rowMinField(doc.ParsedFields, items); ok {
			if !hasValley || minV < valleyScore {
				valleyScore = minV
				valleyIdx = i
				hasValley = true
			}
		}
	}

	if hasPeak {
		addEntry(docs[peakIdx])
	}
	if hasValley {
		addEntry(docs[valleyIdx])
	}

	if len(picks) == 0 {
		return nil
	}

	sort.Slice(picks, func(i, j int) bool {
		return picks[i].ts.Before(picks[j].ts)
	})

	out := make([]vizDataPoint, len(picks))
	for i, p := range picks {
		out[i] = vizDataPoint{Timestamp: p.ts, Values: p.vals}
	}
	return out
}

func vizMaxBucketsForLimit(limit int) int {
	buckets := limit / 2
	if buckets < 1 {
		return 1
	}
	return buckets
}

func (h *Handler) queryVizSeries(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	limit int,
) ([]vizDataPoint, vizQueryMeta, error) {
	effectiveLimit := normalizeVizPointLimit(limit)

	if len(items) == 0 {
		return []vizDataPoint{}, vizQueryMeta{}, nil
	}

	total, err := h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}

	if total == 0 {
		return []vizDataPoint{}, vizQueryMeta{TotalMatched: 0, Returned: 0, Downsampled: false}, nil
	}

	projection := buildVizProjection(items)

	if total <= int64(effectiveLimit) {
		findOpts := options.Find().
			SetSort(bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}).
			SetLimit(int64(effectiveLimit)).
			SetProjection(projection).
			SetBatchSize(500)

		cursor, err := h.db.UartData().Find(ctx, filter, findOpts)
		if err != nil {
			return nil, vizQueryMeta{}, err
		}
		defer cursor.Close(ctx)

		results := make([]vizDataPoint, 0, int(total))
		for cursor.Next(ctx) {
			var doc vizSampleDoc
			if err := cursor.Decode(&doc); err != nil {
				continue
			}
			vals := vizValuesFromDoc(&doc, items)
			if len(vals) == 0 {
				continue
			}
			results = append(results, vizDataPoint{Timestamp: doc.Timestamp, Values: vals})
		}
		if err := cursor.Err(); err != nil {
			return nil, vizQueryMeta{}, err
		}

		meta := vizQueryMeta{
			TotalMatched: total,
			Returned:     len(results),
			Downsampled:  false,
		}
		return results, meta, nil
	}

	rollupResults, usedRollup, err := h.queryVizSeriesFromRollups(ctx, filter, items, effectiveLimit, total)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	if usedRollup {
		meta := vizQueryMeta{
			TotalMatched: total,
			Returned:     len(rollupResults),
			Downsampled:  total > int64(len(rollupResults)),
		}
		return rollupResults, meta, nil
	}

	maxBuckets := vizMaxBucketsForLimit(effectiveLimit)
	if int64(maxBuckets) > total {
		maxBuckets = int(total)
	}
	if maxBuckets < 1 {
		maxBuckets = 1
	}
	stride := int64(math.Ceil(float64(total) / float64(maxBuckets)))
	if stride < 1 {
		stride = 1
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$sort", Value: bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$project", Value: projection}},
		{{Key: "$setWindowFields", Value: bson.M{
			"sortBy": bson.M{"timestamp": 1, "_id": 1},
			"output": bson.M{
				"rowNum": bson.M{"$documentNumber": bson.M{}},
			},
		}}},
		{{Key: "$addFields", Value: bson.M{
			"bucket": bson.M{
				"$floor": bson.M{
					"$divide": bson.A{
						bson.M{"$subtract": bson.A{"$rowNum", 1}},
						stride,
					},
				},
			},
		}}},
		{{Key: "$group", Value: bson.M{
			"_id": "$bucket",
			"docs": bson.M{"$push": bson.M{
				"timestamp":     "$timestamp",
				"parsed_fields": "$parsed_fields",
			}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "_id", Value: 1}}}},
		{{Key: "$limit", Value: maxBuckets}},
	}

	cursor, err := h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetBatchSize(500))
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	defer cursor.Close(ctx)

	results := make([]vizDataPoint, 0, effectiveLimit)
	for cursor.Next(ctx) {
		var group vizBucketGroup
		if err := cursor.Decode(&group); err != nil {
			continue
		}
		bucketPoints := expandBucketMinMax(group.Docs, items)
		results = append(results, bucketPoints...)
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, err
	}

	if len(results) > 1 {
		sort.Slice(results, func(i, j int) bool {
			return results[i].Timestamp.Before(results[j].Timestamp)
		})
	}

	if len(results) > effectiveLimit {
		results = results[:effectiveLimit]
	}

	meta := vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  total > int64(len(results)),
	}
	return results, meta, nil
}
