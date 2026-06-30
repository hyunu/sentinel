package protocol

// crc16CCITT computes CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF).
func crc16CCITT(data []byte) uint16 {
	return crc16WithInit(data, 0xFFFF)
}

// crc16XMODEM computes CRC-16/XMODEM (poly 0x1021, init 0x0000).
// LCP/OSP UART frames use this over STX(AA) through the last payload byte.
func crc16XMODEM(data []byte) uint16 {
	return crc16WithInit(data, 0x0000)
}

func crc16WithInit(data []byte, init uint16) uint16 {
	crc := init
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// lcpFrameCRCRange returns [start, end) for CRC input on AA..BB frames.
func lcpFrameCRCRange(data []byte) (start, end int, ok bool) {
	if len(data) < 4 || data[0] != 0xAA || data[len(data)-1] != 0xBB {
		return 0, 0, false
	}
	end = len(data) - 3 // exclude CRC(2) + BB(1)
	if end < 1 {
		return 0, 0, false
	}
	return 0, end, true
}
