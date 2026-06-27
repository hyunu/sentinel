package protocol

import (
	"strings"
	"testing"

	"github.com/hyunu/sentinel/internal/models"
)

func TestTaggedRepeatMultipleFlags(t *testing.T) {
	// FA|03|01 02 03  FB|02|AA BB
	data := []byte{
		0xFA, 0x03, 0x01, 0x02, 0x03,
		0xFB, 0x02, 0xAA, 0xBB,
	}
	fields := []models.FieldSpec{{
		Name:         "blocks",
		Type:         "tagged_repeat",
		TaggedUntil:  "no_matching_flag",
		Fields: []models.FieldSpec{
			{Flag: "FA", Name: "argument", Fields: []models.FieldSpec{
				{Name: "type_id", Length: 1, Type: "uint8"},
				{Name: "payload", Type: "raw", Length: 0, Repeat: "until_end"},
			}},
			{Flag: "FB", Name: "metadata", Fields: []models.FieldSpec{
				{Name: "meta_a", Length: 1, Type: "uint8"},
				{Name: "meta_b", Length: 1, Type: "uint8"},
			}},
		},
	}}

	parsed, _, err := ParseFieldsSequential(data, fields)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	blocks, ok := parsed["blocks"].([]map[string]interface{})
	if !ok {
		t.Fatalf("blocks type: %T", parsed["blocks"])
	}
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}
	if blocks[0]["flag"] != "FA" || blocks[1]["flag"] != "FB" {
		t.Fatalf("flags: %#v", blocks)
	}
	if blocks[1]["meta_a"].(uint64) != 0xAA {
		t.Fatalf("meta_a: %#v", blocks[1]["meta_a"])
	}
}

func TestDispatchOnTypeID(t *testing.T) {
	// type_id=0x01, value=uint16 0x1234
	data := []byte{0x01, 0x34, 0x12}
	fields := []models.FieldSpec{
		{Name: "type_id", Length: 1, Type: "uint8"},
		{
			Name:       "value",
			Type:       "dispatch",
			DispatchOn: "type_id",
			DispatchVariants: map[string][]models.FieldSpec{
				"01": {{Name: "value", Length: 2, Type: "uint16", Endian: "little"}},
			},
		},
	}
	parsed, _, err := ParseFieldsSequential(data, fields)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	val, ok := parsed["value"].(uint64)
	if !ok || val != 0x1234 {
		t.Fatalf("value: %#v", parsed["value"])
	}
}

func TestLCPCFPayloadSchema(t *testing.T) {
	// function_id=0x0100 LE, FA|03|01 34 12, FB|01|42
	payload := []byte{
		0x00, 0x01,
		0xFA, 0x03, 0x01, 0x34, 0x12,
		0xFB, 0x01, 0x42,
	}
	parsed, _, err := ParseFieldsSequential(payload, lcpCFPayloadFields())
	if err != nil {
		t.Fatalf("parse CF: %v", err)
	}
	blocks, ok := parsed["blocks"].([]map[string]interface{})
	if !ok || len(blocks) != 2 {
		t.Fatalf("blocks: %#v", parsed["blocks"])
	}
	if blocks[0]["type_id"].(uint64) != 1 {
		t.Fatalf("type_id: %#v", blocks[0]["type_id"])
	}
	if blocks[0]["value"].(uint64) != 0x1234 {
		t.Fatalf("value: %#v", blocks[0]["value"])
	}
	if blocks[1]["meta_key"].(uint64) != 0x42 {
		t.Fatalf("meta_key: %#v", blocks[1]["meta_key"])
	}
}

func TestFABlockVariableValueLength(t *testing.T) {
	// FA block: len=5, body = type_id(1) + 4-byte unknown value
	payload := []byte{
		0x00, 0x01,
		0xFA, 0x05, 0x99, 0xDE, 0xAD, 0xBE, 0xEF,
	}
	parsed, _, err := ParseFieldsSequential(payload, lcpCFPayloadFields())
	if err != nil {
		t.Fatalf("parse CF: %v", err)
	}
	blocks, ok := parsed["blocks"].([]map[string]interface{})
	if !ok || len(blocks) != 1 {
		t.Fatalf("blocks: %#v", parsed["blocks"])
	}
	if blocks[0]["type_id"].(uint64) != 0x99 {
		t.Fatalf("type_id: %#v", blocks[0]["type_id"])
	}
	raw, ok := blocks[0]["value"].(string)
	if !ok || strings.ToUpper(raw) != "DEADBEEF" {
		t.Fatalf("value raw: %#v", blocks[0]["value"])
	}
}

func TestFABlockBoundedDoesNotBleed(t *testing.T) {
	// FA|03|01 34 12 then trailing garbage must not be consumed by FA body
	data := []byte{
		0xFA, 0x03, 0x01, 0x34, 0x12,
		0xFF, 0xFF,
	}
	fields := []models.FieldSpec{{
		Name:        "blocks",
		Type:        "tagged_repeat",
		TaggedUntil: "no_matching_flag",
		Fields: []models.FieldSpec{
			{Flag: "FA", Name: "argument", Fields: lcpArgumentBlockFields()},
		},
	}}
	parsed, n, err := ParseFieldsSequential(data, fields)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	blocks := parsed["blocks"].([]map[string]interface{})
	if blocks[0]["value"].(uint64) != 0x1234 {
		t.Fatalf("value: %#v", blocks[0]["value"])
	}
	if n != 5 {
		t.Fatalf("consumed %d bytes, want 5 (trailing FF FF untouched)", n)
	}
}

func TestStructNesting(t *testing.T) {
	data := []byte{0x01, 0x02}
	fields := []models.FieldSpec{{
		Name: "outer",
		Type: "struct",
		Fields: []models.FieldSpec{
			{Name: "a", Length: 1, Type: "uint8"},
			{Name: "b", Length: 1, Type: "uint8"},
		},
	}}
	parsed, _, err := ParseFieldsSequential(data, fields)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	outer, ok := parsed["outer"].(map[string]interface{})
	if !ok {
		t.Fatalf("outer: %T", parsed["outer"])
	}
	if outer["a"].(uint64) != 1 || outer["b"].(uint64) != 2 {
		t.Fatalf("outer: %#v", outer)
	}
}

func TestLegacyFunctionArgsCompat(t *testing.T) {
	data := []byte{0xFA, 0x02, 0x01, 0xFF}
	fields := []models.FieldSpec{{
		Name: "arguments",
		Type: "function_args",
		Fields: []models.FieldSpec{{
			Flag: "FA", Name: "argument", Fields: []models.FieldSpec{
				{Name: "type_id", Length: 1, Type: "uint8"},
				{Name: "value", Type: "raw", Length: 0, Repeat: "until_end"},
			},
		}},
	}}
	parsed, _, err := ParseFieldsSequential(data, fields)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	args, ok := parsed["arguments"].([]map[string]interface{})
	if !ok || len(args) != 1 {
		t.Fatalf("arguments: %#v", parsed["arguments"])
	}
}
