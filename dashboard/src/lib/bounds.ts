import type { FieldSpec } from '../api';
import { alignByte, boundEnd, isBitField, type ParseCursor } from './bits';
import { bytesToHex, readField } from './fieldRead';

export function fieldUsesRemaining(field: FieldSpec): boolean {
  if (field.length_mode === 'remaining') return true;
  if (field.repeat === 'until_end') return true;
  return field.type === 'raw' && (!field.length || field.length === 0) && !isBitField(field);
}

export function readRemainingField(data: number[], cur: ParseCursor, field: FieldSpec): unknown {
  alignByte(cur);
  const end = boundEnd(cur, data.length);
  if (cur.byteOff >= end) {
    cur.byteOff = end;
    cur.bitOff = 0;
    return field.type === 'ascii' ? '' : '';
  }
  const slice = data.slice(cur.byteOff, end);
  cur.byteOff = end;
  cur.bitOff = 0;

  switch (field.type) {
    case 'ascii':
      return String.fromCharCode(...slice).replace(/\x00+$/, '');
    case 'hex':
    case 'raw':
    case 'dynamic':
      return bytesToHex(slice);
    default:
      if (slice.length === 0) return null;
      return readField(slice, 0, { ...field, length: slice.length, length_mode: undefined }).value;
  }
}
