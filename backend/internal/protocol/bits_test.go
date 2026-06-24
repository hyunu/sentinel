package protocol

import (
	"testing"

	"github.com/hyunu/sentinel/internal/models"
)

func TestReadBitsLSB_SingleByte(t *testing.T) {
	data := []byte{0b10110101} // 0xB5

	tests := []struct {
		bitOff, bitLen int
		want           uint64
	}{
		{0, 1, 1}, // LSB
		{1, 2, 2}, // bits 1-2 = 10
		{4, 4, 0xB},
		{0, 8, 0xB5},
	}
	for _, tt := range tests {
		got, _, _, err := readBitsLSB(data, 0, tt.bitOff, tt.bitLen, 1)
		if err != nil {
			t.Fatalf("bitOff=%d bitLen=%d: %v", tt.bitOff, tt.bitLen, err)
		}
		if got != tt.want {
			t.Errorf("bitOff=%d bitLen=%d: got %d want %d", tt.bitOff, tt.bitLen, got, tt.want)
		}
	}
}

func TestParseCursorSequentialBits(t *testing.T) {
	// 1 + 2 + 5 bits in one byte: 1, 11, 10101 -> 0b10101101 = 0xAD? Let's compute
	// bit0=1, bits1-2=11, bits3-7=10101
	// value = 1 | (3<<1) | (21<<3) = 1+6+168 = 175 = 0xAF
	data := []byte{0xAF}
	fields := []models.FieldSpec{
		{Name: "a", BitLength: 1, Type: "uint8"},
		{Name: "b", BitLength: 2, Type: "uint8"},
		{Name: "c", BitLength: 5, Type: "uint8"},
	}
	c := &parseCursor{}
	result := make(map[string]interface{})

	for _, f := range fields {
		v, err := readBitField(data, c, f)
		if err != nil {
			t.Fatal(err)
		}
		result[f.Name] = v
	}
	if result["a"].(uint64) != 1 {
		t.Fatalf("a=%v", result["a"])
	}
	if result["b"].(uint64) != 3 {
		t.Fatalf("b=%v", result["b"])
	}
	if result["c"].(uint64) != 21 {
		t.Fatalf("c=%v", result["c"])
	}
	if c.byteOff != 1 || c.bitOff != 0 {
		t.Fatalf("cursor byteOff=%d bitOff=%d want 1,0", c.byteOff, c.bitOff)
	}
}

func TestReadBitFieldExplicitOffset(t *testing.T) {
	data := []byte{0x5A} // 01011010
	off := 4
	spec := models.FieldSpec{
		Name:       "retry",
		Length:     1,
		BitOffset:  &off,
		BitLength:  4,
		Type:       "uint8",
	}
	c := &parseCursor{}
	v, err := readBitField(data, c, spec)
	if err != nil {
		t.Fatal(err)
	}
	if v != 0x5 {
		t.Fatalf("got %d want 5", v)
	}
}
