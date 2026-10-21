package protocol

import (
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

const (
	PresetLCPProtocolID    = "preset-lcp-protocol-rules"
	PresetTemperatureProto = "preset-temperature-protocol"
)

func DefaultSchemaPresets(now time.Time) []models.SchemaPreset {
	lcpRules := DefaultLCPParseRules()
	tempRules := loadTemperatureRules()

	return []models.SchemaPreset{
		{
			ID:              PresetLCPProtocolID,
			Name:            "LCP/OSP Function Protocol",
			Description:     "Serial Parser rules: full frame + FID C7/C8/C9/CA/CC/CD/CE/CF, FA/FC/F9 blocks",
			ProtocolVersion: "2.0",
			ParseRules:      &lcpRules,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
		{
			ID:              PresetTemperatureProto,
			Name:            "Temperature Telemetry",
			Description:     "AA/BB frame, FID=T, sensor_id + float32 temp + uint16 humidity",
			ProtocolVersion: "1.0",
			ParseRules:      &tempRules,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	}
}
