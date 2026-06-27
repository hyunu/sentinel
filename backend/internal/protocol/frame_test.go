package protocol

import (
	"testing"

	"github.com/hyunu/sentinel/internal/models"
)

func TestParseFrameEnvelopeGeneric(t *testing.T) {
	// AA | len=8 | msg_id=01 | payload(2) | crc | BB  — minimal custom UART frame
	// body: 00 08 01 DE AD crc16
	frameDef := models.FrameDef{
		StartByte:       "AA",
		EndByte:         "BB",
		PayloadKeyField: "msg_id",
		LengthField:     "length",
		Header: []models.FieldSpec{
			{Name: "length", Length: 2, Type: "uint16", Endian: "big"},
			{Name: "msg_id", Length: 1, Type: "uint8"},
		},
		Tail: []models.FieldSpec{
			{Name: "crc16", Length: 2, Type: "uint16", Endian: "big"},
		},
	}

	// Build frame manually: AA 00 08 01 DE AD [crc] BB
	body := []byte{0x00, 0x08, 0x01, 0xDE, 0xAD}
	crc := crc16CCITT(body)
	frame := append([]byte{0xAA}, body...)
	frame = append(frame, byte(crc>>8), byte(crc&0xFF), 0xBB)

	env, err := ParseFrameEnvelope(frame, &frameDef)
	if err != nil {
		t.Fatalf("ParseFrameEnvelope: %v", err)
	}

	if env.DispatchKey != "01" {
		t.Fatalf("dispatch key: want 01, got %s", env.DispatchKey)
	}
	if len(env.Payload) != 2 || env.Payload[0] != 0xDE || env.Payload[1] != 0xAD {
		t.Fatalf("payload: %#v", env.Payload)
	}
	if !env.CRCValid {
		t.Fatal("expected valid CRC")
	}
}

func TestParseFrameProtocolWithFIDPayload(t *testing.T) {
	spec := models.ProtocolSpec{
		FrameDef: &models.FrameDef{
			StartByte:       "AA",
			EndByte:         "BB",
			PayloadKeyField: "msg_id",
			LengthField:     "length",
			Header: []models.FieldSpec{
				{Name: "length", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "msg_id", Length: 1, Type: "uint8"},
			},
			Tail: []models.FieldSpec{
				{Name: "crc16", Length: 2, Type: "uint16", Endian: "big"},
			},
		},
		FIDPayloads: []models.FIDPayload{
			{
				FID: "01",
				Fields: []models.FieldSpec{
					{Name: "value", Length: 2, Type: "uint16", Endian: "big"},
				},
			},
		},
	}

	body := []byte{0x00, 0x08, 0x01, 0x12, 0x34}
	crc := crc16CCITT(body)
	hexStr := bytesToHexUpper(append(append([]byte{0xAA}, body...), byte(crc>>8), byte(crc&0xFF), 0xBB))

	parsed, err := Parse(hexStr, &spec)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if parsed.FID != "01" {
		t.Fatalf("FID: %s", parsed.FID)
	}
	val, ok := parsed.Fields["payload.value"].(uint64)
	if !ok || val != 0x1234 {
		t.Fatalf("payload.value: %#v", parsed.Fields["payload.value"])
	}
}
