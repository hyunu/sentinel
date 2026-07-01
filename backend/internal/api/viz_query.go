package api

import (
	"context"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	vizDefaultPointLimit = 2000
	vizMaxPointLimit     = 5000
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

func normalizeVizPointLimit(limit int) (effectiveLimit int, unlimited bool) {
	if limit == 0 {
		return 0, true
	}
	if limit < 0 {
		return vizDefaultPointLimit, false
	}
	if limit > vizMaxPointLimit {
		return vizMaxPointLimit, false
	}
	return limit, false
}

func queryTimeoutForVizLimit(limit int) time.Duration {
	if limit == 0 {
		return 120 * time.Second
	}
	return 30 * time.Second
}

func (h *Handler) queryVizSeries(
	ctx context.Context,
	filter bson.M,
	items []models.VizItem,
	limit int,
) ([]vizDataPoint, vizQueryMeta, error) {
	effectiveLimit, unlimited := normalizeVizPointLimit(limit)

	if len(items) == 0 {
		return []vizDataPoint{}, vizQueryMeta{}, nil
	}

	projection := bson.M{"timestamp": 1, "parsed_fields": 1}

	total, err := h.db.UartData().CountDocuments(ctx, filter)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}

	stride := 1
	downsampled := false
	if !unlimited && total > int64(effectiveLimit) {
		stride = int(total / int64(effectiveLimit))
		if stride < 1 {
			stride = 1
		}
		downsampled = true
	}

	opts := options.Find().
		SetSort(bson.M{"timestamp": 1}).
		SetProjection(projection).
		SetBatchSize(500)

	cursor, err := h.db.UartData().Find(ctx, filter, opts)
	if err != nil {
		return nil, vizQueryMeta{}, err
	}
	defer cursor.Close(ctx)

	capacity := effectiveLimit
	if unlimited {
		capacity = int(total)
		if capacity < 64 {
			capacity = 64
		}
	}
	results := make([]vizDataPoint, 0, capacity)
	idx := 0
	totalInt := int(total)
	for cursor.Next(ctx) {
		idx++
		if stride > 1 && idx%stride != 0 && idx != totalInt {
			continue
		}

		var d models.UartData
		if err := cursor.Decode(&d); err != nil {
			continue
		}

		vals := make(map[string]interface{})
		if d.ParsedFields != nil {
			for _, item := range items {
				if v, ok := d.ParsedFields[item.FieldRef.FieldName]; ok {
					if fv, ok := extractVizValue(v); ok {
						vals[item.Label] = fv
					}
				}
			}
		}
		if len(vals) > 0 {
			results = append(results, vizDataPoint{
				Timestamp: d.Timestamp,
				Values:    vals,
			})
		}
		if !unlimited && len(results) >= effectiveLimit {
			break
		}
	}
	if err := cursor.Err(); err != nil {
		return nil, vizQueryMeta{}, err
	}

	meta := vizQueryMeta{
		TotalMatched: total,
		Returned:     len(results),
		Downsampled:  downsampled,
	}
	return results, meta, nil
}
