package api

import (
	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/ruleparser"
)

// extractEnumsFromParseRules removes the legacy _meta.enums block from a
// parse_rules document and returns it. New protocols store enums on the
// protocol itself, but existing documents still carry the old location.
func extractEnumsFromParseRules(rules *ruleparser.JsonRuleDocument) map[string]map[string]string {
	if rules == nil || rules.Meta == nil {
		return nil
	}
	enums := enumsFromMeta(rules.Meta)
	delete(rules.Meta, "enums")
	if len(rules.Meta) == 0 {
		rules.Meta = nil
	}
	if len(enums) == 0 {
		return nil
	}
	return enums
}

// normalizeProtocolEnums moves legacy enums out of parse_rules before saving.
func normalizeProtocolEnums(protocol *models.ProtocolSpec) {
	if protocol == nil {
		return
	}
	legacy := extractEnumsFromParseRules(protocol.ParseRules)
	if len(protocol.Enums) == 0 && len(legacy) > 0 {
		protocol.Enums = legacy
	}
}

// hydrateProtocolEnums exposes top-level enums for old database documents
// without requiring a migration. The response never includes _meta.enums.
func hydrateProtocolEnums(protocol *models.ProtocolSpec) {
	if protocol == nil {
		return
	}
	legacy := extractEnumsFromParseRules(protocol.ParseRules)
	if len(protocol.Enums) == 0 && len(legacy) > 0 {
		protocol.Enums = legacy
	}
	if len(protocol.Enums) == 0 {
		protocol.Enums = nil
	}
}

// enumsForProtocol resolves enums for display/command formatting, preferring
// the separated top-level map and falling back to legacy _meta.enums.
func enumsForProtocol(spec *models.ProtocolSpec) map[string]map[string]string {
	if spec == nil {
		return nil
	}
	if len(spec.Enums) > 0 {
		return spec.Enums
	}
	if spec.ParseRules == nil {
		return nil
	}
	return enumsFromMeta(spec.ParseRules.Meta)
}
