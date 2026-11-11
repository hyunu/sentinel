package api

import (
	"testing"

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
