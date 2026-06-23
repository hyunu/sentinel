package protocol

import (
	"strings"

	"github.com/hyunu/sentinel/internal/models"
)

// IsTemperatureFrame reports whether raw hex looks like a Temperature Telemetry frame (FID 'T').
func IsTemperatureFrame(rawHex string) bool {
	data, err := hexStringToBytes(rawHex)
	if err != nil || len(data) < 5 {
		return false
	}
	start := 0
	if data[0] == 0xAA {
		start = 1
	}
	// AA + length(2) + fid
	if start+3 > len(data) {
		return false
	}
	return data[start+2] == TemperatureFID
}

// ParseForStorage parses UART hex with an optional protocol id; auto-detects temperature frames.
func ParseForStorage(rawHex, protocolID string, spec *models.ProtocolSpec) map[string]interface{} {
	if spec != nil {
		if spec.ID == TemperatureProtocolID || spec.Name == "Temperature Telemetry" {
			if parsed, err := ParseTemperatureFrame(rawHex, spec); err == nil {
				return parsed
			}
		}
		if parsed, err := ParseAndFlatten(rawHex, spec); err == nil {
			return parsed
		}
	}

	if IsTemperatureFrame(rawHex) {
		tempSpec := TemperatureTelemetrySpec(TemperatureProtocolID)
		if parsed, err := ParseTemperatureFrame(rawHex, &tempSpec); err == nil {
			return parsed
		}
	}

	return nil
}

// BuildTemperatureFrameFromValue builds a telemetry frame for a temperature reading.
func BuildTemperatureFrameFromValue(seq uint16, tempC float32) (string, map[string]interface{}, error) {
	rawHex, err := BuildTemperatureFrame(seq, 0, tempC, 0)
	if err != nil {
		return "", nil, err
	}
	spec := TemperatureTelemetrySpec(TemperatureProtocolID)
	parsed, err := ParseTemperatureFrame(rawHex, &spec)
	if err != nil {
		return rawHex, nil, err
	}
	return strings.ToUpper(rawHex), parsed, nil
}
