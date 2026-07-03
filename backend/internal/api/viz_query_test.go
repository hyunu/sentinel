package api

import (
	"math"
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

func TestNormalizeVizPointLimit(t *testing.T) {
	t.Parallel()

	cases := []struct {
		limit int
		want  int
	}{
		{limit: 0, want: vizDefaultPointLimit},
		{limit: -1, want: vizDefaultPointLimit},
		{limit: 500, want: 500},
		{limit: 8000, want: 8000},
		{limit: 20000, want: 20000},
		{limit: 600000, want: vizFullLoadPointLimit},
	}

	for _, tc := range cases {
		got := normalizeVizPointLimit(tc.limit)
		if got != tc.want {
			t.Fatalf("normalizeVizPointLimit(%d) = %d, want %d", tc.limit, got, tc.want)
		}
	}
}

func TestVizMaxBucketsForLimit(t *testing.T) {
	t.Parallel()

	if got := vizMaxBucketsForLimit(8000); got != 4000 {
		t.Fatalf("vizMaxBucketsForLimit(8000) = %d, want 4000", got)
	}
	if got := vizMaxBucketsForLimit(1); got != 1 {
		t.Fatalf("vizMaxBucketsForLimit(1) = %d, want 1", got)
	}
}

func TestExpandBucketMinMaxPreservesSpike(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	items := []models.VizItem{
		{Label: "rpm", FieldRef: models.FieldRef{FieldName: "rpm"}},
	}

	docs := []vizBucketDocEntry{
		{Timestamp: base, ParsedFields: map[string]interface{}{"rpm": 100.0}},
		{Timestamp: base.Add(time.Minute), ParsedFields: map[string]interface{}{"rpm": 120.0}},
		{Timestamp: base.Add(2 * time.Minute), ParsedFields: map[string]interface{}{"rpm": 9999.0}},
		{Timestamp: base.Add(3 * time.Minute), ParsedFields: map[string]interface{}{"rpm": 110.0}},
	}

	points := expandBucketMinMax(docs, items)
	if len(points) < 2 {
		t.Fatalf("expected at least 2 points, got %d", len(points))
	}

	foundSpike := false
	for _, p := range points {
		if v, ok := p.Values["rpm"].(float64); ok && math.Abs(v-9999.0) < 1e-9 {
			foundSpike = true
			break
		}
	}
	if !foundSpike {
		t.Fatalf("spike value 9999 not preserved in bucket output: %+v", points)
	}
}
