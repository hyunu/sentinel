import type { FieldSpec, FrameDef, FIDPayload, ProtocolSpec } from '../api';
import {
  fieldsUseAbsoluteOffsets,
  readBitFieldAbsolute,
  isBitField,
} from './bits';
import { applyFieldDecoration } from './decoration';
import { parseFieldsSequential } from './compositors';
import { hexToBytes, bytesToHex, readField } from './fieldRead';

export { hexToBytes, bytesToHex, readField } from './fieldRead';

export function parseFieldsAbsolute(data: number[], fields: FieldSpec[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.name) continue;

    if (isBitField(field)) {
      try {
        const value = readBitFieldAbsolute(data, field);
        result[field.name] = value;
        const decorated = applyFieldDecoration(field.name, field.decoration, value);
        if (decorated !== null) result[`${field.name}_display`] = decorated;
      } catch {
        /* skip */
      }
      continue;
    }

    if (!field.length) continue;
    const { value } = readField(data, field.offset ?? 0, field);
    result[field.name] = value;
    const decorated = applyFieldDecoration(field.name, field.decoration, value);
    if (decorated !== null) result[`${field.name}_display`] = decorated;
  }
  return result;
}

function tailByteSize(tail: FieldSpec[]): number {
  return (tail || []).reduce((s, f) => s + (f.length || 0), 0);
}

function payloadKeyField(fd: FrameDef): string {
  return fd.payload_key_field || 'fid';
}

function lengthField(fd: FrameDef): string {
  return fd.length_field || 'length';
}

export function formatDispatchKey(val: unknown): string {
  if (typeof val === 'number') {
    return val.toString(16).padStart(2, '0').toUpperCase();
  }
  if (typeof val === 'string') {
    return val.replace(/^0x/i, '').toUpperCase();
  }
  return String(val ?? '');
}

export function crc16CCITT(data: number[]): number {
  let crc = 0xFFFF;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc <<= 1;
    }
  }
  return crc & 0xFFFF;
}

export interface FrameParseResult {
  header: Record<string, unknown>;
  tail: Record<string, unknown>;
  payload: number[];
  dispatchKey: string;
  startByte?: string;
  endByte?: string;
  crcValid?: boolean;
  crcReceived?: number;
  crcCalculated?: number;
}

export function parseFrameEnvelope(data: number[], frameDef: FrameDef): FrameParseResult {
  const startByte = parseInt(frameDef.start_byte || 'AA', 16);
  const endByte = parseInt(frameDef.end_byte || 'BB', 16);

  const result: FrameParseResult = {
    header: {},
    tail: {},
    payload: [],
    dispatchKey: '',
  };

  let bodyStart = 0;
  if (data[0] === startByte) {
    bodyStart = 1;
    result.startByte = (frameDef.start_byte || 'AA').toUpperCase();
  }

  let bodyEnd = data.length;
  if (data[data.length - 1] === endByte) {
    bodyEnd = data.length - 1;
    result.endByte = (frameDef.end_byte || 'BB').toUpperCase();
  }

  const frameBody = data.slice(bodyStart, bodyEnd);
  const hdrFields = frameDef.header || [];
  let hdrOff = 0;

  for (const hf of hdrFields) {
    const { value, nextOffset } = readField(frameBody, hdrOff, hf);
    result.header[hf.name] = value;
    hdrOff = nextOffset;
  }

  const tailFields = frameDef.tail || [];
  const tailSize = tailByteSize(tailFields);

  let payloadEnd = frameBody.length - tailSize;
  if (payloadEnd < hdrOff) payloadEnd = hdrOff;

  const lenField = lengthField(frameDef);
  const lenVal = result.header[lenField] as number | undefined;
  if (lenVal !== undefined && lenVal > hdrOff && lenVal <= frameBody.length) {
    payloadEnd = lenVal;
  }

  result.payload = frameBody.slice(hdrOff, payloadEnd);

  if (tailSize > 0 && frameBody.length >= tailSize) {
    const tailStart = frameBody.length - tailSize;
    let tailOff = tailStart;
    for (const tf of tailFields) {
      const { value, nextOffset } = readField(frameBody, tailOff, tf);
      result.tail[tf.name] = value;
      tailOff = nextOffset;
    }
  }

  const keyField = payloadKeyField(frameDef);
  const keyVal = result.header[keyField];
  if (keyVal !== undefined) {
    result.dispatchKey = formatDispatchKey(keyVal);
  }

  const crcVal = result.tail.crc16 as number | undefined;
  if (crcVal !== undefined && frameDef.crc_position !== 'none') {
    const crcData = tailSize > 0 ? frameBody.slice(0, frameBody.length - tailSize) : frameBody;
    const calc = crc16CCITT(crcData);
    result.crcReceived = crcVal;
    result.crcCalculated = calc;
    result.crcValid = calc === crcVal;
  }

  return result;
}

function findFidPayload(key: string, payloads: FIDPayload[]): FIDPayload | undefined {
  return payloads.find(p => p.fid.toUpperCase() === key.toUpperCase());
}

export function parseProtocolHex(hex: string, proto: ProtocolSpec): Record<string, unknown> {
  const data = hexToBytes(hex);
  const result: Record<string, unknown> = {};
  if (data.length < 1) return result;

  const isFrame = Boolean(proto.frame_def?.header?.length || proto.fid_payloads?.length);

  if (!isFrame) {
    return parseFieldsAbsolute(data, proto.fields);
  }

  const fd = proto.frame_def!;
  const env = parseFrameEnvelope(data, fd);

  if (env.startByte) result.start_byte = env.startByte;
  if (env.endByte) result.end_byte = env.endByte;

  for (const [k, v] of Object.entries(env.header)) {
    result[`header.${k}`] = v;
  }
  for (const [k, v] of Object.entries(env.tail)) {
    result[`tail.${k}`] = v;
  }

  result.fid = env.dispatchKey || '??';

  if (env.crcValid !== undefined) {
    result['crc.calculated'] = env.crcCalculated;
    result['crc.valid'] = env.crcValid;
  }

  const fidPayload = findFidPayload(env.dispatchKey, proto.fid_payloads || []);
  if (fidPayload && env.payload.length > 0) {
    const { fields: parsed } = parseFieldsSequential(env.payload, fidPayload.fields || []);
    for (const [k, v] of Object.entries(parsed)) {
      result[`payload.${k}`] = v;
    }
  } else if (env.payload.length > 0) {
    result['payload.raw'] = bytesToHex(env.payload);
  }

  if (proto.fields.length > 0 && fieldsUseAbsoluteOffsets(proto.fields)) {
    Object.assign(result, parseFieldsAbsolute(data, proto.fields));
  }

  return result;
}

export function flattenProtocolFields(
  parsed: Record<string, unknown>,
  proto: ProtocolSpec,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  for (const f of proto.fields) {
    const payloadKey = `payload.${f.name}`;
    if (out[f.name] === undefined && out[payloadKey] !== undefined) {
      out[f.name] = out[payloadKey];
    }
    const displayKey = `${f.name}_display`;
    const payloadDisplayKey = `payload.${f.name}_display`;
    if (out[displayKey] === undefined && out[payloadDisplayKey] !== undefined) {
      out[displayKey] = out[payloadDisplayKey];
    }
  }
  return out;
}
