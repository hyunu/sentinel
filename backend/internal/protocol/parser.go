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

// Parse applies a ProtocolSpec to raw hex. Frame-based specs use generic envelope parsing;
// raw specs use absolute offset fields. LCP payload types are parsed when present in fid_payloads.
func Parse(hexStr string, spec *models.ProtocolSpec) (*ParseResult, error) {
	data, err := hexStringToBytes(hexStr)
	if err != nil {
		return nil, fmt.Errorf("invalid hex: %w", err)
	}

	result := &ParseResult{
		Fields: make(map[string]interface{}),
		Tree:   make(map[string]interface{}),
		Valid:  true,
	}

	if len(data) < 1 {
		return nil, fmt.Errorf("data too short (%d bytes)", len(data))
	}

	if spec.FrameDef != nil || len(spec.FIDPayloads) > 0 {
		return parseFrameProtocol(data, spec, result)
	}

	flat := ParseFieldsAbsolute(data, spec.Fields)
	for k, v := range flat {
		result.Fields[k] = v
		result.Tree[k] = v
	}
	return result, nil
}

func parseFrameProtocol(data []byte, spec *models.ProtocolSpec, result *ParseResult) (*ParseResult, error) {
	frameDef := spec.FrameDef
	if frameDef == nil {
		frameDef = &DefaultFrameDef
	}

	env, err := ParseFrameEnvelope(data, frameDef)
	if err != nil {
		return result, err
	}

	if env.StartByte != "" {
		result.Tree["start_byte"] = env.StartByte
	}
	if env.EndByte != "" {
		result.Tree["end_byte"] = env.EndByte
	}

	for k, v := range env.Header {
		result.Fields[k] = v
		result.Tree[k] = v
	}
	for k, v := range env.Tail {
		result.Fields[k] = v
		result.Tree["tail_"+k] = v
	}

	result.FID = env.DispatchKey

	if seqVal, ok := env.Header["seq_no"].(uint64); ok {
		result.SeqNo = uint16(seqVal)
	}
	if lenVal, ok := env.Header["length"].(uint64); ok {
		result.Length = uint16(lenVal)
	}

	if env.HasCRC {
		result.CRC16 = env.CRC16
		result.Valid = env.CRCValid
		if !env.CRCValid {
			result.Error = fmt.Sprintf("CRC mismatch: calculated %04X, received %04X", crc16CCITT(env.FrameBody[:len(env.FrameBody)-tailByteSize(frameDef.Tail)]), env.CRC16)
		}
	}

	payloadFID := findFIDPayload(env.DispatchKey, spec.FIDPayloads)

	if payloadFID != nil && len(env.Payload) > 0 {
		parsed, _, err := ParseFieldsSequential(env.Payload, payloadFID.Fields)
		if err != nil {
			if result.Error == "" {
				result.Error = fmt.Sprintf("payload parse: %v", err)
			}
		}
		for k, v := range parsed {
			result.Fields["payload."+k] = v
			result.Tree[k] = v
		}
	} else if len(env.Payload) > 0 {
		raw := bytesToHexUpper(env.Payload)
		result.Fields["payload_raw"] = raw
		result.Tree["payload_raw"] = raw
	}

	return result, nil
}

func ParseAndFlatten(hexStr string, spec *models.ProtocolSpec) (map[string]interface{}, error) {
	result, err := Parse(hexStr, spec)
	if err != nil {
		return nil, err
	}
	return result.Fields, nil
}
