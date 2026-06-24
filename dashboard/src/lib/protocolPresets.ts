import type { FrameDef, FIDPayload, FieldSpec } from '../api';

export const LCP_FRAME: FrameDef = {
  start_byte: 'AA',
  end_byte: 'BB',
  endian: 'big',
  crc_position: 'before_end',
  header: [
    { name: 'length', length: 2, type: 'uint16', endian: 'big' },
    { name: 'fid', length: 1, type: 'uint8' },
    { name: 'seq_no', length: 2, type: 'uint16', endian: 'big' },
    { name: 'attr', length: 1, type: 'uint8' },
  ],
  tail: [{ name: 'crc16', length: 2, type: 'uint16', endian: 'big' }],
};

export const FIELD_TYPES = [
  'uint8', 'uint16', 'uint32', 'int8', 'int16', 'float', 'ascii', 'hex', 'raw',
] as const;

export const FIELD_TYPES_ADVANCED = [
  ...FIELD_TYPES, 'dynamic', 'function_args', 'func_result',
] as const;

export type ProtocolFormat = 'lcp' | 'raw';

export function emptyField(partial?: Partial<FieldSpec>): FieldSpec {
  return {
    name: '',
    offset: 0,
    length: 1,
    type: 'uint8',
    unit: '',
    endian: 'little',
    decoration: '',
    bit_length: 0,
    fields: [],
    ...partial,
  };
}

export function emptyFidPayload(): FIDPayload {
  return { fid: '', name: '', description: '', fields: [emptyField()] };
}

export function deriveDisplayFields(fidPayloads: FIDPayload[]): FieldSpec[] {
  const seen = new Set<string>();
  const out: FieldSpec[] = [];
  for (const p of fidPayloads) {
    for (const f of p.fields || []) {
      if (!f.name || seen.has(f.name)) continue;
      seen.add(f.name);
      out.push({
        name: f.name,
        type: f.type,
        unit: f.unit,
        length: f.length,
        endian: f.endian,
        decoration: f.decoration,
        bit_offset: f.bit_offset,
        bit_length: f.bit_length,
      });
    }
  }
  return out;
}

export function temperatureTemplate(): {
  name: string;
  version: string;
  description: string;
  format: ProtocolFormat;
  frameDef: FrameDef;
  fidPayloads: FIDPayload[];
} {
  return {
    name: 'Temperature Telemetry',
    version: '1.0',
    description: 'LCP AA/BB frame, FID=0x54 (T). Payload: sensor_id, temperature, humidity.',
    format: 'lcp',
    frameDef: structuredClone(LCP_FRAME),
    fidPayloads: [{
      fid: '54',
      name: 'Temperature',
      description: 'On-board temperature and humidity',
      fields: [
        { name: 'sensor_id', length: 1, type: 'uint8', unit: '' },
        { name: 'temperature_celsius', length: 4, type: 'float', endian: 'little', unit: '°C' },
        { name: 'humidity_percent', length: 2, type: 'uint16', endian: 'little', unit: '%' },
      ],
    }],
  };
}

export function detectFormat(p: { frame_def?: FrameDef; fid_payloads?: FIDPayload[] }): ProtocolFormat {
  if (p.frame_def?.header?.length || p.fid_payloads?.length) return 'lcp';
  return 'raw';
}
