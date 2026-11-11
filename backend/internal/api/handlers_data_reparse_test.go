package api

import (
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestMissingParsedFieldsFilter(t *testing.T) {
	filter := missingParsedFieldsFilter()
	parts, ok := filter["$or"].([]bson.M)
	if !ok || len(parts) != 3 {
		t.Fatalf("unexpected missing filter: %#v", filter)
	}
	if _, ok := parts[0]["parsed_fields"]; !ok {
		t.Fatalf("expected parsed_fields condition: %#v", parts[0])
	}
}

func TestReparseBatchFilterPagination(t *testing.T) {
	base := bson.M{"board_id": "b"}
	if got := reparseBatchFilter(base, ""); got["board_id"] != "b" {
		t.Fatalf("base filter not returned: %#v", got)
	}
	filter := reparseBatchFilter(base, "last-id")
	and, ok := filter["$and"].([]bson.M)
	if !ok || len(and) != 2 {
		t.Fatalf("expected $and with base and cursor: %#v", filter)
	}
	if and[1]["_id"].(bson.M)["$gt"] != "last-id" {
		t.Fatalf("cursor missing: %#v", and[1])
	}
}
