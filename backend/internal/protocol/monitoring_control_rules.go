package protocol

import (
	_ "embed"
	"encoding/json"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/ruleparser"
)

// lcpMonitoringControlRulesJSON covers the 1-byte LEN envelope used by the
// field firmware: monitoring (0xCA) plus control RPC (0xCF/0xCD/0xCC/0xCE).
//
//go:embed lcp_monitoring_control_rules.json
var lcpMonitoringControlRulesJSON []byte

// DefaultMonitoringControlRules returns the combined monitoring/control rules.
func DefaultMonitoringControlRules() ruleparser.JsonRuleDocument {
	var doc ruleparser.JsonRuleDocument
	if err := json.Unmarshal(lcpMonitoringControlRulesJSON, &doc); err != nil {
		panic("lcp_monitoring_control_rules.json: " + err.Error())
	}
	return doc
}

// MonitoringControlProtocolSpec wraps the rules as a protocol spec (used by the
// command event extractor).
func MonitoringControlProtocolSpec() models.ProtocolSpec {
	rules := DefaultMonitoringControlRules()
	return models.ProtocolSpec{
		ID:          "lcp-monitoring-control",
		Name:        "LCP Monitoring + Control",
		Version:     "2.1",
		ParseRules:  &rules,
	}
}
