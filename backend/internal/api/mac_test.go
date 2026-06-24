package api

import "testing"

func TestNormalizeMacHex(t *testing.T) {
	if got := normalizeMacHex("AA:BB:CC:DD:EE:FF"); got != "aabbccddeeff" {
		t.Fatalf("got %q", got)
	}
}

func TestMacHexToColon(t *testing.T) {
	if got := macHexToColon("aabbccddeeff"); got != "AA:BB:CC:DD:EE:FF" {
		t.Fatalf("got %q", got)
	}
}

func TestWifiMacFromBoardID(t *testing.T) {
	if got := wifiMacFromBoardID("sentinel_aabbccddeeff"); got != "AA:BB:CC:DD:EE:FF" {
		t.Fatalf("got %q", got)
	}
}
