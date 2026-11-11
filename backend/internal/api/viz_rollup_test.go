package api

import (
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

func findRollupBucket(buckets []vizRollupBucket, granularity int, at time.Time) *vizRollupBucket {
	for i := range buckets {
		if buckets[i].GranularitySec != granularity {
			continue
		}
		if buckets[i].BucketStart.Equal(rollupBucketStart(at, granularity)) {
			return &buckets[i]
		}
	}
	return nil
}

func TestAggregateVizRollupBucketsMergesSamples(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 5, 0, time.UTC)
	samples := []models.UartData{
		{
			BoardID:   "board-1",
			Timestamp: start,
			ParsedFields: map[string]interface{}{
				"temp":       10.0,
				"rpm":        100.0,
				"status.raw": 1.0,
			},
		},
		{
			BoardID:   "board-1",
			Timestamp: start.Add(2 * time.Second),
			ParsedFields: map[string]interface{}{
				"temp": 30.0,
				"rpm":  300.0,
			},
		},
	}

	buckets := aggregateVizRollupBuckets(samples)
	ten := findRollupBucket(buckets, 10, start)
	if ten == nil {
		t.Fatalf("missing 10s bucket: %+v", buckets)
	}
	if ten.Count != 2 {
		t.Fatalf("count: want 2, got %d", ten.Count)
	}
	if ten.MinFields["temp"] != 10 || ten.MaxFields["temp"] != 30 || ten.SumFields["temp"] != 40 {
		t.Fatalf("temp aggregate: %+v / %+v / %+v", ten.MinFields, ten.MaxFields, ten.SumFields)
	}
	if ten.MinFields["rpm"] != 100 || ten.MaxFields["rpm"] != 300 || ten.SumFields["rpm"] != 400 {
		t.Fatalf("rpm aggregate: %+v / %+v / %+v", ten.MinFields, ten.MaxFields, ten.SumFields)
	}
	if ten.SumFields["status.raw"] != 1 {
		t.Fatalf("single-sample field sum: want 1, got %v", ten.SumFields["status.raw"])
	}
	if !ten.LastTS.Equal(start.Add(2 * time.Second)) {
		t.Fatalf("last_ts: want %v, got %v", start.Add(2*time.Second), ten.LastTS)
	}

	one := findRollupBucket(buckets, 1, start)
	if one == nil || one.Count != 1 {
		t.Fatalf("1s bucket should only contain the first sample: %+v", one)
	}
	sixty := findRollupBucket(buckets, 60, start)
	if sixty == nil || sixty.Count != 2 {
		t.Fatalf("60s bucket should contain both samples: %+v", sixty)
	}
}

func TestAggregateVizRollupBucketsSeparatesSamplesAcrossSeconds(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 5, 100_000_000, time.UTC)
	samples := []models.UartData{
		{BoardID: "board-1", Timestamp: start, ParsedFields: map[string]interface{}{"v": 1.0}},
		{BoardID: "board-1", Timestamp: start.Add(700 * time.Millisecond), ParsedFields: map[string]interface{}{"v": 2.0}},
		{BoardID: "board-1", Timestamp: start.Add(1200 * time.Millisecond), ParsedFields: map[string]interface{}{"v": 3.0}},
	}

	buckets := aggregateVizRollupBuckets(samples)
	// 1s: two buckets; every coarser granularity: one bucket each.
	want := 2 + len(vizRollupGranularitySecs) - 1
	if len(buckets) != want {
		t.Fatalf("want %d buckets, got %d: %+v", want, len(buckets), buckets)
	}
	ten := findRollupBucket(buckets, 10, start)
	if ten == nil || ten.Count != 3 {
		t.Fatalf("10s bucket should hold all samples: %+v", ten)
	}
}

func TestAggregateVizRollupBucketsSkipsSamplesWithoutNumericFields(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 5, 0, time.UTC)
	samples := []models.UartData{
		{BoardID: "board-1", Timestamp: start, ParsedFields: map[string]interface{}{"text": "hello"}},
		{BoardID: "", Timestamp: start, ParsedFields: map[string]interface{}{"v": 1.0}},
		{BoardID: "board-1", Timestamp: time.Time{}, ParsedFields: map[string]interface{}{"v": 1.0}},
	}
	if got := aggregateVizRollupBuckets(samples); len(got) != 0 {
		t.Fatalf("expected no buckets, got %+v", got)
	}
}
