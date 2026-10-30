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

func TestExpandBucketAverageOnePointPerBucket(t *testing.T) {
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

	points := expandBucketAverage(docs, items)
	if len(points) != 1 {
		t.Fatalf("expected exactly one point per bucket, got %d: %+v", len(points), points)
	}

	want := (100.0 + 120.0 + 9999.0 + 110.0) / 4
	got, ok := points[0].Values["rpm"].(float64)
	if !ok || math.Abs(got-want) > 1e-9 {
		t.Fatalf("average = %v, want %v", got, want)
	}
	wantTS := base.Add(90 * time.Second)
	if !points[0].Timestamp.Equal(wantTS) {
		t.Fatalf("timestamp = %s, want %s", points[0].Timestamp, wantTS)
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
		"timestamp":     1,
		"parsed_fields": 1,
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

func TestIsVizLiveMode(t *testing.T) {
	t.Parallel()
	if !isVizLiveMode("live") {
		t.Fatal("expected live mode")
	}
	if isVizLiveMode("") || isVizLiveMode("overview") {
		t.Fatal("empty/overview must stay on history path")
	}
}

func TestReverseVizPoints(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 8, 23, 6, 0, 0, 0, time.UTC)
	points := []vizDataPoint{
		{Timestamp: base.Add(2 * time.Second)},
		{Timestamp: base.Add(time.Second)},
		{Timestamp: base},
	}
	reverseVizPoints(points)
	if !points[0].Timestamp.Equal(base) || !points[2].Timestamp.Equal(base.Add(2*time.Second)) {
		t.Fatalf("reverse order wrong: %+v", points)
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

	gran, use = chooseVizRollupGranularity(33633, 8000, time.Time{}, false, time.Time{}, false)
	if !use || gran != 10 {
		t.Fatalf("expected 10s buckets for moderate all-range query, got gran=%d use=%v", gran, use)
	}

	gran, use = chooseVizRollupGranularity(500000, 8000, time.Time{}, false, time.Time{}, false)
	if !use || gran != 60 {
		t.Fatalf("expected 60s buckets for large all-range query, got gran=%d use=%v", gran, use)
	}
}
