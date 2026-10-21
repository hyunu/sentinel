package db

import (
	"testing"

	"github.com/hyunu/sentinel/internal/protocol"
	"go.mongodb.org/mongo-driver/bson"
)

func TestLCPProtocolMatchFilterCoversStableIDAndNames(t *testing.T) {
	filter := lcpProtocolMatchFilter(protocol.LCPProtocolName)

	or, ok := filter["$or"].([]bson.M)
	if !ok {
		t.Fatalf("$or: want []bson.M, got %T", filter["$or"])
	}
	if len(or) != 3 {
		t.Fatalf("$or: want 3 clauses, got %d (%v)", len(or), or)
	}

	var ids, names []string
	for _, clause := range or {
		if id, ok := clause["_id"].(string); ok {
			ids = append(ids, id)
		}
		if name, ok := clause["name"].(string); ok {
			names = append(names, name)
		}
	}

	if len(ids) != 1 || ids[0] != protocol.LCPProtocolID {
		t.Fatalf("_id clauses: want [%s], got %v", protocol.LCPProtocolID, ids)
	}
	if len(names) != 2 {
		t.Fatalf("name clauses: want canonical and legacy names, got %v", names)
	}
	wantNames := map[string]bool{
		protocol.LCPProtocolName:       true,
		protocol.LCPProtocolLegacyName: true,
	}
	for _, name := range names {
		if !wantNames[name] {
			t.Fatalf("unexpected name clause %q (want %v)", name, wantNames)
		}
		delete(wantNames, name)
	}
	if len(wantNames) != 0 {
		t.Fatalf("missing name clauses: %v", wantNames)
	}
}
