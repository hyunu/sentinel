package protocol

import (
	"fmt"
	"strings"

	"github.com/hyunu/sentinel/internal/ruleparser"
)

func parseWithRules(data []byte, doc *ruleparser.JsonRuleDocument, result *ParseResult) (*ParseResult, error) {
	tree, err := ruleparser.ParseFromJSONDocument(*doc, data)
	if err != nil {
		return result, err
	}

	result.Tree = normalizeRuleTree(tree)
	flattenRuleTree("", result.Tree, result.Fields)

	if fidVal, ok := result.Tree["fid"]; ok {
		result.FID = formatDispatchKey(fidVal)
	}
	if seqVal, ok := result.Tree["seq_no"]; ok {
		if n, err := asInt(seqVal); err == nil {
			result.SeqNo = uint16(n)
		}
	}
	if lenVal, ok := result.Tree["length"]; ok {
		if n, err := asInt(lenVal); err == nil {
			result.Length = uint16(n)
		}
	}
	if crcVal, ok := result.Tree["crc16"]; ok {
		if n, err := asInt(crcVal); err == nil {
			result.CRC16 = uint16(n)
		}
	}

	if start, end, ok := lcpFrameCRCRange(data); ok {
		calc := crc16XMODEM(data[start:end])
		result.Valid = calc == result.CRC16
		if !result.Valid {
			result.Error = fmt.Sprintf("CRC mismatch: calculated %04X, received %04X", calc, result.CRC16)
		}
	}

	return result, nil
}

func formatDispatchKey(val interface{}) string {
	switch v := val.(type) {
	case int:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case int64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case uint64:
		return strings.ToUpper(fmt.Sprintf("%02X", v))
	case float64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case string:
		return strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(v)), "0X")
	default:
		return fmt.Sprintf("%v", v)
	}
}

func normalizeRuleTree(tree map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(tree))
	for k, v := range tree {
		out[k] = normalizeRuleValue(v)
	}
	return out
}

func normalizeRuleValue(v interface{}) interface{} {
	switch val := v.(type) {
	case []byte:
		return bytesToHexUpper(val)
	case map[string]interface{}:
		return normalizeRuleTree(val)
	case []interface{}:
		out := make([]interface{}, len(val))
		for i, item := range val {
			out[i] = normalizeRuleValue(item)
		}
		return out
	case []map[string]interface{}:
		out := make([]interface{}, len(val))
		for i, item := range val {
			out[i] = normalizeRuleTree(item)
		}
		return out
	default:
		return val
	}
}

func flattenRuleTree(prefix string, v interface{}, out map[string]interface{}) {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			key := k
			if prefix != "" {
				key = prefix + "." + k
			}
			switch c := child.(type) {
			case map[string]interface{}:
				flattenRuleTree(key, c, out)
			case []interface{}:
				out[key] = c
			default:
				out[key] = child
			}
		}
	default:
		if prefix != "" {
			out[prefix] = v
		}
	}
}

func asInt(v interface{}) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case uint64:
		return int(n), nil
	case float64:
		return int(n), nil
	default:
		return 0, fmt.Errorf("not an integer: %T", v)
	}
}
