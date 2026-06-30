package protocol

import (
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"

	"github.com/hyunu/sentinel/internal/models"
	"github.com/hyunu/sentinel/internal/ruleparser"
)

const TemperatureProtocolID = "temperature-telemetry-v1"
const TemperatureFID = byte('T')

//go:embed temperature_rules.json
var temperatureRulesJSON []byte

func loadTemperatureRules() ruleparser.JsonRuleDocument {
	var doc ruleparser.JsonRuleDocument
	if err := json.Unmarshal(temperatureRulesJSON, &doc); err != nil {
		panic("temperature_rules.json: " + err.Error())
	}
	return doc
}

// TemperatureTelemetrySpec returns the UART protocol for ESP32 temperature telemetry.
func TemperatureTelemetrySpec(id string) models.ProtocolSpec {
	rules := loadTemperatureRules()
	return models.ProtocolSpec{
		ID:          id,
		Name:        "Temperature Telemetry",
		Version:     "1.0",
		Description: "ESP32 temperature sensor UART frame (AA/BB, FID=T). Payload: sensor_id, temperature_celsius, humidity_percent.",
		ParseRules:  &rules,
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
	const headerAfterLength = 1 + 2 + 1
	lengthVal := uint16(2 + headerAfterLength + len(payload))

	frameBody := make([]byte, 0, int(lengthVal)+2)
	frameBody = append(frameBody, byte(lengthVal>>8), byte(lengthVal))
	frameBody = append(frameBody, fid)
	frameBody = append(frameBody, byte(seq>>8), byte(seq))
	frameBody = append(frameBody, 0x00)
	frameBody = append(frameBody, payload...)

	out := make([]byte, 0, len(frameBody)+4)
	out = append(out, 0xAA)
	out = append(out, frameBody...)
	crc := crc16XMODEM(out)
	out = append(out, byte(crc>>8), byte(crc&0xFF), 0xBB)
	return out, nil
}

// FlattenTemperatureFields maps payload.* keys to top-level viz keys.
func FlattenTemperatureFields(fields map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(fields)+3)
	for k, v := range fields {
		out[k] = v
	}
	copyKeys := map[string]string{
		"payload.temperature_celsius": "temperature_celsius",
		"payload.humidity_percent":    "humidity_percent",
		"payload.sensor_id":           "sensor_id",
	}
	for src, dst := range copyKeys {
		if v, ok := fields[src]; ok {
			out[dst] = toFloat64(v)
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
