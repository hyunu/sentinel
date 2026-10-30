package api

import (
	"testing"
	"time"
)

func TestResolveUartBatchTimestampsUsesOffsets(t *testing.T) {
	received := time.Date(2026, 10, 30, 7, 18, 0, 0, time.UTC)
	entries := []uartBatchEntry{
		{OffsetMs: 0},
		{OffsetMs: 100},
		{OffsetMs: 250},
	}

	got := resolveUartBatchTimestamps(entries, received)
	want := []time.Time{
		received.Add(-250 * time.Millisecond),
		received.Add(-150 * time.Millisecond),
		received,
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Fatalf("timestamp[%d] = %s, want %s", i, got[i], want[i])
		}
	}
}

func TestResolveUartBatchTimestampsUsesDeviceEpoch(t *testing.T) {
	received := time.Date(2026, 10, 30, 7, 18, 0, 0, time.UTC)
	deviceMs := received.Add(-time.Second).UnixMilli()
	entries := []uartBatchEntry{
		{TimestampMs: deviceMs},
		{TimestampMs: deviceMs + 100},
	}

	got := resolveUartBatchTimestamps(entries, received)
	if got[0].UnixMilli() != deviceMs || got[1].UnixMilli() != deviceMs+100 {
		t.Fatalf("unexpected timestamps: %v", got)
	}
}

func TestResolveUartBatchTimestampsKeepsLegacyEntriesDistinct(t *testing.T) {
	received := time.Date(2026, 10, 30, 7, 18, 0, 0, time.UTC)
	entries := []uartBatchEntry{{}, {}, {}}

	got := resolveUartBatchTimestamps(entries, received)
	if got[0].Equal(got[1]) || got[1].Equal(got[2]) {
		t.Fatalf("legacy batch timestamps must be distinct: %v", got)
	}
	if !got[2].Equal(received) {
		t.Fatalf("last timestamp = %s, want %s", got[2], received)
	}
}
