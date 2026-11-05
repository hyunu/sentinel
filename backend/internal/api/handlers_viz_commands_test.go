package api

import (
	"strings"
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/protocol"
)

const (
	commandTestCF = "AA23CF04AC01F80F04F00101F00102F00102F0010501FB0A1F01FA061C000A12D659BB"
	commandTestCD = "AA0DCD09550101FD030BCB79BB"
	commandTestCC = "AA0BCC0AE402CEF055F8BB"
	commandTestCA = "AA8ACACA4400010101010101000000000401020001000101010000800C000060070000000000008F00F71100000000500000000001000101320137011A01012215301A30302022154C00000000002A01011500000700030300010000020014100E000000000000000000000000000000D9080200000059C1D00189DE0121C2D001B9D5159B030105E2BB"
)

func TestOverlayConfigDrivesFIDs(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	overlays := overlayConfigsFromSpec(&spec)
	if len(overlays) != 3 {
		t.Fatalf("overlays: want 3, got %d", len(overlays))
	}

	re := overlayFIDRegexp(overlays)
	for _, fid := range []string{"CF", "CD", "CC"} {
		if !strings.Contains(re, fid) {
			t.Fatalf("regex %q missing FID %s", re, fid)
		}
	}
}

func TestCommandEventLabelsComeFromConfig(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	overlays := overlayConfigsFromSpec(&spec)
	ts := time.Unix(0, 0).UTC()

	cases := []struct {
		name    string
		frame   string
		kind    string
		summary string
	}{
		{"call", commandTestCF, "call", "fn 31"},
		{"result", commandTestCD, "result", "res 11"},
		{"ack", commandTestCC, "ack", "ack 0xCE"},
	}
	for _, tc := range cases {
		event, ok := commandEventFromFrame(ts, "RX", tc.frame, &spec, overlays)
		if !ok {
			t.Fatalf("%s: event not produced", tc.name)
		}
		if event.Kind != tc.kind || event.Summary != tc.summary {
			t.Fatalf("%s: got kind=%q summary=%q", tc.name, event.Kind, event.Summary)
		}
		if event.Color == "" {
			t.Fatalf("%s: color not taken from config", tc.name)
		}
	}
}

// A FID that is not part of the built-in overlays becomes an event only because
// the protocol says so; no FID list lives in the handler.
func TestCommandEventUsesCustomProtocolOverlay(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	spec.ParseRules.Meta["overlays"] = []interface{}{
		map[string]interface{}{
			"fid":    "0xCA",
			"kind":   "monitor",
			"label":  "fid {fid}",
			"color":  "#123456",
			"style":  "vline",
			"fields": []interface{}{map[string]interface{}{"name": "fid", "path": "fid", "format": "int"}},
		},
	}
	overlays := overlayConfigsFromSpec(&spec)
	event, ok := commandEventFromFrame(time.Unix(0, 0).UTC(), "TX", commandTestCA, &spec, overlays)
	if !ok {
		t.Fatal("custom overlay for CA did not produce an event")
	}
	if event.Kind != "monitor" || event.Summary != "fid 202" || event.Color != "#123456" {
		t.Fatalf("custom overlay: %+v", event)
	}
	if !strings.Contains(overlayFIDRegexp(overlays), "CA") {
		t.Fatalf("regex not derived from config: %s", overlayFIDRegexp(overlays))
	}
}
