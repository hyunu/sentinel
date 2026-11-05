package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hyunu/sentinel/internal/models"
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
	// Hidden overlays stay in the config so the dashboard can enable them.
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
	// Reclassify CA as an event for this test; the default rules mark it as a
	// continuous series.
	spec.ParseRules.Meta["data_types"] = map[string]interface{}{"0xCA": "event"}
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

func overlayMeta(t *testing.T, spec *models.ProtocolSpec) []map[string]interface{} {
	t.Helper()
	raw, err := json.Marshal(spec.ParseRules.Meta["overlays"])
	if err != nil {
		t.Fatalf("marshal overlays: %v", err)
	}
	var overlays []map[string]interface{}
	if err := json.Unmarshal(raw, &overlays); err != nil {
		t.Fatalf("unmarshal overlays: %v", err)
	}
	return overlays
}

func TestSeriesClassificationSkipsOverlay(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	overlays := overlayMeta(t, &spec)
	overlays = append(overlays, map[string]interface{}{
		"fid": "0xCA", "type": "event", "visible": true, "kind": "monitor",
		"label": "fid {fid}",
		"fields": []interface{}{map[string]interface{}{"name": "fid", "path": "fid", "format": "int"}},
	})
	spec.ParseRules.Meta["overlays"] = overlays
	spec.ParseRules.Meta["data_types"] = map[string]interface{}{"0xCA": "series"}

	configs := overlayConfigsFromSpec(&spec)
	for _, cfg := range configs {
		if cfg.fidNum == 0xCA {
			t.Fatal("series-classified FID must not become an event overlay")
		}
	}
	if _, ok := commandEventFromFrame(time.Unix(0, 0).UTC(), "TX", commandTestCA, &spec, configs); ok {
		t.Fatal("series frame produced an event")
	}
}

func TestVisibleFlagIsExposedPerOverlay(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	overlays := overlayConfigsFromSpec(&spec)
	for _, overlay := range overlays {
		switch overlay.fidNum {
		case 0xCC:
			if overlay.Visible == nil || *overlay.Visible {
				t.Fatal("ACK should default to visible=false")
			}
		case 0xCF, 0xCD:
			if overlay.Visible != nil && !*overlay.Visible {
				t.Fatalf("FID 0x%02X should default to visible", overlay.fidNum)
			}
		}
	}
}

func TestEventFieldsUseProtocolEnumLabels(t *testing.T) {
	spec := protocol.MonitoringControlProtocolSpec()
	spec.ParseRules.Meta["enums"] = map[string]interface{}{
		"FunctionId": map[string]interface{}{"31": "탈수", "11": "헹굼"},
	}
	fields := collectEventFields(spec.ParseRules)
	if len(fields) != 4 {
		t.Fatalf("event fields: want 4 (CF + CD result/error/error_code), got %d: %+v", len(fields), fields)
	}
	enums := enumsFromMeta(spec.ParseRules.Meta)

	cf, err := protocol.Parse(commandTestCF, &spec)
	if err != nil {
		t.Fatalf("parse CF: %v", err)
	}
	cfSpecs := 0
	for _, field := range fields {
		if field.FID != 0xCF {
			continue
		}
		cfSpecs++
		values := extractEventValues(cf.Fields, field.Path)
		if len(values) != 1 {
			t.Fatalf("CF values at %s: %v", field.Path, values)
		}
		if got := renderEventLabel(field, values[0], enums); got != "탈수" {
			t.Fatalf("CF label: want 탈수, got %q", got)
		}
	}
	if cfSpecs != 1 {
		t.Fatalf("CF event fields: want 1, got %d", cfSpecs)
	}

	cd, err := protocol.Parse(commandTestCD, &spec)
	if err != nil {
		t.Fatalf("parse CD: %v", err)
	}
	cdCount := 0
	for _, field := range fields {
		if field.FID != 0xCD {
			continue
		}
		for _, value := range extractEventValues(cd.Fields, field.Path) {
			cdCount++
			if got := renderEventLabel(field, value, enums); got != "헹굼" {
				t.Fatalf("CD label: want 헹굼, got %q", got)
			}
		}
	}
	if cdCount != 1 {
		t.Fatalf("CD event values: want 1, got %d", cdCount)
	}
}
