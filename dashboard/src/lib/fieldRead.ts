import type { FieldSpec } from '../api';

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function readField(data: number[], offset: number, spec: FieldSpec): { value: unknown; nextOffset: number } {
  const endian = spec.endian || 'little';
  const length = spec.length || 1;

  if (offset + length > data.length) {
    return { value: null, nextOffset: offset };
  }

  const slice = data.slice(offset, offset + length);
  let value: unknown;

  switch (spec.type) {
    case 'uint8': value = slice[0]; break;
    case 'int8': value = slice[0] << 24 >> 24; break;
    case 'uint16':
      value = endian === 'big' ? (slice[0] << 8) | slice[1] : slice[0] | (slice[1] << 8);
      break;
    case 'int16':
      if (endian === 'big') value = ((slice[0] << 8) | slice[1]) << 16 >> 16;
      else value = ((slice[0]) | (slice[1] << 8)) << 16 >> 16;
      break;
    case 'uint32':
      value = endian === 'big'
        ? ((slice[0] << 24) | (slice[1] << 16) | (slice[2] << 8) | slice[3]) >>> 0
        : ((slice[3] << 24) | (slice[2] << 16) | (slice[1] << 8) | slice[0]) >>> 0;
      break;
    case 'float': {
      const buf = new ArrayBuffer(4);
      new Uint8Array(buf).set(slice);
      value = new DataView(buf).getFloat32(0, endian !== 'big');
      break;
    }
    case 'ascii': value = String.fromCharCode(...slice).replace(/\x00+$/, ''); break;
    case 'hex':
    case 'raw':
    case 'dynamic':
      value = bytesToHex(slice);
      break;
    default:
      value = bytesToHex(slice);
  }

  return { value, nextOffset: offset + length };
}
