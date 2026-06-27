package protocol

import (
	"encoding/hex"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

func fieldUsesRemaining(field models.FieldSpec) bool {
	if field.LengthMode == "remaining" {
		return true
	}
	if field.Repeat == "until_end" {
		return true
	}
	return field.Type == "raw" && field.Length == 0 && !isBitField(field)
}

func readRemainingField(data []byte, cur *parseCursor, field models.FieldSpec) (interface{}, error) {
	cur.alignByte()
	end := cur.boundEnd(len(data))
	if cur.byteOff >= end {
		cur.byteOff = end
		cur.bitOff = 0
		if field.Type == "ascii" {
			return "", nil
		}
		return "", nil
	}
	slice := data[cur.byteOff:end]
	cur.byteOff = end
	cur.bitOff = 0

	switch field.Type {
	case "ascii":
		return strings.TrimRight(string(slice), "\x00"), nil
	case "hex", "raw", "dynamic":
		return hex.EncodeToString(slice), nil
	default:
		if len(slice) == 0 {
			return nil, nil
		}
		spec := field
		spec.Length = len(slice)
		spec.LengthMode = ""
		val, _, err := readField(slice, 0, spec)
		return val, err
	}
}

func newBoundedCursor(dataLen int) *parseCursor {
	return &parseCursor{maxByteOff: dataLen}
}
