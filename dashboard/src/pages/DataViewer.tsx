import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { UartData, ProtocolSpec, Board, FieldSpec } from '../api';
import PageHeader from '../components/PageHeader';
import { applyFieldDecoration } from '../lib/decoration';
import { flattenProtocolFields, parseProtocolHex } from '../lib/uartParse';

const TEMPERATURE_PROTOCOL_ID = 'temperature-telemetry-v1';

function parseRecord(d: UartData, proto: ProtocolSpec): Record<string, unknown> {
  const fromServer = d.parsed_fields ?? {};
  const fromClient = parseProtocolHex(d.raw_hex, proto);
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
    <div className="page">
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
