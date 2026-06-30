package ruleparser

import (
	"testing"
)

func TestParseFromJSONVarBytesLenExpr(t *testing.T) {
	rules := `{
		"fields": [
			{"name": "len", "type": "U8"},
			{"name": "val", "type": "VarBytes", "length_from": {"expr": "len - 2"}}
		]
	}`
	data := []byte{0x04, 0xDE, 0xAD}
	out, err := ParseFromJSON(rules, data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if out["len"].(int) != 4 {
		t.Fatalf("len: %#v", out["len"])
	}
	if len(out["val"].([]byte)) != 2 {
		t.Fatalf("val: %#v", out["val"])
	}
}

func TestParseFromJSONDocumentWithMeta(t *testing.T) {
	rules := `{
		"_meta": {"name": "test"},
		"fields": [
			{"name": "x", "type": "U8"}
		]
	}`
	out, err := ParseFromJSON(rules, []byte{0x42})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if out["x"].(int) != 0x42 {
		t.Fatalf("x: %#v", out["x"])
	}
}

func TestValidateExpr(t *testing.T) {
	rules := `{
		"fields": [
			{
				"name": "stx",
				"type": "Validate",
				"inner": {"type": "U8"},
				"validate_expr": "value == 0xAA"
			}
		]
	}`
	if _, err := ParseFromJSON(rules, []byte{0xBB}); err == nil {
		t.Fatal("expected validation error")
	}
	out, err := ParseFromJSON(rules, []byte{0xAA})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if out["stx"].(int) != 0xAA {
		t.Fatalf("stx: %#v", out["stx"])
	}
}

func TestOptionalPredicate(t *testing.T) {
	rules := `{
		"fields": [
			{"name": "flag", "type": "U8"},
			{
				"name": "error",
				"type": "Optional",
				"predicate": {"expr": "flag == 0xFE"},
				"rules": [{"name": "err_code", "type": "U8"}]
			}
		]
	}`
	out, err := ParseFromJSON(rules, []byte{0xFE, 0x07})
	if err != nil {
		t.Fatalf("parse FE: %v", err)
	}
	errBlock, ok := out["error"].(map[string]interface{})
	if !ok || errBlock["err_code"].(int) != 7 {
		t.Fatalf("error: %#v", out["error"])
	}

	out2, err := ParseFromJSON(rules, []byte{0xFD})
	if err != nil {
		t.Fatalf("parse FD: %v", err)
	}
	if _, ok := out2["error"]; ok {
		t.Fatalf("unexpected error field: %#v", out2)
	}
}
