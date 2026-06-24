import type { FieldSpec } from '../api';

export type ParseCursor = { byteOff: number; bitOff: number };

export function newParseCursor(): ParseCursor {
  return { byteOff: 0, bitOff: 0 };
}

export function alignByte(c: ParseCursor): void {
  if (c.bitOff > 0) {
    c.byteOff++;
    c.bitOff = 0;
  }
}

export function isBitField(spec: FieldSpec): boolean {
  return (spec.bit_length ?? 0) > 0;
}

export function readBitsLSB(
  data: number[],
  byteOff: number,
  bitOff: number,
  bitLen: number,
  maxBytes: number,
): { value: number; byteOff: number; bitOff: number } {
  if (bitLen <= 0) throw new Error('bit_length must be positive');
  if (bitOff < 0 || bitOff > 7) throw new Error('bit_offset must be 0-7');
  if (maxBytes <= 0) maxBytes = Math.ceil((bitLen + bitOff) / 8);
  if (byteOff + maxBytes > data.length) {
    throw new Error(`bit read exceeds data at ${byteOff}`);
  }

  let value = 0;
  let bitsRead = 0;
  let curByte = byteOff;
  let curBit = bitOff;

  while (bitsRead < bitLen) {
    if (curByte - byteOff >= maxBytes) {
      throw new Error(`bit field spans beyond ${maxBytes}-byte container`);
    }
    const available = 8 - curBit;
    let take = bitLen - bitsRead;
    if (take > available) take = available;
    const mask = (1 << take) - 1;
    const chunk = (data[curByte] >> curBit) & mask;
    value |= chunk << bitsRead;
    bitsRead += take;
    curBit += take;
    if (curBit >= 8) {
      curBit = 0;
      curByte++;
    }
  }

  return { value, byteOff: curByte, bitOff: curBit };
}

export function readBitField(data: number[], c: ParseCursor, spec: FieldSpec): number {
  const bitLen = spec.bit_length ?? 0;
  let container = spec.length ?? 0;
  if (container <= 0) container = Math.ceil(bitLen / 8);

  if (spec.bit_offset !== undefined && spec.bit_offset !== null) {
    const { value } = readBitsLSB(data, c.byteOff, spec.bit_offset, bitLen, container);
    c.byteOff += container;
    c.bitOff = 0;
    return value;
  }

  const { value, byteOff, bitOff } = readBitsLSB(data, c.byteOff, c.bitOff, bitLen, container);
  c.byteOff = byteOff;
  c.bitOff = bitOff;
  if (c.bitOff >= 8) {
    c.byteOff++;
    c.bitOff = 0;
  }
  return value;
}

export function readBitFieldAbsolute(data: number[], spec: FieldSpec): number {
  const bitLen = spec.bit_length ?? 0;
  let container = spec.length ?? 0;
  if (container <= 0) container = Math.ceil(bitLen / 8);
  const bitStart = spec.bit_offset ?? 0;
  const { value } = readBitsLSB(data, spec.offset ?? 0, bitStart, bitLen, container);
  return value;
}

export function fieldsUseAbsoluteOffsets(fields: FieldSpec[]): boolean {
  return fields.some(f =>
    (f.offset ?? 0) > 0
    || f.bit_offset !== undefined
    || ((f.bit_length ?? 0) > 0 && f.offset !== undefined),
  );
}
