package api

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/hyunu/sentinel/internal/ruleparser"
)

// eventFieldSpec is derived from the protocol parse rules: any field whose
// "display" is "event" becomes a chart marker. The value is interpreted via the
// field's enum (defined in _meta.enums).
type eventFieldSpec struct {
	FID   int
	Path  string
	Field string
	Enum  string
	Label string
}

func collectEventFields(doc *ruleparser.JsonRuleDocument) []eventFieldSpec {
	if doc == nil {
		return nil
	}
	var out []eventFieldSpec
	for _, field := range doc.Fields {
		if field.Type != "Switch" || field.KeyFrom != "fid" {
			continue
		}
		for key, rules := range field.Cases {
			fid, err := strconv.Atoi(strings.TrimSpace(key))
			if err != nil {
				continue
			}
			walkEventFields(rules, field.Name, fid, &out)
		}
	}
	return out
}

func walkEventFields(rules []ruleparser.JsonFieldRule, prefix string, fid int, out *[]eventFieldSpec) {
	for _, rule := range rules {
		path := prefix + "." + rule.Name
		if rule.Display == "event" {
			*out = append(*out, eventFieldSpec{
				FID:   fid,
				Path:  path,
				Field: rule.Name,
				Enum:  rule.Enum,
				Label: rule.EventLabel,
			})
		}
		switch rule.Type {
		case "RepeatCount", "RepeatUntil", "RepeatWhile", "RepeatEach":
			walkEventFields(rule.ItemRules, path+"[]", fid, out)
		case "Optional", "If":
			walkEventFields(rule.Rules, path, fid, out)
			walkEventFields(rule.Then, path, fid, out)
			walkEventFields(rule.Else, path, fid, out)
		case "Switch":
			for _, caseRules := range rule.Cases {
				walkEventFields(caseRules, path, fid, out)
			}
			walkEventFields(rule.Default, path, fid, out)
		case "Struct":
			walkEventFields(rule.FieldsDef, path, fid, out)
		}
	}
}

func enumsFromMeta(meta map[string]interface{}) map[string]map[string]string {
	out := make(map[string]map[string]string)
	raw, ok := meta["enums"]
	if !ok {
		return out
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return out
	}
	var parsed map[string]map[string]string
	if err := json.Unmarshal(data, &parsed); err != nil {
		return out
	}
	return parsed
}

// extractEventValues resolves a rule path such as
// "payload.functions[].function_id" against flattened parse results.
func extractEventValues(fields map[string]interface{}, path string) []interface{} {
	if fields == nil {
		return nil
	}
	idx := strings.Index(path, "[]")
	if idx < 0 {
		if value := getPath(fields, path); value != nil {
			return []interface{}{value}
		}
		return nil
	}
	root := path[:idx]
	rest := strings.TrimPrefix(path[idx+2:], ".")
	items := asSlice(getPath(fields, root))
	if len(items) == 0 {
		return nil
	}
	values := make([]interface{}, 0, len(items))
	for _, item := range items {
		row, ok := asMap(item)
		if !ok {
			continue
		}
		if rest == "" {
			values = append(values, row)
			continue
		}
		if value := getPath(row, rest); value != nil {
			values = append(values, value)
		}
	}
	return values
}

func renderEventLabel(spec eventFieldSpec, value interface{}, enums map[string]map[string]string) string {
	raw := fmt.Sprintf("%v", value)
	enumText := raw
	if spec.Enum != "" {
		if mapping, ok := enums[spec.Enum]; ok {
			if label, ok := mapping[raw]; ok {
				enumText = label
			}
		}
	}
	template := spec.Label
	if template == "" {
		template = "{enum}"
	}
	out := strings.ReplaceAll(template, "{enum}", enumText)
	out = strings.ReplaceAll(out, "{value}", raw)
	out = strings.ReplaceAll(out, "{field}", spec.Field)
	return out
}
