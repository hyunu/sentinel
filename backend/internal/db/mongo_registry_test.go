package db

import (
	"reflect"
	"testing"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/protocol"
	"github.com/hyunu/sentinel/internal/ruleparser"
	"go.mongodb.org/mongo-driver/bson"
)

// Real capture: 129-byte FID 0xCA (data dump) frame from
// tools/exodus_uart_test/LCP_TEST_M8_2026-06-22_17-29-45.CSV.
const captureCADumpHex = `
AA 00 81 CA 07 1B 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 80 0C 00 00 00 00 00 00 00 00 00
00 12 02 12 02 01 01 7D 0A 64 00 00 00 00 01 00 00 01 23 01 2B 01 1B 01 00 27 19 1A 21 21 27 19
27 19 19 00 00 01 00 01 00 00 00 00 00 00 07 00 01 01 00 01 00 00 02 00 00 16 0D 1D 0D 16 0D 95
06 2C 00 01 00 97 06 00 00 00 00 59 C1 D0 01 F0 8F 01 21 C2 D0 01 55 D3 2A 23 02 01 1F 00 C6 24
BB
`

// Protocol specs are stored in MongoDB and decoded back before parsing. Embedded
// rule values (such as {"expr": "length - 10"}) must survive that round trip as
// maps; decoding them into bson.D made the rule engine fall back to a plain field
// reference and dropped every FID 0xCA payload.
func TestMongoRegistryKeepsRuleExpressions(t *testing.T) {
	spec := protocol.DefaultLCPProtocolSpec(protocol.LCPProtocolID)

	raw, err := bson.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal protocol spec: %v", err)
	}

	var decoded models.ProtocolSpec
	if err := bson.UnmarshalWithRegistry(mongoRegistry(), raw, &decoded); err != nil {
		t.Fatalf("unmarshal protocol spec: %v", err)
	}

	if decoded.ParseRules == nil || len(decoded.ParseRules.Fields) == 0 {
		t.Fatal("decoded parse_rules are empty")
	}

	findDumpLengthExpr(t, decoded.ParseRules)

	result, err := protocol.Parse(captureCADumpHex, &decoded)
	if err != nil {
		t.Fatalf("parse 0xCA capture: %v", err)
	}
	if result.FID != "CA" {
		t.Fatalf("FID: want CA, got %s", result.FID)
	}
	dump, ok := result.Fields["payload.dump"]
	if !ok {
		t.Fatalf("payload.dump field missing (fields=%v)", result.Fields)
	}
	// Frame length 129 minus the AA/LEN/FID/SEQ/ATTR/CRC/BB envelope (10) = 119 bytes.
	if got := len(dump.(string)); got != 119*2 {
		t.Fatalf("payload.dump hex length: want %d, got %d", 119*2, got)
	}
}

func findDumpLengthExpr(t *testing.T, doc *ruleparser.JsonRuleDocument) map[string]interface{} {
	t.Helper()
	for _, field := range doc.Fields {
		if field.Name != "payload" {
			continue
		}
		for _, caseFields := range field.Cases {
			for _, sub := range caseFields {
				if sub.Name != "dump" {
					continue
				}
				rv := reflect.ValueOf(sub.LengthFrom)
				if rv.Kind() != reflect.Map {
					t.Fatalf("dump.length_from decoded as %T (%v), want a map", sub.LengthFrom, sub.LengthFrom)
				}
				return nil
			}
		}
	}
	t.Fatal("dump LengthFrom not found in payload cases")
	return nil
}
