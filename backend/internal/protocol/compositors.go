package protocol

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

func normalizeVariantKey(val interface{}) string {
	switch v := val.(type) {
	case uint64:
		return strings.ToUpper(fmt.Sprintf("%02X", v))
	case int64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case float64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case string:
		s := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(v)), "0X")
		if len(s) == 1 {
			return "0" + s
		}
		return s
	default:
		return fmt.Sprintf("%v", v)
	}
}

func lookupDispatchVariants(variants map[string][]models.FieldSpec, key string) []models.FieldSpec {
	if variants == nil {
		return nil
	}
	candidates := []string{
		key,
		strings.ToUpper(key),
	}
	if len(key) == 1 {
		candidates = append(candidates, "0"+strings.ToUpper(key))
	}
	seen := map[string]bool{}
	for _, c := range candidates {
		if seen[c] {
			continue
		}
		seen[c] = true
		if fields, ok := variants[c]; ok {
			return fields
		}
	}
	return nil
}

func findTaggedVariant(flagStr string, variants []models.FieldSpec) *models.FieldSpec {
	for i, v := range variants {
		if v.Flag == "" {
			continue
		}
		if strings.EqualFold(v.Flag, flagStr) {
			return &variants[i]
		}
	}
	return nil
}

func parseTaggedBlock(data []byte, offset int, field models.FieldSpec) (map[string]interface{}, int, error) {
	if offset >= len(data) {
		return map[string]interface{}{}, offset, nil
	}

	flag := data[offset]
	offset++
	flagStr := fmt.Sprintf("%02X", flag)

	if offset >= len(data) {
		return map[string]interface{}{"flag": flagStr}, offset, nil
	}

	blockLen := int(data[offset])
	offset++

	if offset+blockLen > len(data) {
		blockLen = len(data) - offset
	}
	blockData := data[offset : offset+blockLen]
	offset += blockLen

	item := map[string]interface{}{
		"flag":   flagStr,
		"length": blockLen,
	}

	variant := findTaggedVariant(flagStr, field.Fields)
	if variant != nil {
		if variant.Name != "" {
			item["_name"] = variant.Name
		}
		sub, _, err := parseFieldsWithScope(blockData, variant.Fields, map[string]interface{}{
			"_block_length": blockLen,
		})
		if err != nil {
			return item, offset, err
		}
		for k, v := range sub {
			item[k] = v
		}
	} else if blockLen > 0 {
		item["raw"] = hex.EncodeToString(blockData)
	}

	return item, offset, nil
}

func parseTaggedRepeat(data []byte, offset int, field models.FieldSpec) ([]map[string]interface{}, int, error) {
	var items []map[string]interface{}
	until := field.TaggedUntil
	if until == "" {
		until = "no_matching_flag"
	}

	for offset < len(data) {
		if offset >= len(data) {
			break
		}

		flag := data[offset]
		flagStr := fmt.Sprintf("%02X", flag)
		variant := findTaggedVariant(flagStr, field.Fields)

		if variant == nil {
			if until == "no_matching_flag" {
				break
			}
			return items, offset, fmt.Errorf("tagged_repeat: unknown flag %s at offset %d", flagStr, offset)
		}

		offset++
		if offset >= len(data) {
			break
		}
		blockLen := int(data[offset])
		offset++
		if offset+blockLen > len(data) {
			return items, offset, fmt.Errorf("tagged_repeat: block length %d exceeds buffer at %d", blockLen, offset)
		}

		blockData := data[offset : offset+blockLen]
		offset += blockLen

		item := map[string]interface{}{
			"flag":   flagStr,
			"length": blockLen,
		}
		if variant.Name != "" {
			item["_name"] = variant.Name
		}

		sub, _, err := parseFieldsWithScope(blockData, variant.Fields, map[string]interface{}{
			"_block_length": blockLen,
		})
		if err != nil {
			return items, offset, err
		}
		for k, v := range sub {
			item[k] = v
		}
		items = append(items, item)
	}

	return items, offset, nil
}

func parseDispatchField(data []byte, cur *parseCursor, field models.FieldSpec, scope map[string]interface{}) (interface{}, error) {
	on := field.DispatchOn
	if on == "" {
		return nil, fmt.Errorf("dispatch field %s: dispatch_on required", field.Name)
	}
	keyVal, ok := scope[on]
	if !ok {
		if len(field.DefaultFields) > 0 {
			start := cur.byteOff
			end := cur.boundEnd(len(data))
			sub, n, err := parseFieldsWithScope(data[start:end], field.DefaultFields, scope)
			if err != nil {
				return nil, err
			}
			cur.byteOff = start + n
			cur.bitOff = 0
			return sub, nil
		}
		return nil, fmt.Errorf("dispatch field %s: %s not in scope", field.Name, on)
	}

	key := normalizeVariantKey(keyVal)
	variantFields := lookupDispatchVariants(field.DispatchVariants, key)
	if variantFields == nil {
		variantFields = field.DefaultFields
	}
	if len(variantFields) == 0 {
		end := cur.boundEnd(len(data))
		slice := data[cur.byteOff:end]
		cur.byteOff = end
		cur.bitOff = 0
		return hex.EncodeToString(slice), nil
	}

	start := cur.byteOff
	end := cur.boundEnd(len(data))
	sub, n, err := parseFieldsWithScope(data[start:end], variantFields, scope)
	if err != nil {
		return nil, err
	}
	cur.byteOff = start + n
	cur.bitOff = 0

	if len(variantFields) == 1 {
		vf := variantFields[0]
		if v, ok := sub[vf.Name]; ok && vf.Name != "" {
			return v, nil
		}
	}
	if len(sub) == 1 {
		for _, v := range sub {
			return v, nil
		}
	}
	return sub, nil
}

func parseOneField(data []byte, cur *parseCursor, field models.FieldSpec, scope map[string]interface{}) (interface{}, error) {
	if field.Condition != "" {
		if condVal, ok := scope[field.Condition]; ok {
			switch v := condVal.(type) {
			case uint64:
				if v == 0 {
					return nil, nil
				}
			case int64:
				if v == 0 {
					return nil, nil
				}
			}
		}
	}

	if fieldUsesRemaining(field) {
		return readRemainingField(data, cur, field)
	}

	switch field.Type {
	case "struct":
		cur.alignByte()
		sub, n, err := parseFieldsWithScope(data[cur.byteOff:], field.Fields, nil)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return sub, nil

	case "dispatch":
		cur.alignByte()
		return parseDispatchField(data, cur, field, scope)

	case "tagged_repeat":
		cur.alignByte()
		items, n, err := parseTaggedRepeat(data, cur.byteOff, field)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return items, nil

	case "tagged_block":
		cur.alignByte()
		item, n, err := parseTaggedBlock(data, cur.byteOff, field)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return item, nil

	case "function_args":
		cur.alignByte()
		wrapped := field
		wrapped.Type = "tagged_repeat"
		if wrapped.TaggedUntil == "" {
			wrapped.TaggedUntil = "no_matching_flag"
		}
		items, n, err := parseTaggedRepeat(data, cur.byteOff, wrapped)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return items, nil

	case "func_result":
		cur.alignByte()
		wrapped := field
		wrapped.Type = "tagged_block"
		item, n, err := parseTaggedBlock(data, cur.byteOff, wrapped)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return item, nil
	}

	if len(field.Fields) > 0 && field.Type != "raw" && field.Type != "dynamic" {
		cur.alignByte()
		sub, n, err := parseFieldsWithScope(data[cur.byteOff:], field.Fields, nil)
		if err != nil {
			return nil, err
		}
		cur.byteOff += n
		cur.bitOff = 0
		return sub, nil
	}

	if isBitField(field) {
		val, err := readBitField(data, cur, field)
		if err != nil {
			return nil, err
		}
		return val, nil
	}

	cur.alignByte()
	if field.Length == 0 && field.Type != "dynamic" {
		return nil, nil
	}

	if field.Type == "dynamic" {
		if field.DispatchOn != "" && len(field.DispatchVariants) > 0 {
			return parseDispatchField(data, cur, field, scope)
		}
		return readRemainingField(data, cur, field)
	}

	val, newOff, err := readField(data, cur.byteOff, field)
	if err != nil {
		return nil, err
	}
	end := cur.boundEnd(len(data))
	if newOff > end {
		return nil, fmt.Errorf("field %s: read past container (%d > %d)", field.Name, newOff, end)
	}
	cur.byteOff = newOff
	cur.bitOff = 0
	return val, nil
}

func parseFieldsWithScope(data []byte, fields []models.FieldSpec, outerScope map[string]interface{}) (map[string]interface{}, int, error) {
	result := make(map[string]interface{})
	cur := newBoundedCursor(len(data))
	scope := make(map[string]interface{})
	for k, v := range outerScope {
		scope[k] = v
	}

	for _, field := range fields {
		if field.Name == "" && field.Type == "" && len(field.Fields) == 0 {
			continue
		}

		val, err := parseOneField(data, cur, field, scope)
		if err != nil {
			return result, cur.byteOff, err
		}
		if val == nil && field.Condition != "" {
			continue
		}

		if field.Name != "" {
			result[field.Name] = val
			scope[field.Name] = val
			if decVal, ok := val.(uint64); ok {
				scope[field.Name] = decVal
			}
			applyFieldDecoration(result, field.Name, field.Decoration, val)
		} else if field.Type == "" && len(field.Fields) > 0 {
			if sub, ok := val.(map[string]interface{}); ok {
				for k, v := range sub {
					result[k] = v
					scope[k] = v
				}
			}
		}
	}

	return result, cur.byteOff, nil
}
