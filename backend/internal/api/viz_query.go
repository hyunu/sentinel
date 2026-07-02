package api

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	vizDefaultPointLimit  = 8000
	vizMaxPointLimit      = 10000
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
	Total        int64                  `bson:"total"`
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

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$sort", Value: bson.D{{Key: "timestamp", Value: 1}}}},
		{{Key: "$setWindowFields", Value: bson.M{
			"sortBy": bson.M{"timestamp": 1},
			"output": bson.M{
				"rowNum": bson.M{"$documentNumber": bson.M{}},
				"total":  bson.M{"$count": bson.M{}},
			},
		}}},
		{{Key: "$addFields", Value: bson.M{
			"stride": bson.M{
				"$max": bson.A{
					1,
					bson.M{"$floor": bson.M{"$divide": bson.A{"$total", effectiveLimit}}},
				},
			},
		}}},
		{{Key: "$match", Value: bson.M{
			"$expr": bson.M{
				"$or": bson.A{
					bson.M{"$eq": bson.A{"$rowNum", "$total"}},
					bson.M{"$eq": bson.A{
						bson.M{"$mod": bson.A{
							bson.M{"$subtract": bson.A{"$rowNum", 1}},
							"$stride",
						}},
						0,
					}},
				},
			},
		}}},
		{{Key: "$limit", Value: effectiveLimit}},
		{{Key: "$project", Value: bson.M{
			"timestamp":     1,
			"parsed_fields": 1,
			"total":         1,
		}}},
	}

	cursor, err := h.db.UartData().Aggregate(ctx, pipeline, options.Aggregate().SetBatchSize(500))
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	defer cursor.Close(ctx)

	results := make([]vizDataPoint, 0, effectiveLimit)
	var total int64
	for cursor.Next(ctx) {
		var d vizSampleDoc
		if err := cursor.Decode(&d); err != nil {
			continue
		}
		if total == 0 && d.Total > 0 {
			total = d.Total
		}
		vals := vizValuesFromDoc(&d, items)
		if len(vals) == 0 {
			continue
		}
		results = append(results, vizDataPoint{
			Timestamp: d.Timestamp,
			Values:    vals,
		})
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, err
	}

	meta := vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  total > int64(effectiveLimit),
	}
	return results, meta, nil
}
