package protocol

import (
	"encoding/json"
	"testing"
)

// Real 1-byte LEN frames captured from a field device (AA [LEN] FID ... BB).
const (
	testCFCall   = "AA23CF04AC01F80F04F00101F00102F00102F0010501FB0A1F01FA061C000A12D659BB"
	testCDResult = "AA0DCD09550101FD030BCB79BB"
	testCCACK    = "AA0BCC0AE402CEF055F8BB"
	testCAMon    = "AA8ACACA4400010101010101000000000401020001000101010000800C000060070000000000008F00F71100000000500000000001000101320137011A01012215301A30302022154C00000000002A01011500000700030300010000020014100E000000000000000000000000000000D9080200000059C1D00189DE0121C2D001B9D5159B030105E2BB"
)

func parseMonitoringControl(t *testing.T, hex string) *ParseResult {
	t.Helper()
	spec := MonitoringControlProtocolSpec()
	result, err := Parse(hex, &spec)
	if err != nil {
		t.Fatalf("parse %s: %v", hex[:12], err)
	}
	return result
}

func TestMonitoringControlParsesCAFields(t *testing.T) {
	result := parseMonitoringControl(t, testCAMon)
	if result.FID != "CA" {
		t.Fatalf("fid: want CA, got %s", result.FID)
	}
	if _, ok := result.Fields["payload.aquavalve_ison"]; !ok {
		t.Fatalf("monitoring field missing (fields: %v)", result.Fields)
	}
}

func TestMonitoringControlParsesFunctionCall(t *testing.T) {
	result := parseMonitoringControl(t, testCFCall)
	if result.FID != "CF" {
		t.Fatalf("fid: want CF, got %s", result.FID)
	}

	var functions []struct {
		FunctionID int `json:"function_id"`
		ArgCount   int `json:"arg_count"`
		Args       []struct {
			Val string `json:"val"`
		} `json:"args"`
	}
	raw, _ := json.Marshal(result.Fields["payload.functions"])
	if err := json.Unmarshal(raw, &functions); err != nil {
		t.Fatalf("functions: %v", err)
	}
	if len(functions) != 1 {
		t.Fatalf("functions: want 1, got %d", len(functions))
	}
	if functions[0].FunctionID != 31 || functions[0].ArgCount != 1 {
		t.Fatalf("function: %+v", functions[0])
	}
	if len(functions[0].Args) != 1 || functions[0].Args[0].Val != "1C000A12" {
		t.Fatalf("args: %+v", functions[0].Args)
	}
}

func TestMonitoringControlParsesResultBlock(t *testing.T) {
	result := parseMonitoringControl(t, testCDResult)
	if result.FID != "CD" {
		t.Fatalf("fid: want CD, got %s", result.FID)
	}
	var results []struct {
		Flag   int `json:"flag"`
		Result struct {
			FunctionID int `json:"function_id"`
		} `json:"result"`
	}
	raw, _ := json.Marshal(result.Fields["payload.results"])
	if err := json.Unmarshal(raw, &results); err != nil {
		t.Fatalf("results: %v", err)
	}
	if len(results) != 1 || results[0].Flag != 0xFD || results[0].Result.FunctionID != 11 {
		t.Fatalf("results: %+v", results)
	}
}

func TestMonitoringControlParsesPacketACK(t *testing.T) {
	result := parseMonitoringControl(t, testCCACK)
	if result.FID != "CC" {
		t.Fatalf("fid: want CC, got %s", result.FID)
	}
	if got := result.Fields["payload.recv_fid"]; got != 0xCE {
		t.Fatalf("recv_fid: want 0xCE, got %v", got)
	}
	if got := result.Fields["payload.error_code"]; got != 0xF0 {
		t.Fatalf("error_code: want 0xF0, got %v", got)
	}
}
