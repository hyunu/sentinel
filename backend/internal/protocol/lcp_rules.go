package protocol

import (
	_ "embed"
	"encoding/json"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/ruleparser"
)

//go:embed lcp_osp_rules.json
var lcpOSPRulesJSON []byte

func DefaultLCPParseRules() ruleparser.JsonRuleDocument {
	var doc ruleparser.JsonRuleDocument
	if err := json.Unmarshal(lcpOSPRulesJSON, &doc); err != nil {
		panic("lcp_osp_rules.json: " + err.Error())
	}
	return doc
}

func DefaultLCPProtocolSpec(id string) models.ProtocolSpec {
	rules := DefaultLCPParseRules()
	return models.ProtocolSpec{
		ID:          id,
		Name:        "LCP Protocol",
		Version:     "1.0",
		Description: "LCP↔OSP UART: AA [LEN] FID SEQ ATTR PAYLOAD CRC16 BB — CF(207) / CD(205)",
		ParseRules:  &rules,
	}
}
