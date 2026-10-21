package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func isVizAggregation(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "avg", "min", "max":
		return true
	default:
		return false
	}
}

// queryVizSeriesAggregated performs server-side time-bucket aggregation so the
// dashboard can request a compact series instead of loading raw points.
func (h *Handler) queryVizSeriesAggregated(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	aggregation string,
	bucketSeconds int,
	limit int,
) ([]vizDataPoint, vizQueryMeta, error) {
	aggregation = strings.ToLower(strings.TrimSpace(aggregation))
	if !isVizAggregation(aggregation) {
		return nil, vizQueryMeta{}, fmt.Errorf("unsupported aggregation %q", aggregation)
	}
	if len(items) == 0 {
		return []vizDataPoint{}, vizQueryMeta{}, nil
	}
	if limit <= 0 {
		limit = vizDefaultPointLimit
	}
	if limit > vizFullLoadPointLimit {
		limit = vizFullLoadPointLimit
	}
	if bucketSeconds <= 0 {
		start, hasStart, end, hasEnd := getVizFilterBounds(filter)
		if hasStart && hasEnd {
			bucketSeconds = defaultChartBucketSeconds(start, end)
		} else {
			bucketSeconds = 60
		}
	}
	if bucketSeconds > 86400 {
		bucketSeconds = 86400
	}
	bucketMs := int64(bucketSeconds) * 1000

	total, err := h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		return nil, vizQueryMeta{}, fmt.Errorf("count aggregated frames: %w", err)
	}
	if total == 0 {
		return []vizDataPoint{}, vizQueryMeta{TotalMatched: 0, Returned: 0, Downsampled: false}, nil
	}

	projection := bson.M{"timestamp": 1}
	for i, item := range items {
		projection[fmt.Sprintf("v%d", i)] = bson.M{"$arrayElemAt": bson.A{
			bson.M{"$map": bson.M{
				"input": bson.M{"$filter": bson.M{
					"input": bson.M{"$objectToArray": bson.M{"$ifNull": bson.A{"$parsed_fields", bson.M{}}}},
					"as":    "p",
					"cond":  bson.M{"$eq": bson.A{"$$p.k", item.FieldRef.FieldName}},
				}},
				"as": "p",
				"in": "$$p.v",
			}},
			0,
		}}
	}

	group := bson.M{
		"_id": bson.M{"$toDate": bson.M{"$subtract": bson.A{
			"$timestamp",
			bson.M{"$mod": bson.A{bson.M{"$toLong": "$timestamp"}, bucketMs}},
		}}},
	}
	op := "$" + aggregation
	for i := range items {
		group[fmt.Sprintf("v%d", i)] = bson.M{op: fmt.Sprintf("$v%d", i)}
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$project", Value: projection}},
		{{Key: "$group", Value: group}},
		{{Key: "$sort", Value: bson.D{{Key: "_id", Value: 1}}}},
		{{Key: "$limit", Value: int64(limit)}},
	}

	cursor, err := h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetBatchSize(500))
	if err != nil {
		return nil, vizQueryMeta{}, fmt.Errorf("aggregate series: %w", err)
	}
	defer cursor.Close(ctx)

	points := make([]vizDataPoint, 0, minInt(int(total), limit))
	for cursor.Next(ctx) {
		var doc bson.M
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		timestamp, ok := vizDocumentTime(doc["_id"])
		if !ok {
			continue
		}
		values := make(map[string]interface{}, len(items))
		for i, item := range items {
			value, ok := extractVizValue(doc[fmt.Sprintf("v%d", i)])
			if ok {
				values[item.Label] = value
			}
		}
		if len(values) > 0 {
			points = append(points, vizDataPoint{Timestamp: timestamp, Values: values})
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, fmt.Errorf("aggregate series: %w", err)
	}

	return points, vizQueryMeta{
		TotalMatched: total,
		Returned:     len(points),
		Downsampled:  false,
	}, nil
}

func vizDocumentTime(value interface{}) (time.Time, bool) {
	switch v := value.(type) {
	case time.Time:
		return v.UTC(), true
	case primitive.DateTime:
		return v.Time().UTC(), true
	default:
		return time.Time{}, false
	}
}
