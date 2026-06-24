import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { UartData, ProtocolSpec, Board, FieldSpec } from '../api';
import PageHeader from '../components/PageHeader';
import { applyFieldDecoration } from '../lib/decoration';
import {
  alignByte,
  fieldsUseAbsoluteOffsets,
  isBitField,
  newParseCursor,
  readBitField,
  readBitFieldAbsolute,
} from '../lib/bits';

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

function readField(data: number[], offset: number, spec: FieldSpec): { value: unknown; nextOffset: number } {
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
    case 'hex': value = bytesToHex(slice); break;
    case 'raw': value = bytesToHex(slice); break;
    case 'dynamic': value = bytesToHex(slice); break;
    default: value = bytesToHex(slice);
  }

  return { value, nextOffset: offset + length };
}

function parseFieldsSequential(data: number[], fields: FieldSpec[]): { fields: Record<string, unknown>; offset: number } {
  const result: Record<string, unknown> = {};
  const cur = newParseCursor();

  for (const field of fields) {
    if (field.repeat === 'until_end' || (field.type === 'raw' && (!field.length || field.length === 0) && !isBitField(field))) {
      alignByte(cur);
      result[field.name] = bytesToHex(data.slice(cur.byteOff));
      cur.byteOff = data.length;
      cur.bitOff = 0;
      continue;
    }

    if (field.type === 'function_args') {
      alignByte(cur);
      const args = parseFunctionArgs(data.slice(cur.byteOff), field);
      result[field.name] = args;
      let consumed = 0;
      for (const a of args) {
        consumed += 2 + (a._length as number);
      }
      cur.byteOff += consumed || data.length;
      cur.bitOff = 0;
      continue;
    }

    if (field.type === 'func_result') {
      alignByte(cur);
      const res = parseFunctionResult(data.slice(cur.byteOff), field);
      result[field.name] = res;
      cur.byteOff += (res._consumed as number) || data.length;
      cur.bitOff = 0;
      continue;
    }

    if (field.condition) {
      const condVal = result[field.condition];
      if (condVal === 0 || condVal === undefined || condVal === null) continue;
    }

    if (isBitField(field)) {
      try {
        const value = readBitField(data, cur, field);
        result[field.name] = value;
        const decorated = applyFieldDecoration(field.name, field.decoration, value);
        if (decorated !== null) result[`${field.name}_display`] = decorated;
      } catch {
        /* skip invalid bit read */
      }
      continue;
    }

    alignByte(cur);

    if (field.length === undefined || field.length === 0) continue;

    const { value, nextOffset } = readField(data, cur.byteOff, field);
    result[field.name] = value;
    const decorated = applyFieldDecoration(field.name, field.decoration, value);
    if (decorated !== null) {
      result[`${field.name}_display`] = decorated;
    }
    cur.byteOff = nextOffset;
    cur.bitOff = 0;
  }

  return { fields: result, offset: cur.byteOff };
}

function parseFieldsAbsolute(data: number[], fields: FieldSpec[]): Record<string, unknown> {
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

function parseFunctionArgs(data: number[], spec: FieldSpec): Record<string, unknown>[] {
  const args: Record<string, unknown>[] = [];
  let offset = 0;
  const argSpec = spec.fields?.[0];

  while (offset < data.length) {
    const flag = data[offset];
    offset++;
    const flagStr = flag.toString(16).padStart(2, '0').toUpperCase();

    if (argSpec?.flag && flagStr !== argSpec.flag) {
      offset--;
      break;
    }

    if (offset >= data.length) break;
    const argLen = data[offset];
    offset++;

    if (offset + argLen > data.length) break;
    const argData = data.slice(offset, offset + argLen);
    offset += argLen;

    const arg: Record<string, unknown> = { flag: flagStr, length: argLen, _length: argLen };
    if (argData.length >= 1) arg.type_id = argData[0];
    if (argData.length > 1) arg.value = bytesToHex(argData.slice(1));
    args.push(arg);
  }

  return args;
}

function parseFunctionResult(data: number[], spec: FieldSpec): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (data.length < 2) return result;

  const flag = data[0];
  const flagStr = flag.toString(16).padStart(2, '0').toUpperCase();
  const blockLen = data[1];
  const blockData = data.slice(2, 2 + blockLen);

  result.flag = flagStr;
  result._consumed = 2 + blockLen;

  for (const child of spec.fields || []) {
    if (child.flag && child.flag !== flagStr) continue;
    const { fields: sub } = parseFieldsSequential(blockData, child.fields || []);
    Object.assign(result, sub);
  }

  return result;
}

function crc16CCITT(data: number[]): number {
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

function parseFrame(hex: string, proto: ProtocolSpec): Record<string, unknown> {
  const data = hexToBytes(hex);
  const result: Record<string, unknown> = {};
  if (data.length < 2) return result;

  const fd = proto.frame_def;
  const startByte = parseInt(fd?.start_byte || 'AA', 16);
  const endByte = parseInt(fd?.end_byte || 'BB', 16);

  let bodyStart = 0;
  if (data[0] === startByte) { bodyStart = 1; result.start_byte = fd?.start_byte || 'AA'; }
  let bodyEnd = data.length;
  if (data[data.length - 1] === endByte) { bodyEnd = data.length - 1; result.end_byte = fd?.end_byte || 'BB'; }

  const frameBody = data.slice(bodyStart, bodyEnd);
  if (frameBody.length < 2) return result;

  // Parse header
  const hdrFields = fd?.header || [];
  let hdrOff = 0;
  for (const hf of hdrFields) {
    const { value, nextOffset } = readField(frameBody, hdrOff, hf);
    result['header.' + hf.name] = value;
    hdrOff = nextOffset;
  }

  // FID mapping
  const fidVal = result['header.fid'] as number | undefined;
  const fidMap: Record<number, string> = {
    0xCF: 'CF', 0xCD: 'CD', 0xCA: 'CA', 0xCE: 'CE', 0xCC: 'CC', 0xBC: 'BC', 0xC9: 'C9',
    0x54: '54',
  };
  const fidStr = fidVal !== undefined ? (fidMap[fidVal] || fidVal.toString(16).toUpperCase()) : '??';
  result.fid = fidStr;

  // Parse attr
  const attrVal = result['header.attr'] as number | undefined;
  if (attrVal !== undefined) {
    result['attr.retry'] = (attrVal >> 4) & 0x0F;
    result['attr.priority'] = attrVal & 0x0F;
  }

  // Find payload boundary
  const lenVal = result['header.length'] as number | undefined;
  let payloadData: number[];
  if (lenVal !== undefined && lenVal > hdrOff && lenVal <= frameBody.length) {
    payloadData = frameBody.slice(hdrOff, lenVal);
  } else {
    payloadData = frameBody.slice(hdrOff);
  }

  // Parse tail
  const tailFields = fd?.tail || [];
  let tailOff = Math.min(lenVal || frameBody.length, frameBody.length - (fd?.tail?.reduce((s, f) => s + (f.length || 0), 0) || 0));
  for (const tf of tailFields) {
    const { value, nextOffset } = readField(frameBody, tailOff, tf);
    result['tail.' + tf.name] = value;
    tailOff = nextOffset;
  }

  // CRC validation
  const crcVal = result['tail.crc16'] as number | undefined;
  if (crcVal !== undefined) {
    const calcCRC = crc16CCITT(frameBody.slice(0, frameBody.length - 2));
    result['crc.calculated'] = calcCRC;
    result['crc.valid'] = calcCRC === crcVal;
  }

  // Parse payload by FID
  const payloads = proto.fid_payloads || [];
  let fidPayload = payloads.find(p => p.fid === fidStr);

  if (fidPayload && payloadData.length > 0) {
    const { fields: parsed } = parseFieldsSequential(payloadData, fidPayload.fields || []);
    for (const [k, v] of Object.entries(parsed)) {
      result['payload.' + k] = v;
    }
  } else if (payloadData.length > 0) {
    result['payload.raw'] = bytesToHex(payloadData);
  }

  // Flat fields (raw offset layout; LCP display fields skip re-parse when frame-based)
  if (proto.fields.length > 0 && (!proto.frame_def || fieldsUseAbsoluteOffsets(proto.fields))) {
    const flatParsed = parseFieldsAbsolute(data, proto.fields);
    Object.assign(result, flatParsed);
  }

  return result;
}

const TEMPERATURE_PROTOCOL_ID = 'temperature-telemetry-v1';

/** Merge payload.* keys and server parsed_fields into protocol field names. */
function flattenProtocolFields(
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

function parseRecord(d: UartData, proto: ProtocolSpec): Record<string, unknown> {
  const fromServer = d.parsed_fields ?? {};
  const fromClient = parseFrame(d.raw_hex, proto);
  const merged = { ...fromClient, ...fromServer };
  return flattenProtocolFields(merged, proto);
}

function formatFieldValue(v: unknown, unit?: string): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') {
    const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
    return unit ? `${n} ${unit}` : n;
  }
  return renderValue(v);
}

function displayFieldValue(parsed: Record<string, unknown>, f: FieldSpec): string {
  const displayKey = `${f.name}_display`;
  if (parsed[displayKey] !== undefined && parsed[displayKey] !== null) {
    const d = String(parsed[displayKey]);
    return f.unit ? `${d} ${f.unit}` : d;
  }
  if (f.decoration) {
    const dec = applyFieldDecoration(f.name, f.decoration, parsed[f.name]);
    if (dec !== null) return f.unit ? `${dec} ${f.unit}` : dec;
  }
  return formatFieldValue(parsed[f.name], f.unit);
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const first = v[0] as Record<string, unknown>;
    if (first && typeof first === 'object') {
      return `[${v.length} items]`;
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.flag) return `${o.flag} func=${o.function_id ?? '?'} ${o.error_code !== undefined ? `err=0x${(o.error_code as number).toString(16)}` : ''}`.trim();
    return JSON.stringify(v);
  }
  if (typeof v === 'number') return String(v);
  return String(v);
}

function hexToAscii(hex: string): string {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.substring(i, i + 2), 16);
    out += (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
  }
  return out;
}

export default function DataViewerPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [data, setData] = useState<UartData[]>([]);

  useEffect(() => {
    api.boards.list().then(setBoards).catch(console.error);
    api.protocols.list().then(list => {
      setProtocols(list);
      const tempProto = list.find(p => p.id === TEMPERATURE_PROTOCOL_ID);
      if (tempProto) setSelectedProto(tempProto.id);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setData([]); return; }
    api.uart.list({ board_id: selectedBoard, limit: '2000' }).then(d => setData(d.reverse())).catch(console.error);
  }, [selectedBoard]);

  const proto = protocols.find(p => p.id === selectedProto);

  const parsedData = useMemo(() => {
    if (!proto) return { entries: data.map(d => ({ ...d, parsedFields: {} as Record<string, unknown> })), fieldColumns: [] as FieldSpec[] };

    const fieldColumns = proto.fields.length > 0 ? proto.fields : [];
    const entries = data.map(d => ({
      ...d,
      parsedFields: parseRecord(d, proto),
    }));

    return { entries, fieldColumns };
  }, [data, proto]);

  const entries = parsedData.entries;
  const fieldColumns = parsedData.fieldColumns;

  return (
    <div className="page data-viewer-page">
      <PageHeader
        title="Data Viewer"
        subtitle={proto
          ? `${proto.name} v${proto.version} — 프레임 정의에 따라 UART 데이터를 파싱합니다.`
          : '보드와 프로토콜을 선택해 UART 데이터를 확인합니다.'}
      />
      <div className="card">
        <div className="toolbar">
          <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
            <option value="">Select Board</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}{b.location ? ` · ${b.location}` : ''}</option>)}
          </select>
          <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
            <option value="">No Protocol</option>
            {protocols.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
          </select>
          <span className="toolbar-stat">{data.length} records</span>
        </div>
      </div>
      <div className="card data-viewer-table-card">
        <div className="data-viewer-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Dir</th>
              <th>Raw Hex</th>
              <th>ASCII</th>
              <th>FID</th>
              {fieldColumns.map(f => (
                <th key={f.name}>{f.unit ? `${f.name} (${f.unit})` : f.name}</th>
              ))}
              {!fieldColumns.length && proto && (
                <th className="muted">Select a protocol with field definitions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6 + fieldColumns.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No UART records. Temperature readings are stored as protocol frames after ingest.
                </td>
              </tr>
            ) : entries.map(d => (
              <tr key={d.id}>
                <td className="mono">{new Date(d.timestamp).toLocaleTimeString()}</td>
                <td><span className={`badge ${d.direction === 'TX' ? 'badge-tx' : 'badge-rx'}`}>{d.direction}</span></td>
                <td className="mono">{d.raw_hex}</td>
                <td className="mono">{hexToAscii(d.raw_hex)}</td>
                <td><span className="badge badge-tx">{String(d.parsedFields?.fid ?? '-')}</span></td>
                {fieldColumns.map(f => (
                  <td key={f.name} className="mono">
                    {displayFieldValue(d.parsedFields ?? {}, f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
