package protocol

import (
	"time"

	"github.com/hyunu/sentinel/internal/models"
)

const (
	PresetLCPFrameID       = "preset-lcp-frame"
	PresetLCPCFPayloadID   = "preset-lcp-cf-payload"
	PresetLCPCDPayloadID   = "preset-lcp-cd-payload"
	PresetTemperatureProto = "preset-temperature-protocol"
)

// DefaultSchemaPresets returns built-in presets seeded on first startup.
func DefaultSchemaPresets(now time.Time) []models.SchemaPreset {
	frame := DefaultFrameDef
	temp := TemperatureTelemetrySpec("")

	return []models.SchemaPreset{
		{
			ID:          PresetLCPFrameID,
			Name:        "LCP AA/BB Frame",
			Description: "AA/BB envelope: length, fid, seq_no, attr, CRC16",
			Category:    "frame",
			FrameDef:    &frame,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          PresetLCPCFPayloadID,
			Name:        "LCP CF (Function Call)",
			Description: "function_id + FA/FB tagged_repeat blocks",
			Category:    "payload",
			Fields:      lcpCFPayloadFields(),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          PresetLCPCDPayloadID,
			Name:        "LCP CD (Function ACK)",
			Description: "function_id + FD/FE tagged_block result",
			Category:    "payload",
			Fields:      lcpCDPayloadFields(),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:              PresetTemperatureProto,
			Name:            temp.Name,
			Description:     temp.Description,
			Category:        "protocol",
			ProtocolVersion: temp.Version,
			FrameDef:        temp.FrameDef,
			FIDPayloads:     temp.FIDPayloads,
			CreatedAt:       now,
			UpdatedAt:       now,
		},
	}
}
