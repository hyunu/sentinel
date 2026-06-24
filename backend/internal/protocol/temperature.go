package protocol

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"

	"github.com/hyunu/sentinel/internal/models"
)

const TemperatureProtocolID = "temperature-telemetry-v1"
const TemperatureFID = byte('T') // 0x54

// TemperatureTelemetrySpec returns the UART protocol for ESP32 temperature telemetry frames.
func TemperatureTelemetrySpec(id string) models.ProtocolSpec {
	return models.ProtocolSpec{
		ID:          id,
		Name:        "Temperature Telemetry",
		Version:     "1.0",
		Description: "ESP32 temperature sensor UART frame (LCP-compatible AA/BB, FID=T). Payload: sensor_id, temperature_celsius (float32), humidity_percent (uint16).",
		FrameDef: &models.FrameDef{
			StartByte:   "AA",
			EndByte:     "BB",
			Endian:      "big",
			CrcPosition: "before_end",
			Header: []models.FieldSpec{
				{Name: "length", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "fid", Length: 1, Type: "uint8"},
				{Name: "seq_no", Length: 2, Type: "uint16", Endian: "big"},
				{Name: "attr", Length: 1, Type: "uint8"},
			},
			Tail: []models.FieldSpec{
				{Name: "crc16", Length: 2, Type: "uint16", Endian: "big"},
			},
		},
		Fields: []models.FieldSpec{
			{Name: "temperature_celsius", Type: "float", Unit: "°C"},
			{Name: "humidity_percent", Type: "uint16", Unit: "%"},
			{Name: "sensor_id", Type: "uint8"},
		},
		FIDPayloads: []models.FIDPayload{
			{
				FID:         "54",
				Name:        "Temperature Telemetry",
				Description: "On-board temperature and humidity sample",
				Fields: []models.FieldSpec{
					{Name: "sensor_id", Length: 1, Type: "uint8"},
					{Name: "temperature_celsius", Length: 4, Type: "float", Endian: "little"},
					{Name: "humidity_percent", Length: 2, Type: "uint16", Endian: "little"},
				},
			},
		},
	}
}

// BuildTemperatureFrame encodes a temperature telemetry UART frame.
func BuildTemperatureFrame(seq uint16, sensorID uint8, tempC float32, humidity uint16) (string, error) {
	payload := make([]byte, 7)
	payload[0] = sensorID
	binary.LittleEndian.PutUint32(payload[1:5], math.Float32bits(tempC))
	binary.LittleEndian.PutUint16(payload[5:7], humidity)

	frame, err := buildLCPFrame(TemperatureFID, seq, payload)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(frame), nil
}

func buildLCPFrame(fid byte, seq uint16, payload []byte) ([]byte, error) {
	const headerAfterLength = 1 + 2 + 1 // fid + seq + attr
	lengthVal := uint16(2 + headerAfterLength + len(payload))

	frameBody := make([]byte, 0, int(lengthVal)+2)
	frameBody = append(frameBody, byte(lengthVal>>8), byte(lengthVal))
	frameBody = append(frameBody, fid)
	frameBody = append(frameBody, byte(seq>>8), byte(seq))
	frameBody = append(frameBody, 0x00)
	frameBody = append(frameBody, payload...)

	crc := crc16CCITT(frameBody)
	frameBody = append(frameBody, byte(crc>>8), byte(crc))

	out := make([]byte, 0, len(frameBody)+2)
	out = append(out, 0xAA)
	out = append(out, frameBody...)
	out = append(out, 0xBB)
	return out, nil
}

// FlattenTemperatureFields copies payload.* parse results to top-level keys for viz/dashboard.
func FlattenTemperatureFields(fields map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(fields)+3)
	for k, v := range fields {
		out[k] = v
	}
	copyKeys := map[string]string{
		"payload.temperature_celsius": "temperature_celsius",
		"payload.humidity_percent":    "humidity_percent",
		"payload.sensor_id":         "sensor_id",
	}
	for src, dst := range copyKeys {
		if v, ok := fields[src]; ok {
			out[dst] = toFloat64(v)
		}
		if v, ok := fields[src+"_display"]; ok {
			out[dst+"_display"] = v
		}
	}
	return out
}

func toFloat64(v interface{}) interface{} {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case uint64:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return v
	}
}

// ParseTemperatureFrame parses hex and returns flattened fields for storage/display.
func ParseTemperatureFrame(hexStr string, spec *models.ProtocolSpec) (map[string]interface{}, error) {
	parsed, err := ParseAndFlatten(hexStr, spec)
	if err != nil {
		return nil, fmt.Errorf("parse temperature frame: %w", err)
	}
	return FlattenTemperatureFields(parsed), nil
}
