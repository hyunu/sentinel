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

// buildLCPRuleFrame builds a full AA..BB frame with LEN/CRC filled automatically.
func buildLCPRuleFrame(fid byte, payload []byte) string {
	total := 10 + len(payload)
	body := []byte{byte(total >> 8), byte(total & 0xFF), fid, 0x00, 0x01, 0x00}
	body = append(body, payload...)
	frame := append([]byte{0xAA}, body...)
	crc := crc16XMODEM(frame)
	frame = append(frame, byte(crc>>8), byte(crc&0xFF), 0xBB)
	return bytesToHexUpper(frame)
}

func parsePayloadTree(t *testing.T, hexStr string) map[string]interface{} {
	t.Helper()
	result, err := Parse(hexStr, lcpRuleSpec())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !result.Valid {
		t.Fatalf("CRC invalid: %s", result.Error)
	}
	tree, ok := result.Tree["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload tree: %T", result.Tree["payload"])
	}
	return tree
}

func TestLCPParseRulesAllFIDs(t *testing.T) {
	// 0xC8 INIT / 0xC7 Instant Monitor / 0xCE HEARTBEAT: empty payload
	for _, fid := range []byte{0xC7, 0xC8, 0xCE} {
		result, err := Parse(buildLCPRuleFrame(fid, nil), lcpRuleSpec())
		if err != nil {
			t.Fatalf("FID %02X: %v", fid, err)
		}
		if !result.Valid {
			t.Fatalf("FID %02X CRC: %s", fid, result.Error)
		}
	}

	// 0xC9 event: event_code + event_data
	tree := parsePayloadTree(t, buildLCPRuleFrame(0xC9, []byte{0x05, 0x11, 0x22, 0x33}))
	if tree["event_code"] != 0x05 {
		t.Fatalf("event_code: %#v", tree["event_code"])
	}
	if tree["event_data"] != "112233" {
		t.Fatalf("event_data: %#v", tree["event_data"])
	}

	// 0xCA data dump
	tree = parsePayloadTree(t, buildLCPRuleFrame(0xCA, []byte{0xDE, 0xAD, 0xBE, 0xEF}))
	if tree["dump"] != "DEADBEEF" {
		t.Fatalf("dump: %#v", tree["dump"])
	}

	// 0xCC packet ACK
	tree = parsePayloadTree(t, buildLCPRuleFrame(0xCC, []byte{0xC9, 0xF0}))
	if tree["recv_fid"] != 0xC9 || tree["error_code"] != 0xF0 {
		t.Fatalf("ack: %#v", tree)
	}

	// 0xCF function call with set-and-get-monitor block flag (0xFB)
	tree = parsePayloadTree(t, buildLCPRuleFrame(0xCF, []byte{
		0x01,
		0xFB, 0x07, 0x20, 0x01, 0xFA, 0x03, 0x07,
	}))
	fns, ok := tree["functions"].([]interface{})
	if !ok || len(fns) != 1 {
		t.Fatalf("functions: %#v", tree["functions"])
	}
}

func TestLCPParseRulesCDF9Monitor(t *testing.T) {
	// one FD result block + one F9 monitor block, counted together
	payload := []byte{
		0x02,
		0xFD, 0x03, 0x1A,
		0xF9, 0x05, 0xF0, 0xAA, 0xBB,
	}
	tree := parsePayloadTree(t, buildLCPRuleFrame(0xCD, payload))
	if tree["result_count"] != 0x02 {
		t.Fatalf("result_count: %#v", tree["result_count"])
	}
	blocks, ok := tree["results"].([]interface{})
	if !ok || len(blocks) != 2 {
		t.Fatalf("results: %#v", tree["results"])
	}
	mon, ok := blocks[1].(map[string]interface{})["monitor"].(map[string]interface{})
	if !ok {
		t.Fatalf("monitor block: %#v", blocks[1])
	}
	if mon["dms_result"] != 0xF0 || mon["monitor_data"] != "AABB" {
		t.Fatalf("monitor: %#v", mon)
	}
}

func TestLCPParseRealDataDump(t *testing.T) {
	// real 0xCA frame captured from device (LCP_TEST_M8 CSV)
	hex := "AA0081CA071B000000000000000001000000000000800C000000000000000000001202120201017D0A64000000000100000123012B011B010027191A2121271927191900000100010000000000000700010100010000020000160D1D0D160D95062C00010097060000000059C1D001F08F0121C2D00155D32A2302011F00C624BB"
	result, err := Parse(hex, lcpRuleSpec())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !result.Valid {
		t.Fatalf("CRC invalid: %s", result.Error)
	}
	if result.FID != "CA" {
		t.Fatalf("FID: want CA, got %s", result.FID)
	}
	if result.Length != 129 {
		t.Fatalf("length: want 129, got %d", result.Length)
	}
}

func TestLCPParseRealCDResult(t *testing.T) {
	// real 0xCD frame captured from device (LCP_TEST_M8 CSV)
	hex := "AA0014CD001C0003FD031AFD031BFD03193BACBB"
	tree := parsePayloadTree(t, hex)
	blocks, ok := tree["results"].([]interface{})
	if !ok || len(blocks) != 3 {
		t.Fatalf("results: %#v", tree["results"])
	}
}
