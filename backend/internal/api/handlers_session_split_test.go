package api

import (
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

func TestSessionRuleMatches(t *testing.T) {
	parsed := map[string]interface{}{
		"fid":                           207,
		"payload.functions.function_id": 24,
		"payload.monitor_flag":          1,
	}

	rule := models.SessionSplitRule{
		Enabled:   true,
		FID:       "0xCF",
		Direction: "RX",
		Field:     "payload.functions.function_id",
		Operator:  "eq",
		Value:     "24",
	}
	if !sessionRuleMatches(rule, parsed, "RX") {
		t.Fatal("expected rule to match")
	}
	if sessionRuleMatches(rule, parsed, "TX") {
		t.Fatal("direction mismatch must not match")
	}
	rule.Value = "25"
	if sessionRuleMatches(rule, parsed, "RX") {
		t.Fatal("value mismatch must not match")
	}
}

func TestSessionRuleMatchesNumericAndExists(t *testing.T) {
	parsed := map[string]interface{}{"fid": 207, "payload.value": 10}
	rule := models.SessionSplitRule{
		Enabled:  true,
		FID:      "0xCF",
		Field:    "payload.value",
		Operator: "gt",
		Value:    "9",
	}
	if !sessionRuleMatches(rule, parsed, "") {
		t.Fatal("expected numeric gt match")
	}
	rule.Field = "payload.missing"
	rule.Operator = "exists"
	if sessionRuleMatches(rule, parsed, "") {
		t.Fatal("missing field must not satisfy exists")
	}
}

func TestCompareSessionValue(t *testing.T) {
	if compareSessionValue("010", "10") != 0 {
		t.Fatal("numeric values should compare numerically")
	}
	if compareSessionValue("abc", "abd") >= 0 {
		t.Fatal("strings should compare lexically")
	}
}

func ts(minute int) time.Time {
	return time.Date(2026, 11, 11, 0, minute, 0, 0, time.UTC)
}

func TestSessionRangesFromMatches(t *testing.T) {
	matches := []sessionRuleMatch{
		{TS: ts(1), Role: "start"},
		{TS: ts(5), Role: "end"},
		{TS: ts(8), Role: "start"},
		{TS: ts(12), Role: "end"},
	}
	ranges, unclosed := sessionRangesFromMatches(matches)
	if len(ranges) != 2 {
		t.Fatalf("expected 2 ranges, got %d", len(ranges))
	}
	if !ranges[0].Start.Equal(ts(1)) || !ranges[0].End.Equal(ts(5)) {
		t.Fatalf("unexpected first range: %+v", ranges[0])
	}
	if !ranges[1].Start.Equal(ts(8)) || !ranges[1].End.Equal(ts(12)) {
		t.Fatalf("unexpected second range: %+v", ranges[1])
	}
	if unclosed != 0 {
		t.Fatalf("expected no unclosed starts, got %d", unclosed)
	}
}

func TestSessionRangesFromMatchesIgnoresRepeatedStarts(t *testing.T) {
	matches := []sessionRuleMatch{
		{TS: ts(1), Role: "start"},
		{TS: ts(2), Role: "start"},
		{TS: ts(4), Role: "end"},
	}
	ranges, _ := sessionRangesFromMatches(matches)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d", len(ranges))
	}
	if !ranges[0].Start.Equal(ts(1)) {
		t.Fatalf("first start should win, got %+v", ranges[0])
	}
}

func TestSessionRangesFromMatchesIgnoresEndWithoutStart(t *testing.T) {
	matches := []sessionRuleMatch{
		{TS: ts(1), Role: "end"},
		{TS: ts(2), Role: "start"},
		{TS: ts(3), Role: "end"},
	}
	ranges, unclosed := sessionRangesFromMatches(matches)
	if len(ranges) != 1 || !ranges[0].Start.Equal(ts(2)) || !ranges[0].End.Equal(ts(3)) {
		t.Fatalf("unexpected ranges: %+v", ranges)
	}
	if unclosed != 0 {
		t.Fatalf("expected no unclosed starts, got %d", unclosed)
	}
}

func TestSessionRangesFromMatchesReportsUnclosedStart(t *testing.T) {
	matches := []sessionRuleMatch{
		{TS: ts(1), Role: "start"},
		{TS: ts(2), Role: "end"},
		{TS: ts(5), Role: "start"},
	}
	ranges, unclosed := sessionRangesFromMatches(matches)
	if len(ranges) != 1 {
		t.Fatalf("expected 1 range, got %d", len(ranges))
	}
	if unclosed != 1 {
		t.Fatalf("expected 1 unclosed start, got %d", unclosed)
	}
}
