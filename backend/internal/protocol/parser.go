package protocol

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

var DefaultFrameDef = models.FrameDef{
	StartByte:   "AA",
	EndByte:     "BB",
	CrcPosition: "before_end",
	Endian:      "big",
	Header: []models.FieldSpec{
		{Name: "length", Length: 2, Type: "uint16", Endian: "big"},
		{Name: "fid", Length: 1, Type: "uint8"},
		{Name: "seq_no", Length: 2, Type: "uint16", Endian: "big"},
		{Name: "attr", Length: 1, Type: "uint8"},
	},
	Tail: []models.FieldSpec{
		{Name: "crc16", Length: 2, Type: "uint16", Endian: "big"},
	},
}

var DefaultFIDPayloads = []models.FIDPayload{
	{FID: "CF", Name: "Function Call", Fields: []models.FieldSpec{
		{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
		{Name: "arguments", Type: "function_args", Fields: []models.FieldSpec{
			{Flag: "FA", Name: "argument", Fields: []models.FieldSpec{
				{Name: "type_id", Length: 1, Type: "uint8"},
				{Name: "value", Type: "dynamic", Condition: "type_id"},
			}},
		}},
	}},
	{FID: "CD", Name: "Function ACK", Fields: []models.FieldSpec{
		{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
		{Name: "result", Type: "func_result", Fields: []models.FieldSpec{
			{Flag: "FD", Name: "success", Fields: []models.FieldSpec{
				{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
				{Name: "result_data", Type: "raw", Length: 0},
			}},
			{Flag: "FE", Name: "error", Fields: []models.FieldSpec{
				{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
				{Name: "error_code", Length: 1, Type: "uint8"},
			}},
		}},
	}},
	{FID: "CA", Name: "Data Transfer", Fields: []models.FieldSpec{
		{Name: "raw_data", Type: "raw"},
	}},
	{FID: "CE", Name: "Ping"},
	{FID: "CC", Name: "Packet ACK", Fields: []models.FieldSpec{
		{Name: "ack_seq", Length: 2, Type: "uint16", Endian: "big"},
		{Name: "error_code", Length: 1, Type: "uint8"},
	}},
	{FID: "BC", Name: "Heartbeat", Fields: []models.FieldSpec{
		{Name: "timestamp", Length: 4, Type: "uint32", Endian: "little"},
		{Name: "status", Length: 1, Type: "uint8"},
	}},
	{FID: "C9", Name: "Event", Fields: []models.FieldSpec{
		{Name: "event_id", Length: 1, Type: "uint8"},
		{Name: "event_data", Type: "raw"},
	}},
}

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

func hexStringToBytes(s string) ([]byte, error) {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\t", "")
	return hex.DecodeString(s)
}

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
	case "hex":
		val = hex.EncodeToString(slice)
	case "raw":
		val = hex.EncodeToString(slice)
		length = len(slice)
	case "dynamic":
		val = hex.EncodeToString(slice)
		length = len(slice)
	default:
		val = hex.EncodeToString(slice)
	}

	return val, offset + length, nil
}

func parseFieldsSequential(data []byte, fields []models.FieldSpec) (map[string]interface{}, int, error) {
	result := make(map[string]interface{})
	offset := 0

	for _, field := range fields {
		if field.Repeat == "until_end" || (field.Type == "raw" && field.Length == 0) {
			remaining := data[offset:]
			result[field.Name] = hex.EncodeToString(remaining)
			offset = len(data)
			continue
		}

		if field.Type == "function_args" || field.Type == "func_result" || len(field.Fields) > 0 {
			if field.Condition != "" {
				condVal, ok := result[field.Condition]
				if ok {
					switch v := condVal.(type) {
					case uint64:
						if v == 0 {
							continue
						}
					}
				}
			}

			switch field.Type {
			case "function_args":
				args, n, err := parseFunctionArgs(data[offset:], field)
				if err != nil {
					return result, offset, err
				}
				result[field.Name] = args
				offset += n
			case "func_result":
				res, n, err := parseFunctionResult(data[offset:], field)
				if err != nil {
					return result, offset, err
				}
				result[field.Name] = res
				offset += n
			default:
				sub, n, err := parseFieldsSequential(data[offset:], field.Fields)
				if err != nil {
					return result, offset, err
				}
				for k, v := range sub {
					result[field.Name+"."+k] = v
				}
				offset += n
			}
			continue
		}

		if field.Length == 0 {
			continue
		}

		val, newOffset, err := readField(data, offset, field)
		if err != nil {
			return result, offset, err
		}
		result[field.Name] = val
		offset = newOffset
	}

	return result, offset, nil
}

func parseFunctionArgs(data []byte, spec models.FieldSpec) ([]map[string]interface{}, int, error) {
	var args []map[string]interface{}
	offset := 0
	argSpec := spec.Fields[0]

	for offset < len(data) {
		if offset >= len(data) {
			break
		}
		flag := data[offset]
		offset++

		flagStr := fmt.Sprintf("%02X", flag)

		if argSpec.Flag != "" && flagStr != argSpec.Flag {
			offset--
			break
		}

		if offset >= len(data) {
			break
		}
		argLen := int(data[offset])
		offset++

		if offset+argLen > len(data) {
			return args, offset, fmt.Errorf("argument data exceeds buffer at offset %d", offset)
		}

		argData := data[offset : offset+argLen]
		offset += argLen

		arg := make(map[string]interface{})
		arg["flag"] = flagStr
		arg["length"] = argLen

		for _, child := range argSpec.Fields {
			if child.Name == "type_id" && len(argData) >= 1 {
				arg[child.Name] = uint64(argData[0])
				continue
			}
			if child.Name == "value" {
				if len(argData) > 1 {
					arg[child.Name] = hex.EncodeToString(argData[1:])
				} else {
					arg[child.Name] = ""
				}
				continue
			}
			val, _, err := readField(argData, 0, child)
			if err == nil {
				arg[child.Name] = val
			}
		}

		args = append(args, arg)
	}

	return args, offset, nil
}

func parseFunctionResult(data []byte, spec models.FieldSpec) (map[string]interface{}, int, error) {
	result := make(map[string]interface{})
	offset := 0

	if offset >= len(data) {
		return result, offset, nil
	}

	flag := data[offset]
	offset++
	flagStr := fmt.Sprintf("%02X", flag)

	if offset >= len(data) {
		return result, offset, nil
	}
	blockLen := int(data[offset])
	offset++

	if offset+blockLen > len(data) {
		blockLen = len(data) - offset
	}

	blockData := data[offset : offset+blockLen]
	offset += blockLen

	result["flag"] = flagStr
	result["length"] = blockLen

	for _, child := range spec.Fields {
		cond := child.Flag
		if cond != "" && cond != flagStr {
			continue
		}
		sub, _, err := parseFieldsSequential(blockData, child.Fields)
		if err == nil {
			for k, v := range sub {
				result[k] = v
			}
		}
	}

	return result, offset, nil
}

func crc16CCITT(data []byte) uint16 {
	var crc uint16 = 0xFFFF
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

func Parse(hexStr string, spec *models.ProtocolSpec) (*ParseResult, error) {
	data, err := hexStringToBytes(hexStr)
	if err != nil {
		return nil, fmt.Errorf("invalid hex: %w", err)
	}

	result := &ParseResult{
		Fields: make(map[string]interface{}),
		Tree:   make(map[string]interface{}),
	}

	if len(data) < 2 {
		return nil, fmt.Errorf("data too short (%d bytes)", len(data))
	}

	frameDef := spec.FrameDef
	if frameDef == nil {
		frameDef = &DefaultFrameDef
	}

	startByte, _ := strconv.ParseUint(frameDef.StartByte, 16, 8)
	endByte, _ := strconv.ParseUint(frameDef.EndByte, 16, 8)

	payloadStart := 0
	if data[0] == byte(startByte) {
		payloadStart = 1
		result.Tree["start_byte"] = fmt.Sprintf("%02X", startByte)
	}

	payloadEnd := len(data)
	if data[len(data)-1] == byte(endByte) {
		payloadEnd = len(data) - 1
		result.Tree["end_byte"] = fmt.Sprintf("%02X", endByte)
	}

	frameBody := data[payloadStart:payloadEnd]

	if len(frameBody) < 4 {
		return result, fmt.Errorf("frame body too short (%d bytes)", len(frameBody))
	}

	headerFields := frameDef.Header
	tailFields := frameDef.Tail

	hdrOff := 0
	for _, hf := range headerFields {
		val, newOff, err := readField(frameBody, hdrOff, hf)
		if err != nil {
			return result, fmt.Errorf("header field %s: %w", hf.Name, err)
		}
		result.Fields[hf.Name] = val
		result.Tree[hf.Name] = val
		hdrOff = newOff
	}

	fidVal, _ := result.Fields["fid"].(uint64)
	fidStr := fmt.Sprintf("%02X", fidVal)

	fidMap := map[uint64]string{
		0xCF: "CF", 0xCD: "CD", 0xCA: "CA",
		0xCE: "CE", 0xCC: "CC", 0xBC: "BC", 0xC9: "C9",
	}
	if name, ok := fidMap[fidVal]; ok {
		fidStr = name
	}
	result.FID = fidStr

	seqVal, _ := result.Fields["seq_no"].(uint64)
	result.SeqNo = uint16(seqVal)

	attrVal, _ := result.Fields["attr"].(uint64)
	if attrVal != 0 {
		retryCount := (attrVal >> 4) & 0x0F
		priority := attrVal & 0x0F
		result.Tree["attr_retry"] = retryCount
		result.Tree["attr_priority"] = priority
		result.Fields["attr_retry"] = retryCount
		result.Fields["attr_priority"] = priority
	}

	lenVal, _ := result.Fields["length"].(uint64)
	result.Length = uint16(lenVal)

	var payloadData []byte
	if lenVal > 0 && int(lenVal) > hdrOff && int(lenVal) <= len(frameBody) {
		payloadStart := hdrOff
		payloadEnd := int(lenVal)
		if payloadEnd > len(frameBody) {
			payloadEnd = len(frameBody)
		}
		payloadData = frameBody[payloadStart:payloadEnd]
	} else {
		payloadData = frameBody[hdrOff:]
	}

	tailOffset := hdrOff
	for _, tf := range tailFields {
		if tailOffset+tf.Length > len(frameBody) {
			break
		}
		val, newOff, err := readField(frameBody, tailOffset, tf)
		if err != nil {
			break
		}
		result.Fields[tf.Name] = val
		tailOffset = newOff
	}

	if crcVal, ok := result.Fields["crc16"].(uint64); ok {
		result.CRC16 = uint16(crcVal)
		calcCRC := crc16CCITT(frameBody[:len(frameBody)-2])
		result.Valid = calcCRC == result.CRC16
		if !result.Valid {
			result.Error = fmt.Sprintf("CRC mismatch: calculated %04X, received %04X", calcCRC, result.CRC16)
		}
	} else {
		result.Valid = true
	}

	var payloadFID *models.FIDPayload
	for i, p := range spec.FIDPayloads {
		if strings.EqualFold(p.FID, fidStr) {
			payloadFID = &spec.FIDPayloads[i]
			break
		}
	}
	if payloadFID == nil {
		for i, p := range DefaultFIDPayloads {
			if strings.EqualFold(p.FID, fidStr) {
				payloadFID = &DefaultFIDPayloads[i]
				break
			}
		}
	}

	if payloadFID != nil && len(payloadData) > 0 {
		parsed, _, err := parseFieldsSequential(payloadData, payloadFID.Fields)
		if err != nil {
			result.Error = fmt.Sprintf("payload parse: %v", err)
		}
		for k, v := range parsed {
			result.Fields["payload."+k] = v
			result.Tree[k] = v
		}
	}

	if len(payloadData) > 0 && payloadFID == nil {
		result.Tree["payload_raw"] = hex.EncodeToString(payloadData)
		result.Fields["payload_raw"] = hex.EncodeToString(payloadData)
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
