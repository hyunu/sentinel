package protocol

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

func readField(data []byte, offset int, spec models.FieldSpec) (interface{}, int, error) {
	endian := spec.Endian
	if endian == "" {
		endian = "little"
	}

	length := spec.Length
	if length == 0 {
		if spec.Type == "raw" || spec.Type == "dynamic" {
			return nil, offset, nil
		}
		length = 1
	}

	if offset+length > len(data) {
		return nil, offset, fmt.Errorf("field %s: offset %d + length %d exceeds data %d", spec.Name, offset, length, len(data))
	}

	slice := data[offset : offset+length]
	var val interface{}

	switch spec.Type {
	case "uint8":
		val = uint64(slice[0])
	case "int8":
		val = int64(int8(slice[0]))
	case "uint16":
		if endian == "big" {
			val = uint64(binary.BigEndian.Uint16(slice))
		} else {
			val = uint64(binary.LittleEndian.Uint16(slice))
		}
	case "int16":
		if endian == "big" {
			val = int64(int16(binary.BigEndian.Uint16(slice)))
		} else {
			val = int64(int16(binary.LittleEndian.Uint16(slice)))
		}
	case "uint32":
		if endian == "big" {
			val = uint64(binary.BigEndian.Uint32(slice))
		} else {
			val = uint64(binary.LittleEndian.Uint32(slice))
		}
	case "int32":
		if endian == "big" {
			val = int64(int32(binary.BigEndian.Uint32(slice)))
		} else {
			val = int64(int32(binary.LittleEndian.Uint32(slice)))
		}
	case "float":
		if endian == "big" {
			val = float64(math.Float32frombits(binary.BigEndian.Uint32(slice)))
		} else {
			val = float64(math.Float32frombits(binary.LittleEndian.Uint32(slice)))
		}
	case "ascii":
		val = strings.TrimRight(string(slice), "\x00")
	case "hex", "raw", "dynamic":
		val = hex.EncodeToString(slice)
	default:
		val = hex.EncodeToString(slice)
	}

	return val, offset + length, nil
}

// ParseFieldsSequential parses fields in order with nested struct/dispatch/tagged compositors.
func ParseFieldsSequential(data []byte, fields []models.FieldSpec) (map[string]interface{}, int, error) {
	return parseFieldsWithScope(data, fields, nil)
}

func ParseFieldsAbsolute(data []byte, fields []models.FieldSpec) map[string]interface{} {
	result := make(map[string]interface{})
	for _, field := range fields {
		if field.Name == "" {
			continue
		}
		if isBitField(field) {
			val, err := readBitFieldAbsolute(data, field)
			if err != nil {
				continue
			}
			result[field.Name] = val
			applyFieldDecoration(result, field.Name, field.Decoration, val)
			continue
		}
		if field.Length == 0 {
			continue
		}
		val, _, err := readField(data, field.Offset, field)
		if err != nil {
			continue
		}
		result[field.Name] = val
		applyFieldDecoration(result, field.Name, field.Decoration, val)
	}
	return result
}

func fieldsContainLCPTypes(fields []models.FieldSpec) bool {
	for _, f := range fields {
		if f.Type == "function_args" || f.Type == "func_result" || f.Type == "dynamic" {
			return true
		}
		if len(f.Fields) > 0 && fieldsContainLCPTypes(f.Fields) {
			return true
		}
		if len(f.DispatchVariants) > 0 && fieldsContainLCPTypes(flattenVariantFields(f.DispatchVariants)) {
			return true
		}
	}
	return false
}

func flattenVariantFields(variants map[string][]models.FieldSpec) []models.FieldSpec {
	var out []models.FieldSpec
	for _, fs := range variants {
		out = append(out, fs...)
	}
	return out
}
