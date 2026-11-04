package models

import (
	"encoding/json"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func floatPtr(v float64) *float64 { return &v }

// A fixed Y axis minimum of 0 is a valid setting (and the common case for
// counters). The old float64+omitempty fields dropped it, so saved profiles
// silently reverted to the auto range after a reload.
func TestYAxisZeroBoundsSurviveJSONRoundTrip(t *testing.T) {
	cfg := YAxisConfig{ID: "y-left", Label: "Left", Min: floatPtr(0), Max: floatPtr(10)}

	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if min, ok := decoded["min"]; !ok || min != float64(0) {
		t.Fatalf("min 0 missing from JSON: %s", raw)
	}
	if max, ok := decoded["max"]; !ok || max != float64(10) {
		t.Fatalf("max 10 missing from JSON: %s", raw)
	}

	// An axis with no bounds must stay unset instead of becoming 0.
	unset, err := json.Marshal(YAxisConfig{ID: "y-left", Label: "Left"})
	if err != nil {
		t.Fatalf("marshal unset: %v", err)
	}
	var unsetMap map[string]interface{}
	if err := json.Unmarshal(unset, &unsetMap); err != nil {
		t.Fatalf("unmarshal unset: %v", err)
	}
	if _, ok := unsetMap["min"]; ok {
		t.Fatalf("unset min should be omitted: %s", unset)
	}
}

func TestYAxisZeroBoundsSurviveBSONRoundTrip(t *testing.T) {
	item := VizItem{
		ID:    "item-1",
		Label: "Counter",
		YAxis: YAxisConfig{ID: "y-left", Label: "Left", Min: floatPtr(0), Max: floatPtr(1)},
	}

	raw, err := bson.Marshal(item)
	if err != nil {
		t.Fatalf("bson marshal: %v", err)
	}
	var decoded VizItem
	if err := bson.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("bson unmarshal: %v", err)
	}

	if decoded.YAxis.Min == nil || *decoded.YAxis.Min != 0 {
		t.Fatalf("BSON min 0 was not preserved: %+v", decoded.YAxis.Min)
	}
	if decoded.YAxis.Max == nil || *decoded.YAxis.Max != 1 {
		t.Fatalf("BSON max 1 was not preserved: %+v", decoded.YAxis.Max)
	}
}
