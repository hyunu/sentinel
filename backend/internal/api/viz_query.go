package api

import (
	"context"
	"fmt"
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

type vizValueDomain struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type vizQueryMeta struct {
	TotalMatched int64                     `json:"total_matched"`
	Returned     int                       `json:"returned"`
	Downsampled  bool                      `json:"downsampled"`
	Domain       map[string]vizValueDomain `json:"domain,omitempty"`
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
	Docs []vizBucketDocEntry `bson:"docs"`
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

func isVizLiveMode(mode string) bool {
	return mode == "live"
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
	if len(items) == 0 {
		return bson.M{"timestamp": 1}
	}
	projection := bson.M{"timestamp": 1, "parsed_fields": 1}
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

func expandBucketAverage(docs []vizBucketDocEntry, items []models.VizItem) []vizDataPoint {
	if len(docs) == 0 {
		return nil
	}

	type accumulator struct {
		sum   float64
		count int
	}

	accumulators := make(map[string]*accumulator, len(items))
	start := docs[0].Timestamp
	end := docs[0].Timestamp

	for _, doc := range docs {
		if doc.Timestamp.Before(start) {
			start = doc.Timestamp
		}
		if doc.Timestamp.After(end) {
			end = doc.Timestamp
		}
		for _, item := range items {
			fieldName := item.FieldRef.FieldName
			if fieldName == "" || item.Label == "" {
				continue
			}
			value, ok := extractVizValue(doc.ParsedFields[fieldName])
			if !ok {
				continue
			}
			acc := accumulators[item.Label]
			if acc == nil {
				acc = &accumulator{}
				accumulators[item.Label] = acc
			}
			acc.sum += value
			acc.count++
		}
	}

	values := make(map[string]interface{}, len(accumulators))
	for label, acc := range accumulators {
		if acc.count > 0 {
			values[label] = acc.sum / float64(acc.count)
		}
	}
	if len(values) == 0 {
		return nil
	}

	mid := start.Add(end.Sub(start) / 2)
	return []vizDataPoint{{Timestamp: mid, Values: values}}
}

func vizMaxBucketsForLimit(limit int) int {
	buckets := limit / 2
	if buckets < 1 {
		return 1
	}
	return buckets
}

func reverseVizPoints(points []vizDataPoint) {
	for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
		points[i], points[j] = points[j], points[i]
	}
}

func (h *Handler) scanVizPoints(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	limit int,
	newestFirst bool,
) ([]vizDataPoint, error) {
	sortDir := 1
	if newestFirst {
		sortDir = -1
	}
	findOpts := options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: sortDir}, {Key: "_id", Value: sortDir}}).
		SetLimit(int64(limit)).
		SetProjection(buildVizProjection(items)).
		SetBatchSize(500)

	cursor, err := h.db.UartData().Find(ctx, filter, findOpts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	results := make([]vizDataPoint, 0, limit)
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
		return nil, err
	}
	if newestFirst {
		reverseVizPoints(results)
	}
	return results, nil
}

// queryVizSeriesRaw returns actual parsed samples. Used by live tail so the
// chart never substitutes 60s min/avg/max rollups for incoming packets.
func (h *Handler) queryVizSeriesRaw(
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

	newestFirst := total > int64(effectiveLimit)
	results, err := h.scanVizPoints(ctx, filter, items, effectiveLimit, newestFirst)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}

	return results, vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  total > int64(len(results)),
	}, nil
}

// coalesceVizPointsByTimestamp merges frames that share an exact timestamp.
// Historical batches recorded before per-frame timestamps existed can contain
// dozens of frames at one timestamp; leaving them separate makes a chart draw
// vertical spikes at the same x position.
const vizLegacyBurstWindow = 30 * time.Millisecond

func coalesceVizPointsByTimestamp(points []vizDataPoint) []vizDataPoint {
	if len(points) < 2 {
		return points
	}
	type accumulator struct {
		sums   map[string]float64
		counts map[string]int
	}
	out := make([]vizDataPoint, 0, len(points))
	var current *accumulator
	var currentTS time.Time
	flush := func() {
		if current == nil {
			return
		}
		values := make(map[string]interface{}, len(current.sums))
		for label, sum := range current.sums {
			if current.counts[label] > 0 {
				values[label] = sum / float64(current.counts[label])
			}
		}
		if len(values) > 0 {
			out = append(out, vizDataPoint{Timestamp: currentTS, Values: values})
		}
		current = nil
	}
	for _, point := range points {
		if current == nil || point.Timestamp.Sub(currentTS) > vizLegacyBurstWindow {
			flush()
			currentTS = point.Timestamp
			current = &accumulator{
				sums:   make(map[string]float64, len(point.Values)),
				counts: make(map[string]int, len(point.Values)),
			}
		}
		for label, raw := range point.Values {
			value, ok := extractVizValue(raw)
			if !ok {
				continue
			}
			current.sums[label] += value
			current.counts[label]++
		}
	}
	flush()
	return out
}

// queryVizSeriesSampled returns actual parsed samples spread across the whole
// range instead of bucket averages. This keeps the rough overview silhouette
// (peaks, on/off edges, start/end) close to the detailed data.
func (h *Handler) queryVizSeriesSampled(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	limit int,
	bucketsOverride int,
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
	// A caller-provided bucket count always keeps the sampled shape even when
	// the partition is small (progressive refinement passes need that).
	if bucketsOverride <= 0 && total <= int64(effectiveLimit) {
		return h.queryVizSeries(ctx, filter, items, effectiveLimit)
	}

	// Two boundary samples per bucket (first/last) keep both ends of sharp
	// transitions while still bounding the response size.
	buckets := effectiveLimit / 2
	if bucketsOverride > 0 {
		buckets = bucketsOverride
	}
	if buckets > int(total) {
		buckets = int(total)
	}
	if buckets < 1 {
		buckets = 1
	}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$sort", Value: bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$project", Value: buildVizProjection(items)}},
		{{Key: "$bucketAuto", Value: bson.M{
			"groupBy": "$timestamp",
			"buckets": buckets,
			"output": bson.M{
				"first": bson.M{"$first": bson.M{
					"timestamp":     "$timestamp",
					"parsed_fields": "$parsed_fields",
				}},
				"last": bson.M{"$last": bson.M{
					"timestamp":     "$timestamp",
					"parsed_fields": "$parsed_fields",
				}},
			},
		}}},
	}

	cursor, err := h.db.UartData().Aggregate(
		ctx, pipeline,
		options.Aggregate().SetAllowDiskUse(true).SetBatchSize(500),
	)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	defer cursor.Close(ctx)

	results := make([]vizDataPoint, 0, effectiveLimit)
	for cursor.Next(ctx) {
		var group struct {
			First vizBucketDocEntry `bson:"first"`
			Last  vizBucketDocEntry `bson:"last"`
		}
		if err := cursor.Decode(&group); err != nil {
			continue
		}
		for _, doc := range []vizBucketDocEntry{group.First, group.Last} {
			if doc.Timestamp.IsZero() {
				continue
			}
			vals := vizValuesFromDoc(&vizSampleDoc{
				Timestamp:    doc.Timestamp,
				ParsedFields: doc.ParsedFields,
			}, items)
			if len(vals) == 0 {
				continue
			}
			results = append(results, vizDataPoint{Timestamp: doc.Timestamp, Values: vals})
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, err
	}

	// Guarantee the real start/end of the range are present even when the first
	// or last document has no value for the selected fields.
	head, err := h.scanVizPoints(ctx, filter, items, 20, false)
	if err == nil && len(head) > 0 {
		results = append(head[:1], results...)
	}
	tail, err := h.scanVizPoints(ctx, filter, items, 20, true)
	if err == nil && len(tail) > 0 {
		results = append(results, tail[len(tail)-1])
	}

	results = coalesceVizPointsByTimestamp(results)
	if len(results) > 1 {
		sort.Slice(results, func(i, j int) bool {
			return results[i].Timestamp.Before(results[j].Timestamp)
		})
	}

	return results, vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  total > int64(len(results)),
	}, nil
}

// vizNumericFieldExpr extracts one parsed field as a double. Simple field names
// use a direct path (cheap); names with dots or special characters fall back to
// the objectToArray form so they still resolve on MongoDB 4.4.
func vizNumericFieldExpr(fieldName string) bson.M {
	var input interface{}
	if isSimpleVizFieldName(fieldName) {
		input = "$parsed_fields." + fieldName
	} else {
		input = bson.M{"$arrayElemAt": bson.A{
			bson.M{"$map": bson.M{
				"input": bson.M{"$filter": bson.M{
					"input": bson.M{"$objectToArray": bson.M{"$ifNull": bson.A{"$parsed_fields", bson.M{}}}},
					"as":    "p",
					"cond":  bson.M{"$eq": bson.A{"$$p.k", fieldName}},
				}},
				"as": "p",
				"in": "$$p.v",
			}},
			0,
		}}
	}
	return bson.M{"$convert": bson.M{
		"input":   input,
		"to":      "double",
		"onError": nil,
		"onNull":  nil,
	}}
}

func isSimpleVizFieldName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if r == '_' ||
			(r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return true
}

// queryVizSeriesEnvelope keeps the min and max of every selected field per
// bucket. A full-range line chart effectively shows this envelope, so the rough
// preview keeps the same peaks and on/off edges as the detailed data instead of
// being smoothed by first/last sampling. The global min/max are also returned
// so the dashboard can keep a stable Y axis while the detail is loading.
func (h *Handler) queryVizSeriesEnvelope(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	buckets int,
) ([]vizDataPoint, vizQueryMeta, error) {
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
	if buckets <= 0 {
		buckets = vizDefaultPointLimit / 2
	}
	if buckets > 50000 {
		buckets = 50000
	}
	if buckets < 1 {
		buckets = 1
	}
	// Small ranges are cheaper and more accurate as actual samples.
	if total <= int64(buckets) {
		return h.queryVizSeries(ctx, filter, items, int(total))
	}
	if int64(buckets) > total {
		buckets = int(total)
	}

	projection := bson.M{"timestamp": 1}
	for i := range items {
		projection[fmt.Sprintf("v%d", i)] = vizNumericFieldExpr(items[i].FieldRef.FieldName)
	}
	output := bson.M{
		"first": bson.M{"$first": "$timestamp"},
		"last":  bson.M{"$last": "$timestamp"},
	}
	for i := range items {
		output[fmt.Sprintf("v%d_min", i)] = bson.M{"$min": fmt.Sprintf("$v%d", i)}
		output[fmt.Sprintf("v%d_max", i)] = bson.M{"$max": fmt.Sprintf("$v%d", i)}
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$sort", Value: bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$project", Value: projection}},
		{{Key: "$bucketAuto", Value: bson.M{
			"groupBy": "$timestamp",
			"buckets": buckets,
			"output":  output,
		}}},
	}

	cursor, err := h.db.UartData().Aggregate(
		ctx, pipeline,
		options.Aggregate().SetAllowDiskUse(true).SetBatchSize(500),
	)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	defer cursor.Close(ctx)

	type domainAcc struct {
		min float64
		max float64
		has bool
	}
	domains := make(map[string]*domainAcc, len(items))
	results := make([]vizDataPoint, 0, buckets*2)

	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		firstTs, _ := vizDocumentTime(doc["first"])
		lastTs, _ := vizDocumentTime(doc["last"])
		if firstTs.IsZero() && lastTs.IsZero() {
			continue
		}

		minValues := make(map[string]interface{}, len(items))
		maxValues := make(map[string]interface{}, len(items))
		for i, item := range items {
			if v, ok := extractVizValue(doc[fmt.Sprintf("v%d_min", i)]); ok {
				minValues[item.Label] = v
				acc := domains[item.Label]
				if acc == nil {
					acc = &domainAcc{}
					domains[item.Label] = acc
				}
				if !acc.has || v < acc.min {
					acc.min = v
				}
				if !acc.has || v > acc.max {
					acc.max = v
				}
				acc.has = true
			}
			if v, ok := extractVizValue(doc[fmt.Sprintf("v%d_max", i)]); ok {
				maxValues[item.Label] = v
				acc := domains[item.Label]
				if acc == nil {
					acc = &domainAcc{}
					domains[item.Label] = acc
				}
				if !acc.has || v < acc.min {
					acc.min = v
				}
				if !acc.has || v > acc.max {
					acc.max = v
				}
				acc.has = true
			}
		}
		if len(minValues) == 0 && len(maxValues) == 0 {
			continue
		}

		if firstTs.IsZero() {
			firstTs = lastTs
		}
		if lastTs.IsZero() {
			lastTs = firstTs
		}
		results = append(results, vizDataPoint{Timestamp: firstTs, Values: minValues})
		maxTs := lastTs
		if !maxTs.After(firstTs) {
			maxTs = firstTs.Add(time.Millisecond)
		}
		results = append(results, vizDataPoint{Timestamp: maxTs, Values: maxValues})
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, err
	}

	// Add the actual first/last samples so the very ends of the range keep the
	// real values even if the first bucket only has an extreme in the middle.
	head, err := h.scanVizPoints(ctx, filter, items, 20, false)
	if err == nil && len(head) > 0 {
		if len(results) == 0 || !head[0].Timestamp.Equal(results[0].Timestamp) {
			results = append([]vizDataPoint{head[0]}, results...)
		}
	}
	tail, err := h.scanVizPoints(ctx, filter, items, 20, true)
	if err == nil && len(tail) > 0 {
		lastPoint := tail[len(tail)-1]
		if len(results) == 0 || !lastPoint.Timestamp.Equal(results[len(results)-1].Timestamp) {
			results = append(results, lastPoint)
		}
	}

	if len(results) > 1 {
		sort.SliceStable(results, func(i, j int) bool {
			return results[i].Timestamp.Before(results[j].Timestamp)
		})
	}

	domainValues := make(map[string]vizValueDomain, len(domains))
	for label, acc := range domains {
		if acc.has {
			domainValues[label] = vizValueDomain{Min: acc.min, Max: acc.max}
		}
	}

	return results, vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  total > int64(len(results)),
		Domain:       domainValues,
	}, nil
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

		results = coalesceVizPointsByTimestamp(results)
		meta := vizQueryMeta{
			TotalMatched: total,
			Returned:     len(results),
			Downsampled:  total > int64(len(results)),
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
	// $bucketAuto (MongoDB 3.4+) is used instead of $setWindowFields (5.0+)
	// so the N100 deployment can run MongoDB 4.4 without AVX support.
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$sort", Value: bson.D{{Key: "timestamp", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$project", Value: projection}},
		{{Key: "$bucketAuto", Value: bson.M{
			"groupBy": "$timestamp",
			"buckets": maxBuckets,
			"output": bson.M{"docs": bson.M{"$push": bson.M{
				"timestamp":     "$timestamp",
				"parsed_fields": "$parsed_fields",
			}}},
		}}},
	}

	cursor, err := h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetAllowDiskUse(true).SetBatchSize(500))
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
		bucketPoints := expandBucketAverage(group.Docs, items)
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
