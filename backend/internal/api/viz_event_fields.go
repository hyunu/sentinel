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

type eventEntry struct {
	Value interface{}
	Row   map[string]interface{}
}

type functionArgSpec struct {
	Arg    int    `json:"arg"`
	Enum   string `json:"enum,omitempty"`
	Format string `json:"format,omitempty"`
	Suffix string `json:"suffix,omitempty"`
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
	entries := extractEventEntries(fields, path)
	values := make([]interface{}, 0, len(entries))
	for _, entry := range entries {
		values = append(values, entry.Value)
	}
	return values
}

func extractEventEntries(fields map[string]interface{}, path string) []eventEntry {
	if fields == nil {
		return nil
	}
	idx := strings.Index(path, "[]")
	if idx < 0 {
		if value := getPath(fields, path); value != nil {
			return []eventEntry{{Value: value}}
		}
		return nil
	}
	root := path[:idx]
	rest := strings.TrimPrefix(path[idx+2:], ".")
	items := asSlice(getPath(fields, root))
	if len(items) == 0 {
		return nil
	}
	entries := make([]eventEntry, 0, len(items))
	for _, item := range items {
		row, ok := asMap(item)
		if !ok {
			continue
		}
		if rest == "" {
			entries = append(entries, eventEntry{Value: row, Row: row})
			continue
		}
		if value := getPath(row, rest); value != nil {
			entries = append(entries, eventEntry{Value: value, Row: row})
		}
	}
	return entries
}

func functionArgsFromMeta(meta map[string]interface{}) map[int]functionArgSpec {
	out := make(map[int]functionArgSpec)
	raw, ok := meta["function_args"]
	if !ok {
		return out
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return out
	}
	var parsed map[string]functionArgSpec
	if err := json.Unmarshal(data, &parsed); err != nil {
		return out
	}
	for key, spec := range parsed {
		fid, err := strconv.Atoi(strings.TrimSpace(key))
		if err != nil {
			continue
		}
		out[fid] = spec
	}
	return out
}

// formatFunctionArgs interprets the arguments of one function call using the
// protocol's _meta.function_args mapping. Without a mapping the raw hex values
// are shown so an ON/OFF command is still distinguishable.
func formatFunctionArgs(row map[string]interface{}, spec *functionArgSpec, enums map[string]map[string]string) string {
	args := asSlice(row["args"])
	if len(args) == 0 {
		return ""
	}
	rawValues := make([]string, 0, len(args))
	for _, arg := range args {
		m, ok := asMap(arg)
		if !ok {
			continue
		}
		if value, ok := m["val"].(string); ok && value != "" {
			rawValues = append(rawValues, value)
		}
	}
	if len(rawValues) == 0 {
		return ""
	}
	if spec == nil {
		return strings.Join(rawValues, ", ")
	}
	index := spec.Arg
	if index < 0 || index >= len(rawValues) {
		index = 0
	}
	raw := rawValues[index]
	text := raw
	switch spec.Format {
	case "u8":
		if bytes, ok := hexToBytes(raw); ok && len(bytes) > 0 {
			text = strconv.Itoa(int(bytes[0]))
		}
	case "u16le":
		if bytes, ok := hexToBytes(raw); ok && len(bytes) >= 2 {
			text = strconv.Itoa(int(bytes[0]) | int(bytes[1])<<8)
		}
	}
	if spec.Enum != "" {
		if value, ok := hexToUint(raw); ok {
			key := strconv.FormatUint(value, 10)
			if mapping, ok := enums[spec.Enum]; ok {
				if label, ok := mapping[key]; ok {
					text = label
				}
			}
		}
	}
	if spec.Suffix != "" {
		text += " " + spec.Suffix
	}
	return text
}

func hexToUint(raw string) (uint64, bool) {
	bytes, ok := hexToBytes(raw)
	if !ok || len(bytes) == 0 || len(bytes) > 8 {
		return 0, false
	}
	var value uint64
	for _, b := range bytes {
		value = value<<8 | uint64(b)
	}
	return value, true
}

func hexToBytes(raw string) ([]byte, bool) {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed)%2 != 0 {
		trimmed = "0" + trimmed
	}
	bytes := make([]byte, len(trimmed)/2)
	for i := 0; i < len(bytes); i++ {
		value, err := strconv.ParseUint(trimmed[i*2:i*2+2], 16, 8)
		if err != nil {
			return nil, false
		}
		bytes[i] = byte(value)
	}
	return bytes, true
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
