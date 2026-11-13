package api

import (
	"testing"
	"time"
)

func TestAggregateVizRollupBackfill(t *testing.T) {
	base := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	docs := []vizRollupSourceDoc{
		{
			BucketStart: base,
			Count:       2,
			MinFields:   map[string]interface{}{"a": 1.0},
			MaxFields:   map[string]interface{}{"a": 3.0, "last_ts": base.Add(30 * time.Second)},
			SumFields:   map[string]interface{}{"a": 4.0},
		},
		{
			BucketStart: base.Add(60 * time.Second),
			Count:       1,
			MinFields:   map[string]interface{}{"a": 6.0},
			MaxFields:   map[string]interface{}{"a": 9.0, "last_ts": base.Add(90 * time.Second)},
			SumFields:   map[string]interface{}{"a": 6.0},
		},
	}

	buckets := aggregateVizRollupBackfill(docs)
	fiveMinute := findBackfillBucket(buckets, 300, base)
	if fiveMinute == nil {
		t.Fatalf("missing 5m bucket: %+v", buckets)
	}
	if fiveMinute.Count != 3 {
		t.Fatalf("count: want 3, got %d", fiveMinute.Count)
	}
	if fiveMinute.MinFields["a"] != 1.0 || fiveMinute.MaxFields["a"] != 9.0 || fiveMinute.SumFields["a"] != 10.0 {
		t.Fatalf("field aggregate: %+v / %+v / %+v", fiveMinute.MinFields, fiveMinute.MaxFields, fiveMinute.SumFields)
	}
	if !fiveMinute.LastTS.Equal(base.Add(90 * time.Second)) {
		t.Fatalf("last_ts: want %v, got %v", base.Add(90*time.Second), fiveMinute.LastTS)
	}

	hour := findBackfillBucket(buckets, 3600, base)
	if hour == nil || hour.Count != 3 || hour.SumFields["a"] != 10.0 {
		t.Fatalf("1h bucket mismatch: %+v", hour)
	}
}

func TestAggregateVizRollupBackfillSplitsBuckets(t *testing.T) {
	base := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	docs := []vizRollupSourceDoc{
		{BucketStart: base, Count: 1, MinFields: map[string]interface{}{"a": 1.0}, MaxFields: map[string]interface{}{"a": 1.0}, SumFields: map[string]interface{}{"a": 1.0}},
		{BucketStart: base.Add(5 * time.Minute), Count: 1, MinFields: map[string]interface{}{"a": 2.0}, MaxFields: map[string]interface{}{"a": 2.0}, SumFields: map[string]interface{}{"a": 2.0}},
	}
	buckets := aggregateVizRollupBackfill(docs)
	if findBackfillBucket(buckets, 300, base) == nil || findBackfillBucket(buckets, 300, base.Add(5*time.Minute)) == nil {
		t.Fatalf("expected two 5m buckets: %+v", buckets)
	}
	if findBackfillBucket(buckets, 3600, base) == nil {
		t.Fatalf("expected one 1h bucket")
	}
	count := 0
	for _, bucket := range buckets {
		if bucket.GranularitySec == 3600 {
			count += 1
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly one 1h bucket, got %d", count)
	}
}

func findBackfillBucket(buckets []vizRollupBackfillBucket, granularity int, at time.Time) *vizRollupBackfillBucket {
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
