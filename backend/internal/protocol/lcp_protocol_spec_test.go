package protocol

import "testing"

func TestLCPProtocolSpecIdentity(t *testing.T) {
	spec := DefaultLCPProtocolSpec(LCPProtocolID)

	if spec.ID != LCPProtocolID {
		t.Fatalf("ID: want %s, got %s", LCPProtocolID, spec.ID)
	}
	if spec.Name != LCPProtocolName {
		t.Fatalf("Name: want %s, got %s", LCPProtocolName, spec.Name)
	}
	if spec.Version != "2.0" {
		t.Fatalf("Version: want 2.0, got %s", spec.Version)
	}
	if spec.ParseRules == nil || len(spec.ParseRules.Fields) == 0 {
		t.Fatal("ParseRules: expected embedded LCP/OSP rules")
	}
	if LCPProtocolName == LCPProtocolLegacyName {
		t.Fatal("canonical and legacy names must differ so legacy documents can be migrated")
	}
}
