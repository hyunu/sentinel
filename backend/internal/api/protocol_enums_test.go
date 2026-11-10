package api

import (
	"testing"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/ruleparser"
)

func TestNormalizeProtocolEnumsMovesLegacyMeta(t *testing.T) {
	rules := &ruleparser.JsonRuleDocument{
		Meta: map[string]interface{}{
			"enums": map[string]interface{}{
				"OnOff": map[string]interface{}{"0": "OFF", "1": "ON"},
			},
			"function_args": map[string]interface{}{"0": map[string]interface{}{"enum": "OnOff"}},
		},
	}
	spec := &models.ProtocolSpec{ParseRules: rules}

	normalizeProtocolEnums(spec)

	if got := spec.Enums["OnOff"]["1"]; got != "ON" {
		t.Fatalf("top-level enums not populated: %#v", spec.Enums)
	}
	if _, ok := rules.Meta["enums"]; ok {
		t.Fatal("legacy _meta.enums must be removed from parse_rules")
	}
	if _, ok := rules.Meta["function_args"]; !ok {
		t.Fatal("other _meta entries must be preserved")
	}
}

func TestNormalizeProtocolEnumsKeepsTopLevel(t *testing.T) {
	rules := &ruleparser.JsonRuleDocument{
		Meta: map[string]interface{}{
			"enums": map[string]interface{}{"Legacy": map[string]interface{}{"0": "old"}},
		},
	}
	spec := &models.ProtocolSpec{
		ParseRules: rules,
		Enums:      map[string]map[string]string{"Top": {"0": "new"}},
	}

	normalizeProtocolEnums(spec)

	if got := spec.Enums["Top"]["0"]; got != "new" {
		t.Fatalf("top-level enums changed: %#v", spec.Enums)
	}
	if _, ok := spec.Enums["Legacy"]; ok {
		t.Fatalf("legacy enums should not override top-level: %#v", spec.Enums)
	}
}

func TestHydrateProtocolEnumsFromLegacy(t *testing.T) {
	spec := &models.ProtocolSpec{
		ParseRules: &ruleparser.JsonRuleDocument{
			Meta: map[string]interface{}{
				"enums": map[string]interface{}{
					"ResultCode": map[string]interface{}{"1": "수락"},
				},
			},
		},
	}

	hydrateProtocolEnums(spec)

	if got := spec.Enums["ResultCode"]["1"]; got != "수락" {
		t.Fatalf("hydrated enums = %#v", spec.Enums)
	}
	if spec.ParseRules.Meta != nil {
		t.Fatalf("legacy meta should be cleared in response: %#v", spec.ParseRules.Meta)
	}
}

func TestEnumsForProtocolPrefersTopLevel(t *testing.T) {
	spec := &models.ProtocolSpec{
		Enums: map[string]map[string]string{"Top": {"0": "a"}},
		ParseRules: &ruleparser.JsonRuleDocument{
			Meta: map[string]interface{}{
				"enums": map[string]interface{}{"Legacy": map[string]interface{}{"0": "b"}},
			},
		},
	}

	enums := enumsForProtocol(spec)
	if got := enums["Top"]["0"]; got != "a" {
		t.Fatalf("expected top-level enum, got %#v", enums)
	}
	if _, ok := enums["Legacy"]; ok {
		t.Fatalf("legacy fallback should not be used when top-level exists: %#v", enums)
	}
}
