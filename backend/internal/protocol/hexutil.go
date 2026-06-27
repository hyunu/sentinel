package protocol

import (
	"encoding/hex"
	"strings"
)

func hexStringToBytes(s string) ([]byte, error) {
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\t", "")
	return hex.DecodeString(s)
}

func bytesToHexUpper(data []byte) string {
	return strings.ToUpper(hex.EncodeToString(data))
}
