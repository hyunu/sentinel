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
		Name:        "LCP/OSP RPC Protocol",
		Version:     "2.0",
		Description: "LCP↔OSP UART: AA [LEN:2] FID SEQ:2 ATTR PAYLOAD CRC16 BB — FID C7/C8/C9/CA/CC/CD/CE/CF 전체",
		ParseRules:  &rules,
	}
}
