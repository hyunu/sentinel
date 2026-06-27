package protocol

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

// FrameEnvelope is the result of generic UART frame parsing (envelope only).
type FrameEnvelope struct {
	StartByte   string
	EndByte     string
	FrameBody   []byte
	Header      map[string]interface{}
	HeaderEnd   int
	Payload     []byte
	Tail        map[string]interface{}
	DispatchKey string
	CRC16       uint16
	CRCValid    bool
	HasCRC      bool
}

func framePayloadKeyField(fd *models.FrameDef) string {
	if fd != nil && fd.PayloadKeyField != "" {
		return fd.PayloadKeyField
	}
	return "fid"
}

func frameLengthField(fd *models.FrameDef) string {
	if fd != nil && fd.LengthField != "" {
		return fd.LengthField
	}
	return "length"
}

func tailByteSize(tail []models.FieldSpec) int {
	n := 0
	for _, f := range tail {
		if f.Length > 0 {
			n += f.Length
		}
	}
	return n
}

// formatDispatchKey normalizes a header field value for fid_payloads lookup.
func formatDispatchKey(val interface{}) string {
	switch v := val.(type) {
	case uint64:
		return strings.ToUpper(fmt.Sprintf("%02X", v))
	case int64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case float64:
		return strings.ToUpper(fmt.Sprintf("%02X", uint64(v)))
	case string:
		s := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(v)), "0X")
		return s
	default:
		return fmt.Sprintf("%v", v)
	}
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

// ParseFrameEnvelope strips start/end bytes, parses header/tail, and slices payload.
// Payload routing key comes from frame_def.payload_key_field (default "fid").
func ParseFrameEnvelope(data []byte, frameDef *models.FrameDef) (*FrameEnvelope, error) {
	if frameDef == nil {
		frameDef = &DefaultFrameDef
	}

	startByte, _ := strconv.ParseUint(frameDef.StartByte, 16, 8)
	endByte, _ := strconv.ParseUint(frameDef.EndByte, 16, 8)

	out := &FrameEnvelope{
		Header: make(map[string]interface{}),
		Tail:   make(map[string]interface{}),
	}

	payloadStart := 0
	if len(data) > 0 && data[0] == byte(startByte) {
		payloadStart = 1
		out.StartByte = strings.ToUpper(frameDef.StartByte)
	}

	payloadEnd := len(data)
	if len(data) > 0 && data[len(data)-1] == byte(endByte) {
		payloadEnd = len(data) - 1
		out.EndByte = strings.ToUpper(frameDef.EndByte)
	}

	frameBody := data[payloadStart:payloadEnd]
	out.FrameBody = frameBody

	if len(frameBody) < 2 {
		return out, fmt.Errorf("frame body too short (%d bytes)", len(frameBody))
	}

	hdrOff := 0
	for _, hf := range frameDef.Header {
		val, newOff, err := readField(frameBody, hdrOff, hf)
		if err != nil {
			return out, fmt.Errorf("header field %s: %w", hf.Name, err)
		}
		out.Header[hf.Name] = val
		hdrOff = newOff
	}
	out.HeaderEnd = hdrOff

	tailFields := frameDef.Tail
	tailSize := tailByteSize(tailFields)

	payloadEndOff := len(frameBody) - tailSize
	if payloadEndOff < hdrOff {
		payloadEndOff = hdrOff
	}

	lengthField := frameLengthField(frameDef)
	if lenVal, ok := out.Header[lengthField]; ok {
		switch lv := lenVal.(type) {
		case uint64:
			if int(lv) > hdrOff && int(lv) <= len(frameBody) {
				payloadEndOff = int(lv)
			}
		case int64:
			if int(lv) > hdrOff && int(lv) <= len(frameBody) {
				payloadEndOff = int(lv)
			}
		}
	}

	out.Payload = frameBody[hdrOff:payloadEndOff]

	if tailSize > 0 && len(frameBody) >= tailSize {
		tailStart := len(frameBody) - tailSize
		tOff := tailStart
		for _, tf := range tailFields {
			val, newOff, err := readField(frameBody, tOff, tf)
			if err != nil {
				break
			}
			out.Tail[tf.Name] = val
			tOff = newOff
		}
	}

	keyField := framePayloadKeyField(frameDef)
	if keyVal, ok := out.Header[keyField]; ok {
		out.DispatchKey = formatDispatchKey(keyVal)
	}

	if crcVal, ok := out.Tail["crc16"].(uint64); ok && frameDef.CrcPosition != "none" {
		out.HasCRC = true
		out.CRC16 = uint16(crcVal)
		crcData := frameBody
		if tailSize > 0 && len(crcData) >= tailSize {
			crcData = crcData[:len(crcData)-tailSize]
		}
		calc := crc16CCITT(crcData)
		out.CRCValid = calc == out.CRC16
	} else {
		out.CRCValid = true
	}

	return out, nil
}

func findFIDPayload(key string, payloads []models.FIDPayload) *models.FIDPayload {
	for i, p := range payloads {
		if strings.EqualFold(p.FID, key) {
			return &payloads[i]
		}
	}
	return nil
}
