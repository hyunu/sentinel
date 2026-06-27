package protocol

import "github.com/hyunu/sentinel/internal/models"

// DefaultFrameDef is the LCP AA/BB envelope preset (used by templates and seed data).
var DefaultFrameDef = models.FrameDef{
	StartByte:       "AA",
	EndByte:         "BB",
	CrcPosition:     "before_end",
	Endian:          "big",
	PayloadKeyField: "fid",
	LengthField:     "length",
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

// LCPTypeCatalog example type_id → field schema (preset fragment; extend in protocol spec).
var LCPTypeCatalog = map[string][]models.FieldSpec{
	"01": {{Name: "value", Length: 2, Type: "uint16", Endian: "little"}},
	"02": {{Name: "value", Length: 4, Type: "float", Endian: "little"}},
}

func lcpArgumentBlockFields() []models.FieldSpec {
	return []models.FieldSpec{
		{Name: "type_id", Length: 1, Type: "uint8"},
		{
			Name:             "value",
			Type:             "dispatch",
			DispatchOn:       "type_id",
			DispatchVariants: LCPTypeCatalog,
			DefaultFields:    []models.FieldSpec{{Name: "raw", Type: "raw", LengthMode: "remaining"}},
		},
	}
}

func lcpCFPayloadFields() []models.FieldSpec {
	return []models.FieldSpec{
		{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
		{
			Name:         "blocks",
			Type:         "tagged_repeat",
			TaggedLayout: "flag_len_body",
			TaggedUntil:  "no_matching_flag",
			Fields: []models.FieldSpec{
				{Flag: "FA", Name: "argument", Fields: lcpArgumentBlockFields()},
				{Flag: "FB", Name: "metadata", Fields: []models.FieldSpec{
					{Name: "meta_key", Length: 1, Type: "uint8"},
					{Name: "meta_value", Type: "raw", LengthMode: "remaining"},
				}},
			},
		},
	}
}

func lcpCDPayloadFields() []models.FieldSpec {
	return []models.FieldSpec{
		{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
		{
			Name:         "result",
			Type:         "tagged_block",
			TaggedLayout: "flag_len_body",
			Fields: []models.FieldSpec{
				{Flag: "FD", Name: "success", Fields: []models.FieldSpec{
					{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
					{Name: "result_data", Type: "raw", LengthMode: "remaining"},
				}},
				{Flag: "FE", Name: "error", Fields: []models.FieldSpec{
					{Name: "function_id", Length: 2, Type: "uint16", Endian: "little"},
					{Name: "error_code", Length: 1, Type: "uint8"},
				}},
			},
		},
	}
}

// DefaultLCPFIDPayloads holds LCP message schemas expressed with generic compositors only.
var DefaultLCPFIDPayloads = []models.FIDPayload{
	{FID: "CF", Name: "Function Call", Fields: lcpCFPayloadFields()},
	{FID: "CD", Name: "Function ACK", Fields: lcpCDPayloadFields()},
	{FID: "CA", Name: "Data Transfer", Fields: []models.FieldSpec{
		{Name: "raw_data", Type: "raw", LengthMode: "remaining"},
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
		{Name: "event_data", Type: "raw", LengthMode: "remaining"},
	}},
}
