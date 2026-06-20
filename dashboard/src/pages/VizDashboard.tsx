import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];

function makeItem(protoId: string, fieldName: string, yId: string, idx: number): VizItem {
  return {
    id: crypto.randomUUID(),
    label: fieldName,
    color: COLORS[idx % COLORS.length],
    visible: true,
    field_ref: { protocol_id: protoId, field_name: fieldName },
    chart_type: 'line',
    y_axis: { id: yId, label: fieldName, unit: '' },
    offset: 0,
    weight: 1,
  };
}

export default function VizDashboardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [profileName, setProfileName] = useState('');
  const [items, setItems] = useState<VizItem[]>([]);
  type ChartPoint = { timestamp: string } & Record<string, string | number>;
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [profiles, setProfiles] = useState<VizProfile[]>([]);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);

  useEffect(() => {
    api.boards.list().then(setBoards);
    api.protocols.list().then(setProtocols);
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const p = await api.viz.getProfile(id);
    setSelectedBoard(p.board_id);
    setProfileName(p.name);
    setItems(p.items);
    setSavedProfileId(p.id);

    const result = await api.viz.apply(id);
    const points: ChartPoint[] = result.data.map(d => ({ timestamp: new Date(d.timestamp).toLocaleTimeString(), ...d.values }) as ChartPoint);
    setChartData(points);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
  }, [selectedBoard]);

  const fetchData = useCallback(async () => {
    if (!selectedBoard || !items.length) return;
    const tmpProfile: VizProfile = {
      id: '',
      name: 'temp',
      board_id: selectedBoard,
      items: items.filter(i => i.visible),
      created_at: '',
      updated_at: '',
    };
    const created = await api.viz.createProfile(tmpProfile);
    const result = await api.viz.apply(created.id);
    const points: ChartPoint[] = result.data.map(d => ({ timestamp: new Date(d.timestamp).toLocaleTimeString(), ...d.values }) as ChartPoint);
    setChartData(points);
    await api.viz.deleteProfile(created.id);
  }, [selectedBoard, items]);

  const addAllFields = () => {
    if (!selectedProto) return;
    const proto = protocols.find(p => p.id === selectedProto);
    if (!proto) return;
    const newItems = proto.fields.map((f, i) => makeItem(selectedProto, f.name, f.name, i));
    setItems(prev => [...prev, ...newItems]);
  };

  const toggleVisibility = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  };

  const updateItem = (id: string, key: keyof VizItem, value: unknown) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [key]: value } as VizItem : i));
  };

  const saveProfile = async () => {
    const data = {
      name: profileName,
      board_id: selectedBoard,
      items,
    };
    if (savedProfileId) {
      const existing = await api.viz.getProfile(savedProfileId);
      await api.viz.updateProfile(savedProfileId, { ...existing, ...data });
    } else {
      await api.viz.createProfile(data as Parameters<typeof api.viz.createProfile>[0]);
    }
    setProfiles(await api.viz.listProfiles(selectedBoard));
  };

  const yAxisIds = [...new Set(items.map(i => i.y_axis.id))];
  const yAxisConfigs = yAxisIds.map(yId => {
    const item = items.find(i => i.y_axis.id === yId);
    return { id: yId, label: item?.y_axis.label || yId };
  });

  return (
    <div className="page">
      <h1>Visualization Dashboard</h1>

      <div className="card">
        <h2>Configuration</h2>
        <div className="form-row">
          <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
            <option value="">Select Board</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
            <option value="">Select Protocol</option>
            {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addAllFields}>+ Add All Fields</button>
          <button onClick={fetchData} className="btn-primary">Refresh Chart</button>
        </div>
      </div>

      <div className="card">
        <h2>Items ({items.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Visible</th>
              <th>Label</th>
              <th>Y-Axis ID</th>
              <th>Offset</th>
              <th>Weight</th>
              <th>Color</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>
                  <input type="checkbox" checked={item.visible} onChange={() => toggleVisibility(item.id)} />
                </td>
                <td>{item.label}</td>
                <td>
                  <select value={item.y_axis.id} onChange={e => updateItem(item.id, 'y_axis', { ...item.y_axis, id: e.target.value } as YAxisConfig)}>
                    {yAxisIds.map(yId => <option key={yId} value={yId}>{yId}</option>)}
                    <option value={item.label}>+ New: {item.label}</option>
                  </select>
                </td>
                <td><input type="number" value={item.offset} onChange={e => updateItem(item.id, 'offset', parseFloat(e.target.value) || 0)} style={{ width: 70 }} /></td>
                <td><input type="number" step="0.1" value={item.weight} onChange={e => updateItem(item.id, 'weight', parseFloat(e.target.value) || 1)} style={{ width: 70 }} /></td>
                <td><input type="color" value={item.color} onChange={e => updateItem(item.id, 'color', e.target.value)} style={{ width: 40 }} /></td>
                <td><button className="btn-danger" onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Chart</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" fontSize={11} />
            {yAxisConfigs.map((y, i) => (
              <YAxis key={y.id} yAxisId={y.id} orientation={i === 0 ? 'left' : 'right'} label={{ value: y.label, angle: -90, position: 'insideLeft' }} />
            ))}
            <Tooltip />
            <Legend />
            {items.filter(i => i.visible).map(item => (
              <Line
                key={item.id}
                yAxisId={item.y_axis.id}
                type="monotone"
                dataKey={item.label}
                stroke={item.color}
                dot={false}
                name={`${item.label} (×${item.weight}${item.offset !== 0 ? `+${item.offset}` : ''})`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>Save / Load Profile</h2>
        <div className="form-row">
          <input placeholder="Profile Name" value={profileName} onChange={e => setProfileName(e.target.value)} />
          <button onClick={saveProfile} className="btn-primary">Save</button>
        </div>
        {profiles.map(p => (
          <div key={p.id} className="list-item">
            <span>{p.name}</span>
            <button onClick={() => loadProfile(p.id)}>Load</button>
          </div>
        ))}
      </div>
    </div>
  );
}
