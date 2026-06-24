package api

import (
	"fmt"
	"strings"
	"unicode"
)

// normalizeMacHex strips separators and lowercases (e.g. "AA:BB:..." -> "aabb...").
func normalizeMacHex(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// macHexToColon formats 12 hex digits as AA:BB:CC:DD:EE:FF.
func macHexToColon(hex string) string {
	hex = normalizeMacHex(hex)
	if len(hex) != 12 {
		return ""
	}
	return fmt.Sprintf("%s:%s:%s:%s:%s:%s",
		strings.ToUpper(hex[0:2]), strings.ToUpper(hex[2:4]), strings.ToUpper(hex[4:6]),
		strings.ToUpper(hex[6:8]), strings.ToUpper(hex[8:10]), strings.ToUpper(hex[10:12]),
	)
}

// wifiMacFromBoardID extracts WiFi MAC from firmware board_id (sentinel_aabbcc...).
func wifiMacFromBoardID(boardID string) string {
	const prefix = "sentinel_"
	if !strings.HasPrefix(strings.ToLower(boardID), prefix) {
		return ""
	}
	return macHexToColon(boardID[len(prefix):])
}
