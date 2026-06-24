package protocol

import (
	"fmt"

	"github.com/hyunu/sentinel/internal/models"
)

type parseCursor struct {
	byteOff int
	bitOff  int
}

func (c *parseCursor) alignByte() {
	if c.bitOff > 0 {
		c.byteOff++
		c.bitOff = 0
	}
}

// readBitsLSB reads bitLen bits from data starting at byteOff:bitOff (LSB=0).
// maxBytes limits the container span from byteOff.
func readBitsLSB(data []byte, byteOff, bitOff, bitLen, maxBytes int) (uint64, int, int, error) {
	if bitLen <= 0 {
		return 0, byteOff, bitOff, fmt.Errorf("bit_length must be positive")
	}
	if bitOff < 0 || bitOff > 7 {
		return 0, byteOff, bitOff, fmt.Errorf("bit_offset must be 0-7")
	}
	if maxBytes <= 0 {
		maxBytes = (bitLen + bitOff + 7) / 8
	}
	if byteOff+maxBytes > len(data) {
		return 0, byteOff, bitOff, fmt.Errorf("bit read exceeds data: need %d bytes at %d", maxBytes, byteOff)
	}

	var value uint64
	bitsRead := 0
	curByte := byteOff
	curBit := bitOff

	for bitsRead < bitLen {
		if curByte-byteOff >= maxBytes {
			return 0, byteOff, bitOff, fmt.Errorf("bit field spans beyond %d-byte container", maxBytes)
		}
		available := 8 - curBit
		take := bitLen - bitsRead
		if take > available {
			take = available
		}
		mask := uint64((1 << uint(take)) - 1)
		chunk := (uint64(data[curByte]) >> uint(curBit)) & mask
		value |= chunk << uint(bitsRead)
		bitsRead += take
		curBit += take
		if curBit >= 8 {
			curBit = 0
			curByte++
		}
	}

	return value, curByte, curBit, nil
}

func readBitField(data []byte, c *parseCursor, spec models.FieldSpec) (uint64, error) {
	bitLen := spec.BitLength
	container := spec.Length
	if container <= 0 {
		container = (bitLen + 7) / 8
	}

	if spec.BitOffset != nil {
		bitStart := *spec.BitOffset
		val, _, _, err := readBitsLSB(data, c.byteOff, bitStart, bitLen, container)
		if err != nil {
			return 0, err
		}
		c.byteOff += container
		c.bitOff = 0
		return val, nil
	}

	val, newByte, newBit, err := readBitsLSB(data, c.byteOff, c.bitOff, bitLen, container)
	if err != nil {
		return 0, err
	}
	c.byteOff = newByte
	c.bitOff = newBit
	if c.bitOff >= 8 {
		c.byteOff++
		c.bitOff = 0
	}
	return val, nil
}

func readBitFieldAbsolute(data []byte, spec models.FieldSpec) (uint64, error) {
	bitLen := spec.BitLength
	if bitLen <= 0 {
		return 0, fmt.Errorf("bit_length required")
	}
	container := spec.Length
	if container <= 0 {
		container = (bitLen + 7) / 8
	}
	bitStart := 0
	if spec.BitOffset != nil {
		bitStart = *spec.BitOffset
	}
	val, _, _, err := readBitsLSB(data, spec.Offset, bitStart, bitLen, container)
	return val, err
}

func isBitField(spec models.FieldSpec) bool {
	return spec.BitLength > 0
}
