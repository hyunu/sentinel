package protocol

import (
	"fmt"

	"github.com/hyunu/sentinel/internal/models"
)

type ParseResult struct {
	Fields map[string]interface{} `json:"fields"`
	Tree   map[string]interface{} `json:"tree"`
	FID    string                 `json:"fid"`
	SeqNo  uint16                 `json:"seq_no"`
	Length uint16                 `json:"length"`
	CRC16  uint16                 `json:"crc16"`
	Valid  bool                   `json:"valid"`
	Error  string                 `json:"error,omitempty"`
}

// Parse applies Serial Parser parse_rules to raw hex.
func Parse(hexStr string, spec *models.ProtocolSpec) (*ParseResult, error) {
	if spec == nil || spec.ParseRules == nil || len(spec.ParseRules.Fields) == 0 {
		return nil, fmt.Errorf("protocol has no parse_rules")
	}

	data, err := hexStringToBytes(hexStr)
	if err != nil {
		return nil, fmt.Errorf("invalid hex: %w", err)
	}
	if len(data) < 1 {
		return nil, fmt.Errorf("data too short (%d bytes)", len(data))
	}

	result := &ParseResult{
		Fields: make(map[string]interface{}),
		Tree:   make(map[string]interface{}),
		Valid:  true,
	}
	return parseWithRules(data, spec.ParseRules, result)
}

func ParseAndFlatten(hexStr string, spec *models.ProtocolSpec) (map[string]interface{}, error) {
	result, err := Parse(hexStr, spec)
	if err != nil {
		return nil, err
	}
	return result.Fields, nil
}
