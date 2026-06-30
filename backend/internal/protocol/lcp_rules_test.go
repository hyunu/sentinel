package protocol

import (
	"testing"

	"github.com/hyunu/sentinel/internal/models"
)

func buildRuleTestFrame(body []byte) string {
	frame := append([]byte{0xAA}, body...)
	crc := crc16XMODEM(frame)
	frame = append(frame, byte(crc>>8), byte(crc&0xFF), 0xBB)
	return bytesToHexUpper(frame)
}

func lcpRuleSpec() *models.ProtocolSpec {
	rules := DefaultLCPParseRules()
	return &models.ProtocolSpec{ParseRules: &rules}
}

func TestLCPParseRulesCF(t *testing.T) {
	payload := []byte{
		0x01,
		0xFC, 0x0A, 0x01, 0x01,
		0xFA, 0x04, 0x34, 0x12,
	}
	body := append([]byte{0x00, 0x10, 0xCF, 0x00, 0x00, 0x00}, payload...)
	hexStr := buildRuleTestFrame(body)

	result, err := Parse(hexStr, lcpRuleSpec())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if result.FID != "CF" {
		t.Fatalf("FID: want CF, got %s", result.FID)
	}
	if !result.Valid {
		t.Fatalf("CRC invalid: %s", result.Error)
	}

	payloadTree, ok := result.Tree["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload tree: %T", result.Tree["payload"])
	}
	fns, ok := payloadTree["functions"].([]interface{})
	if !ok || len(fns) != 1 {
		t.Fatalf("functions: %#v", payloadTree["functions"])
	}
}

func TestLCPParseRulesCD(t *testing.T) {
	payload := []byte{
		0x02,
		0xFE, 0x04, 0x01, 0x05,
		0xFD, 0x03, 0x02,
	}
	body := append([]byte{0x00, 0x0E, 0xCD, 0x00, 0x00, 0x00}, payload...)
	hexStr := buildRuleTestFrame(body)

	result, err := Parse(hexStr, lcpRuleSpec())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if result.FID != "CD" {
		t.Fatalf("FID: want CD, got %s", result.FID)
	}
}

func TestParseRequiresRules(t *testing.T) {
	_, err := Parse("AA", &models.ProtocolSpec{Name: "empty"})
	if err == nil {
		t.Fatal("expected error for missing parse_rules")
	}
}

func TestUserPacketFromDevice(t *testing.T) {
	hex := "AA0024CF006F0003FC081A01FA04A406FC071B01FA0301FC0A1902FA0300FA030494DEBB"
	result, err := Parse(hex, lcpRuleSpec())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !result.Valid {
		t.Fatalf("CRC invalid: %s", result.Error)
	}
	if result.FID != "CF" {
		t.Fatalf("FID: want CF, got %s", result.FID)
	}
}
