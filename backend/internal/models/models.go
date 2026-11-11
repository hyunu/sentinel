package models

import (
	"time"

	"github.com/hyunu/sentinel/internal/ruleparser"
)

type Board struct {
	ID              string             `json:"id" bson:"_id"`
	UID             string             `json:"uid" bson:"uid"`
	Name            string             `json:"name" bson:"name"`
	MACAddress      string             `json:"mac_address" bson:"mac_address"` // BLE remote ID (iOS: UUID)
	WifiMAC         string             `json:"wifi_mac,omitempty" bson:"wifi_mac,omitempty"`
	FirmwareVersion string             `json:"firmware_version,omitempty" bson:"firmware_version,omitempty"`
	WifiRSSI        int                `json:"wifi_rssi,omitempty" bson:"wifi_rssi,omitempty"`
	Location        string             `json:"location,omitempty" bson:"location,omitempty"`
	ProtocolID      string             `json:"protocol_id,omitempty" bson:"protocol_id,omitempty"`
	SessionRules    []SessionSplitRule `json:"session_split_rules,omitempty" bson:"session_split_rules,omitempty"`
	// SessionRuleMode selects how packet rules create sessions:
	// "cut" (default) cuts at every match, "range" builds sessions between
	// start and end rules.
	SessionRuleMode string    `json:"session_rule_mode,omitempty" bson:"session_rule_mode,omitempty"`
	PendingAction   string    `json:"pending_action,omitempty" bson:"pending_action,omitempty"`
	PendingActionAt time.Time `json:"pending_action_at,omitempty" bson:"pending_action_at,omitempty"`
	LastHeartbeat   time.Time `json:"last_heartbeat" bson:"last_heartbeat"`
	IsActive        bool      `json:"is_active" bson:"is_active"`
	CreatedAt       time.Time `json:"created_at" bson:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" bson:"updated_at"`
}

// SessionSplitRule marks a session boundary when a packet matches. Rules are
// configured per board and evaluated against the board's parsed frames.
type SessionSplitRule struct {
	ID        string `json:"id" bson:"id"`
	Name      string `json:"name" bson:"name"`
	Enabled   bool   `json:"enabled" bson:"enabled"`
	FID       string `json:"fid,omitempty" bson:"fid,omitempty"`
	Direction string `json:"direction,omitempty" bson:"direction,omitempty"`
	Field     string `json:"field,omitempty" bson:"field,omitempty"`
	Operator  string `json:"operator,omitempty" bson:"operator,omitempty"`
	Value     string `json:"value,omitempty" bson:"value,omitempty"`
	// Role is used in "range" mode: "start" opens a session, "end" closes it.
	Role string `json:"role,omitempty" bson:"role,omitempty"`
}

type Heartbeat struct {
	BoardID   string    `json:"board_id" bson:"board_id"`
	Timestamp time.Time `json:"timestamp" bson:"timestamp"`
}

type ProtocolSpec struct {
	ID          string                       `json:"id" bson:"_id"`
	Name        string                       `json:"name" bson:"name"`
	Version     string                       `json:"version" bson:"version"`
	Description string                       `json:"description,omitempty" bson:"description,omitempty"`
	ParseRules  *ruleparser.JsonRuleDocument `json:"parse_rules" bson:"parse_rules"`
	// Enums are protocol-level value→label maps, kept separate from parse_rules.
	// Field rules reference them by name (rule.enum).
	Enums     map[string]map[string]string `json:"enums,omitempty" bson:"enums,omitempty"`
	CreatedAt time.Time                    `json:"created_at" bson:"created_at"`
	UpdatedAt time.Time                    `json:"updated_at" bson:"updated_at"`
}

// SchemaPreset is a reusable Serial Parser rule template.
type SchemaPreset struct {
	ID              string                       `json:"id" bson:"_id"`
	Name            string                       `json:"name" bson:"name"`
	Description     string                       `json:"description,omitempty" bson:"description,omitempty"`
	ProtocolVersion string                       `json:"protocol_version,omitempty" bson:"protocol_version,omitempty"`
	ParseRules      *ruleparser.JsonRuleDocument `json:"parse_rules" bson:"parse_rules"`
	Enums           map[string]map[string]string `json:"enums,omitempty" bson:"enums,omitempty"`
	CreatedAt       time.Time                    `json:"created_at" bson:"created_at"`
	UpdatedAt       time.Time                    `json:"updated_at" bson:"updated_at"`
}

type AISettings struct {
	ID             string    `json:"-" bson:"_id"`
	Provider       string    `json:"provider" bson:"provider"`
	BaseURL        string    `json:"base_url" bson:"base_url"`
	Model          string    `json:"model" bson:"model"`
	APIKey         string    `json:"-" bson:"api_key,omitempty"`
	HasAPIKey      bool      `json:"has_api_key" bson:"-"`
	MaxTokens      int       `json:"max_tokens" bson:"max_tokens"`
	Temperature    float64   `json:"temperature" bson:"temperature"`
	TimeoutSeconds int       `json:"timeout_seconds" bson:"timeout_seconds"`
	MaxToolRounds  int       `json:"max_tool_rounds" bson:"max_tool_rounds"`
	UpdatedAt      time.Time `json:"updated_at" bson:"updated_at"`
}

type UartData struct {
	ID           string                 `json:"id" bson:"_id"`
	BoardID      string                 `json:"board_id" bson:"board_id"`
	SessionID    string                 `json:"session_id,omitempty" bson:"session_id,omitempty"`
	Timestamp    time.Time              `json:"timestamp" bson:"timestamp"`
	RawHex       string                 `json:"raw_hex" bson:"raw_hex"`
	ParsedFields map[string]interface{} `json:"parsed_fields,omitempty" bson:"parsed_fields,omitempty"`
	Direction    string                 `json:"direction" bson:"direction"`
	// Parse metadata for audit and version-aware re-parsing.
	ParseProtocolID      string     `json:"parse_protocol_id,omitempty" bson:"parse_protocol_id,omitempty"`
	ParseProtocolVersion string     `json:"parse_protocol_version,omitempty" bson:"parse_protocol_version,omitempty"`
	ParsedAt             *time.Time `json:"parsed_at,omitempty" bson:"parsed_at,omitempty"`
	ParseStatus          string     `json:"parse_status,omitempty" bson:"parse_status,omitempty"`
}

type UartCursor struct {
	Timestamp time.Time `json:"timestamp"`
	ID        string    `json:"id"`
}

type UartQueryResult struct {
	Items      []UartData  `json:"items"`
	Total      *int64      `json:"total,omitempty"`
	HasMore    bool        `json:"has_more"`
	NextBefore *UartCursor `json:"next_before,omitempty"`
}

type Session struct {
	ID            string     `json:"id" bson:"_id"`
	BoardID       string     `json:"board_id" bson:"board_id"`
	Name          string     `json:"name" bson:"name"`
	Description   string     `json:"description,omitempty" bson:"description,omitempty"`
	StartTime     time.Time  `json:"start_time" bson:"start_time"`
	EndTime       time.Time  `json:"end_time,omitempty" bson:"end_time,omitempty"`
	Tags          []string   `json:"tags,omitempty" bson:"tags,omitempty"`
	AutoSplitRule *SplitRule `json:"auto_split_rule,omitempty" bson:"auto_split_rule,omitempty"`
	CreatedAt     time.Time  `json:"created_at" bson:"created_at"`
}

type SplitRule struct {
	Type   string                 `json:"type" bson:"type"`
	Params map[string]interface{} `json:"params" bson:"params"`
}

type Temperature struct {
	ID           string    `json:"id" bson:"_id"`
	BoardID      string    `json:"board_id" bson:"board_id"`
	Timestamp    time.Time `json:"timestamp" bson:"timestamp"`
	ValueCelsius float64   `json:"value_celsius" bson:"value_celsius"`
}

type VizAxisBounds struct {
	Min float64 `json:"min" bson:"min"`
	Max float64 `json:"max" bson:"max"`
}

// VizAxisRange pins the analog Y axes for a profile. Nil sides mean Auto.
type VizAxisRange struct {
	Left  *VizAxisBounds `json:"left,omitempty" bson:"left,omitempty"`
	Right *VizAxisBounds `json:"right,omitempty" bson:"right,omitempty"`
}

type VizProfile struct {
	ID            string                     `json:"id" bson:"_id"`
	Name          string                     `json:"name" bson:"name"`
	Description   string                     `json:"description,omitempty" bson:"description,omitempty"`
	BoardID       string                     `json:"board_id" bson:"board_id"`
	SessionIDs    []string                   `json:"session_ids,omitempty" bson:"session_ids,omitempty"`
	TimeRange     *TimeRange                 `json:"time_range,omitempty" bson:"time_range,omitempty"`
	YAxisRange    *VizAxisRange              `json:"y_axis_range,omitempty" bson:"y_axis_range,omitempty"`
	EventOverlays map[string]VizEventOverlay `json:"event_overlays,omitempty" bson:"event_overlays,omitempty"`
	Items         []VizItem                  `json:"items" bson:"items"`
	CreatedAt     time.Time                  `json:"created_at" bson:"created_at"`
	UpdatedAt     time.Time                  `json:"updated_at" bson:"updated_at"`
}

// VizEventOverlay is a per-profile override for a protocol-declared overlay.
// Missing fields fall back to the protocol metadata.
type VizEventOverlay struct {
	Type    string `json:"type,omitempty" bson:"type,omitempty"`
	Visible *bool  `json:"visible,omitempty" bson:"visible,omitempty"`
}

type TimeRange struct {
	Start time.Time `json:"start" bson:"start"`
	End   time.Time `json:"end" bson:"end"`
}

type VizItem struct {
	ID         string      `json:"id" bson:"id"`
	Label      string      `json:"label" bson:"label"`
	ShortLabel string      `json:"short_label,omitempty" bson:"short_label,omitempty"`
	Color      string      `json:"color" bson:"color"`
	Visible    bool        `json:"visible" bson:"visible"`
	FieldRef   FieldRef    `json:"field_ref" bson:"field_ref"`
	ChartType  string      `json:"chart_type" bson:"chart_type"`
	YAxis      YAxisConfig `json:"y_axis" bson:"y_axis"`
	Offset     float64     `json:"offset" bson:"offset"`
	Weight     float64     `json:"weight" bson:"weight"`
	Favorite   bool        `json:"favorite,omitempty" bson:"favorite,omitempty"`
}

type FieldRef struct {
	ProtocolID string `json:"protocol_id" bson:"protocol_id"`
	FieldName  string `json:"field_name" bson:"field_name"`
}

type CounterSeq struct {
	ID    string `json:"_id" bson:"_id"`
	Value int    `json:"value" bson:"value"`
}

type YAxisConfig struct {
	ID    string `json:"id" bson:"id"`
	Label string `json:"label" bson:"label"`
	Unit  string `json:"unit,omitempty" bson:"unit,omitempty"`
	// Min/Max are pointers so an explicit 0 survives JSON/BSON round trips.
	// Plain float64 with omitempty dropped 0 and made a fixed axis min of 0
	// silently fall back to the auto range.
	Min *float64 `json:"min,omitempty" bson:"min,omitempty"`
	Max *float64 `json:"max,omitempty" bson:"max,omitempty"`
}
