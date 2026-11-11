package api

import (
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

func TestUartPresenceBucketStart(t *testing.T) {
	ts := time.Date(2026, 11, 11, 0, 5, 42, 900_000_000, time.UTC)
	got := uartPresenceBucketStart(ts)
	want := time.Date(2026, 11, 11, 0, 5, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("bucket start: want %v, got %v", want, got)
	}
}

func TestAggregateUartPresenceBuckets(t *testing.T) {
	base := time.Date(2026, 11, 11, 0, 5, 1, 0, time.UTC)
	samples := []models.UartData{
		{BoardID: "board-1", Timestamp: base},
		{BoardID: "board-1", Timestamp: base.Add(20 * time.Second)},
		{BoardID: "board-1", Timestamp: base.Add(61 * time.Second)},
		{BoardID: "", Timestamp: base},
		{BoardID: "board-1", Timestamp: time.Time{}},
	}

	counts := aggregateUartPresenceBuckets(samples)
	if len(counts) != 2 {
		t.Fatalf("want 2 buckets, got %d: %+v", len(counts), counts)
	}
	first := uartPresenceBucketStart(base)
	second := uartPresenceBucketStart(base.Add(61 * time.Second))
	if counts[uartPresenceBucketKey{boardID: "board-1", bucketUnix: first.Unix()}] != 2 {
		t.Fatalf("first bucket: %+v", counts)
	}
	if counts[uartPresenceBucketKey{boardID: "board-1", bucketUnix: second.Unix()}] != 1 {
		t.Fatalf("second bucket: %+v", counts)
	}
}

func TestUartPresenceBucketsToBins(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	end := start.Add(4 * time.Minute)
	buckets := []uartPresenceBucket{
		{Start: start, Count: 10},
		{Start: start.Add(2 * time.Minute), Count: 20},
	}

	present, counts := uartPresenceBucketsToBins(start, end, 4, buckets)
	wantPresent := []bool{true, false, true, false}
	wantCounts := []int64{10, 0, 20, 0}
	for i := range wantPresent {
		if present[i] != wantPresent[i] || counts[i] != wantCounts[i] {
			t.Fatalf("bin %d: want %v/%d, got %v/%d", i, wantPresent[i], wantCounts[i], present[i], counts[i])
		}
	}
}

func TestUartPresenceBucketsToBinsSplitsBucketAcrossBins(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	buckets := []uartPresenceBucket{{Start: start, Count: 60}}

	// Four 30s bins: the first two split the 60s bucket by overlap.
	present, counts := uartPresenceBucketsToBins(start, start.Add(2*time.Minute), 4, buckets)
	want := []int64{30, 30, 0, 0}
	for i := range want {
		wantPresent := want[i] > 0
		if present[i] != wantPresent || counts[i] != want[i] {
			t.Fatalf("bin %d: want %v/%d, got %v/%d", i, wantPresent, want[i], present[i], counts[i])
		}
	}
}

func TestUartPresenceBucketsToBinsEmpty(t *testing.T) {
	start := time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	present, counts := uartPresenceBucketsToBins(start, start.Add(time.Minute), 8, nil)
	if len(present) != 8 || len(counts) != 8 {
		t.Fatalf("unexpected lengths: %d/%d", len(present), len(counts))
	}
	for i := range present {
		if present[i] || counts[i] != 0 {
			t.Fatalf("bin %d should be empty", i)
		}
	}
}
