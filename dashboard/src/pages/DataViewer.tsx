import { useState, useEffect } from 'react';
import { api } from '../api';
import type { UartData, ProtocolSpec, Board } from '../api';

function hexToAscii(hex: string): string {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.substring(i, i + 2), 16);
    if (c >= 32 && c <= 126) out += String.fromCharCode(c);
    else out += '.';
  }
  return out;
}

function parseBytes(hex: string, proto: ProtocolSpec): Record<string, unknown> {
  const bytes = hex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || [];
  const result: Record<string, unknown> = {};
  for (const field of proto.fields) {
    if (field.offset + field.length > bytes.length) continue;
    const slice = bytes.slice(field.offset, field.offset + field.length);
    let value: unknown;
    switch (field.type) {
      case 'uint8': value = slice[0]; break;
      case 'uint16': value = field.endian === 'big' ? (slice[0] << 8) | slice[1] : slice[0] | (slice[1] << 8); break;
      case 'int8': value = slice[0] << 24 >> 24; break;
      case 'ascii': value = String.fromCharCode(...slice); break;
      default: value = slice.join(' ');
    }
    result[field.name] = value;
  }
  return result;
}

export default function DataViewerPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [data, setData] = useState<UartData[]>([]);

  useEffect(() => {
    api.boards.list().then(setBoards).catch(console.error);
    api.protocols.list().then(setProtocols).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setData([]); return; }
    api.uart.list({ board_id: selectedBoard }).then(d => setData(d.reverse())).catch(console.error);
  }, [selectedBoard]);

  const proto = protocols.find(p => p.id === selectedProto);

  return (
    <div className="page">
      <h1>UART Data Viewer</h1>
      <div className="card">
        <div className="form-row">
          <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
            <option value="">Select Board</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
            <option value="">No Protocol</option>
            {protocols.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
          </select>
          <span className="muted">{data.length} records</span>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Dir</th>
              <th>Raw Hex</th>
              <th>ASCII</th>
              {proto?.fields.map(f => <th key={f.name}>{f.name}{f.unit ? ` (${f.unit})` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map(d => {
              const parsed = proto ? parseBytes(d.raw_hex, proto) : {};
              return (
                <tr key={d.id}>
                  <td className="mono">{new Date(d.timestamp).toLocaleTimeString()}</td>
                  <td><span className={`badge ${d.direction === 'TX' ? 'badge-tx' : 'badge-rx'}`}>{d.direction}</span></td>
                  <td className="mono">{d.raw_hex}</td>
                  <td className="mono">{hexToAscii(d.raw_hex)}</td>
                  {proto?.fields.map(f => <td key={f.name}>{String(parsed[f.name] ?? '-')}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
