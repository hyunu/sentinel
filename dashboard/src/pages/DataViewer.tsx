import { useState, useEffect } from 'react';
import { api } from '../api';
import type { UartData, ProtocolSpec, Board } from '../api';
import PageHeader from '../components/PageHeader';

const TEMPERATURE_PROTOCOL_ID = 'temperature-telemetry-v1';

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
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
      const temp = list.find(p => p.id === TEMPERATURE_PROTOCOL_ID);
      if (temp) setSelectedProto(temp.id);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedBoard) return;
    api.uart.list({ board_id: selectedBoard, limit: 200 })
      .then(setData)
      .catch(console.error);
  }, [selectedBoard]);

  const proto = protocols.find(p => p.id === selectedProto);

  return (
    <div className="page">
      <PageHeader title="UART Data" subtitle="서버 parse_rules(Go engine)로 파싱된 필드를 표시합니다." />

      <div className="card">
        <div className="form-row">
          <div className="form-field">
            <label>Board</label>
            <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
              <option value="">Select board</option>
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Protocol (reference)</label>
            <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
              <option value="">—</option>
              {protocols.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        {proto && (
          <p className="muted section-hint">{proto.parse_rules?._meta?.name as string || proto.name}</p>
        )}
      </div>

      <div className="card table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Dir</th>
              <th>Raw</th>
              <th>ASCII</th>
              <th>Parsed</th>
            </tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.id}>
                <td>{new Date(d.timestamp).toLocaleString()}</td>
                <td>{d.direction}</td>
                <td className="mono">{d.raw_hex}</td>
                <td className="mono">{hexToAscii(d.raw_hex)}</td>
                <td className="mono parsed-cell">
                  {d.parsed_fields
                    ? Object.entries(d.parsed_fields).slice(0, 8).map(([k, v]) => (
                        <div key={k}><span className="muted">{k}:</span> {renderValue(v)}</div>
                      ))
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
