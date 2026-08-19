package api

import (
	"math"
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
	"go.mongodb.org/mongo-driver/bson"
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

func TestBuildVizProjection(t *testing.T) {
	t.Parallel()

	items := []models.VizItem{
		{FieldRef: models.FieldRef{FieldName: "rpm"}},
		{FieldRef: models.FieldRef{FieldName: "temp.c"}},
		{FieldRef: models.FieldRef{FieldName: ""}},
	}

	got := buildVizProjection(items)
	want := bson.M{
		"timestamp":            1,
		"parsed_fields.rpm":    1,
		"parsed_fields.temp.c": 1,
	}

	if len(got) != len(want) {
		t.Fatalf("projection size = %d, want %d (%v)", len(got), len(want), got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("projection[%q] = %v, want %v", k, got[k], v)
		}
	}
}

func TestRollupBucketStart(t *testing.T) {
	t.Parallel()

	ts := time.Date(2026, 8, 19, 10, 33, 47, 0, time.UTC)
	if got := rollupBucketStart(ts, 10); !got.Equal(time.Date(2026, 8, 19, 10, 33, 40, 0, time.UTC)) {
		t.Fatalf("rollupBucketStart(10s) = %s", got)
	}
	if got := rollupBucketStart(ts, 60); !got.Equal(time.Date(2026, 8, 19, 10, 33, 0, 0, time.UTC)) {
		t.Fatalf("rollupBucketStart(60s) = %s", got)
	}
}

func TestChooseVizRollupGranularity(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	end := start.Add(3 * time.Hour)

	gran, use := chooseVizRollupGranularity(200000, 8000, start, true, end, true)
	if !use {
		t.Fatalf("expected rollup to be used")
	}
	if gran != 10 && gran != 60 {
		t.Fatalf("unexpected granularity: %d", gran)
	}

	gran, use = chooseVizRollupGranularity(10000, 8000, start, true, end, true)
	if use || gran != 0 {
		t.Fatalf("expected raw path for small overflow, got gran=%d use=%v", gran, use)
	}
}
