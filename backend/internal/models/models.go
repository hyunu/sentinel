package models

import "time"

type Board struct {
	ID              string    `json:"id" bson:"_id"`
	Name            string    `json:"name" bson:"name"`
	MACAddress      string    `json:"mac_address" bson:"mac_address"`
	FirmwareVersion string    `json:"firmware_version,omitempty" bson:"firmware_version,omitempty"`
	LastHeartbeat   time.Time `json:"last_heartbeat" bson:"last_heartbeat"`
	IsActive        bool      `json:"is_active" bson:"is_active"`
	CreatedAt       time.Time `json:"created_at" bson:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" bson:"updated_at"`
}

type Heartbeat struct {
	BoardID   string    `json:"board_id" bson:"board_id"`
	Timestamp time.Time `json:"timestamp" bson:"timestamp"`
}

type FieldSpec struct {
	Name         string            `json:"name" bson:"name"`
	Offset       int               `json:"offset,omitempty" bson:"offset,omitempty"`
	Length       int               `json:"length,omitempty" bson:"length,omitempty"`
	Type         string            `json:"type" bson:"type"`
	Unit         string            `json:"unit,omitempty" bson:"unit,omitempty"`
	Endian       string            `json:"endian,omitempty" bson:"endian,omitempty"`
	EnumMapping  map[string]int    `json:"enum_mapping,omitempty" bson:"enum_mapping,omitempty"`
	Fields       []FieldSpec       `json:"fields,omitempty" bson:"fields,omitempty"`
	Flag         string            `json:"flag,omitempty" bson:"flag,omitempty"`
	Condition    string            `json:"condition,omitempty" bson:"condition,omitempty"`
	Repeat       string            `json:"repeat,omitempty" bson:"repeat,omitempty"`
}

type FrameDef struct {
	StartByte   string      `json:"start_byte" bson:"start_byte"`
	EndByte     string      `json:"end_byte" bson:"end_byte"`
	Header      []FieldSpec `json:"header" bson:"header"`
	Tail        []FieldSpec `json:"tail" bson:"tail"`
	Endian      string      `json:"endian" bson:"endian"`
	CrcPosition string      `json:"crc_position,omitempty" bson:"crc_position,omitempty"`
}

type FIDPayload struct {
	FID         string      `json:"fid" bson:"fid"`
	Name        string      `json:"name" bson:"name"`
	Description string      `json:"description,omitempty" bson:"description,omitempty"`
	Fields      []FieldSpec `json:"fields,omitempty" bson:"fields,omitempty"`
}

type ProtocolSpec struct {
	ID          string       `json:"id" bson:"_id"`
	Name        string       `json:"name" bson:"name"`
	Version     string       `json:"version" bson:"version"`
	Description string       `json:"description,omitempty" bson:"description,omitempty"`
	FrameDef    *FrameDef    `json:"frame_def,omitempty" bson:"frame_def,omitempty"`
	Fields      []FieldSpec  `json:"fields" bson:"fields"`
	FIDPayloads []FIDPayload `json:"fid_payloads,omitempty" bson:"fid_payloads,omitempty"`
	CreatedAt   time.Time    `json:"created_at" bson:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at" bson:"updated_at"`
}

type UartData struct {
	ID           string                 `json:"id" bson:"_id"`
	BoardID      string                 `json:"board_id" bson:"board_id"`
	SessionID    string                 `json:"session_id,omitempty" bson:"session_id,omitempty"`
	Timestamp    time.Time              `json:"timestamp" bson:"timestamp"`
	RawHex       string                 `json:"raw_hex" bson:"raw_hex"`
	ParsedFields map[string]interface{} `json:"parsed_fields,omitempty" bson:"parsed_fields,omitempty"`
	Direction    string                 `json:"direction" bson:"direction"`
}

type Session struct {
	ID             string            `json:"id" bson:"_id"`
	BoardID        string            `json:"board_id" bson:"board_id"`
	Name           string            `json:"name" bson:"name"`
	Description    string            `json:"description,omitempty" bson:"description,omitempty"`
	StartTime      time.Time         `json:"start_time" bson:"start_time"`
	EndTime        time.Time         `json:"end_time,omitempty" bson:"end_time,omitempty"`
	Tags           []string          `json:"tags,omitempty" bson:"tags,omitempty"`
	AutoSplitRule  *SplitRule        `json:"auto_split_rule,omitempty" bson:"auto_split_rule,omitempty"`
	CreatedAt      time.Time         `json:"created_at" bson:"created_at"`
}

type SplitRule struct {
	Type   string                 `json:"type" bson:"type"`
	Params map[string]interface{} `json:"params" bson:"params"`
}

type Temperature struct {
	ID            string    `json:"id" bson:"_id"`
	BoardID       string    `json:"board_id" bson:"board_id"`
	Timestamp     time.Time `json:"timestamp" bson:"timestamp"`
	ValueCelsius  float64   `json:"value_celsius" bson:"value_celsius"`
}

type VizProfile struct {
	ID          string     `json:"id" bson:"_id"`
	Name        string     `json:"name" bson:"name"`
	Description string     `json:"description,omitempty" bson:"description,omitempty"`
	BoardID     string     `json:"board_id" bson:"board_id"`
	SessionIDs  []string   `json:"session_ids,omitempty" bson:"session_ids,omitempty"`
	TimeRange   *TimeRange `json:"time_range,omitempty" bson:"time_range,omitempty"`
	Items       []VizItem  `json:"items" bson:"items"`
	CreatedAt   time.Time  `json:"created_at" bson:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" bson:"updated_at"`
}

type TimeRange struct {
	Start time.Time `json:"start" bson:"start"`
	End   time.Time `json:"end" bson:"end"`
}

type VizItem struct {
	ID        string          `json:"id" bson:"id"`
	Label     string          `json:"label" bson:"label"`
	Color     string          `json:"color" bson:"color"`
	Visible   bool            `json:"visible" bson:"visible"`
	FieldRef  FieldRef        `json:"field_ref" bson:"field_ref"`
	ChartType string          `json:"chart_type" bson:"chart_type"`
	YAxis     YAxisConfig     `json:"y_axis" bson:"y_axis"`
	Offset    float64         `json:"offset" bson:"offset"`
	Weight    float64         `json:"weight" bson:"weight"`
}

type FieldRef struct {
	ProtocolID string `json:"protocol_id" bson:"protocol_id"`
	FieldName  string `json:"field_name" bson:"field_name"`
}

type YAxisConfig struct {
	ID    string  `json:"id" bson:"id"`
	Label string  `json:"label" bson:"label"`
	Unit  string  `json:"unit,omitempty" bson:"unit,omitempty"`
	Min   float64 `json:"min,omitempty" bson:"min,omitempty"`
	Max   float64 `json:"max,omitempty" bson:"max,omitempty"`
}
