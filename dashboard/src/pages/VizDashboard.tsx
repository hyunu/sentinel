import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';
import PageHeader from '../components/PageHeader';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
const CHART_TYPES = ['line', 'bar', 'area'] as const;
const MAX_POINTS = 1000;
const POLL_INTERVAL = 3000;

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

type ChartPoint = { timestamp: string } & Record<string, string | number>;

interface Statistics {
  min: number;
  max: number;
  avg: number;
  count: number;
  last: number | string;
}

const TIME_PRESETS = [
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d', seconds: 604800 },
  { label: 'All', seconds: 0 },
];

function toLocalISO(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function VizDashboardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [profileName, setProfileName] = useState('');
  const [items, setItems] = useState<VizItem[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [profiles, setProfiles] = useState<VizProfile[]>([]);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [timeRangePreset, setTimeRangePreset] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const lastTimestampRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;

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
    if (p.time_range?.start && p.time_range?.end) {
      setCustomStart(toLocalISO(new Date(p.time_range.start)));
      setCustomEnd(toLocalISO(new Date(p.time_range.end)));
      setTimeRangePreset(0);
    }
    const result = await api.viz.apply(id);
    const points: ChartPoint[] = result.data.map(d => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString(),
      ...d.values,
    }) as ChartPoint);
    setChartData(points);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
  }, [selectedBoard]);

  const buildTimeRange = useCallback((): { start: string; end: string } | undefined => {
    if (timeRangePreset > 0) {
      const end = new Date();
      const start = new Date(end.getTime() - timeRangePreset * 1000);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    if (customStart && customEnd) {
      return { start: new Date(customStart).toISOString(), end: new Date(customEnd).toISOString() };
    }
    return undefined;
  }, [timeRangePreset, customStart, customEnd]);

  const fetchAll = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    setLoading(true);
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsRef.current.filter(i => i.visible),
        time_range: buildTimeRange(),
      });
      const points: ChartPoint[] = result.data.map(d => ({
        timestamp: new Date(d.timestamp).toLocaleTimeString(),
        ...d.values,
      }) as ChartPoint);
      setChartData(points);
      if (points.length > 0) {
        lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      }
    } finally {
      setLoading(false);
    }
  }, [selectedBoard, buildTimeRange]);

  const appendLive = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    const since = lastTimestampRef.current;
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsRef.current.filter(i => i.visible),
        since: since || undefined,
      });
      if (!result.data.length) return;
      const newPoints: ChartPoint[] = result.data.map(d => ({
        timestamp: new Date(d.timestamp).toLocaleTimeString(),
        ...d.values,
      }) as ChartPoint);
      lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      setChartData(prev => {
        const existing = since ? prev : [];
        const merged = [...existing, ...newPoints];
        return merged.length > MAX_POINTS ? merged.slice(-MAX_POINTS) : merged;
      });
    } catch {
      // ignore polling errors
    }
  }, [selectedBoard]);

  const stopLive = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startLive = useCallback(() => {
    stopLive();
    fetchAll();
    pollTimerRef.current = setInterval(() => { appendLive(); }, POLL_INTERVAL);
  }, [fetchAll, appendLive, stopLive]);

  useEffect(() => {
    if (liveMode) {
      startLive();
    } else {
      stopLive();
    }
    return stopLive;
  }, [liveMode, startLive, stopLive]);

  const addAllFields = () => {
    if (!selectedProto) return;
    const proto = protocols.find(p => p.id === selectedProto);
    if (!proto) return;
    const existingLabels = new Set(items.map(i => i.label));
    const fieldNames = collectParseRuleFieldPaths(proto.parse_rules);
    const newItems = fieldNames
      .filter(name => !existingLabels.has(name))
      .map((name, i) => makeItem(selectedProto, name, name, items.length + i));
    if (newItems.length) setItems(prev => [...prev, ...newItems]);
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
      time_range: buildTimeRange(),
    };
    if (savedProfileId) {
      const existing = await api.viz.getProfile(savedProfileId);
      await api.viz.updateProfile(savedProfileId, { ...existing, ...data });
    } else {
      await api.viz.createProfile(data as Parameters<typeof api.viz.createProfile>[0]);
    }
    setProfiles(await api.viz.listProfiles(selectedBoard));
  };

  const visibleItems = items.filter(i => i.visible);
  const yAxisIds = [...new Set(visibleItems.map(i => i.y_axis.id))];
  const yAxisConfigs = yAxisIds.map(yId => {
    const item = visibleItems.find(i => i.y_axis.id === yId);
    return item?.y_axis || { id: yId, label: yId, unit: '' };
  });

  const statistics = useMemo(() => {
    const stats: Record<string, Statistics> = {};
    for (const item of visibleItems) {
      const values = chartData
        .map(d => d[item.label])
        .filter((v): v is number => typeof v === 'number' && !isNaN(v));
      if (!values.length) continue;
      stats[item.label] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        count: values.length,
        last: values[values.length - 1],
      };
    }
    return stats;
  }, [visibleItems, chartData]);

  const exportCSV = () => {
    if (!chartData.length) return;
    const headers = ['timestamp', ...visibleItems.map(i => i.label)];
    const rows = chartData.map(d => headers.map(h => d[h] ?? '').join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profileName || 'chart-data'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderChartShape = (item: VizItem) => {
    const name = item.weight !== 1 || item.offset !== 0
      ? `${item.label} (×${item.weight}${item.offset >= 0 ? '+' : ''}${item.offset})`
      : item.label;
    if (item.chart_type === 'bar') {
      return <Bar key={item.id} yAxisId={item.y_axis.id} dataKey={item.label} fill={item.color} name={name} />;
    }
    if (item.chart_type === 'area') {
      return (
        <Area
          key={item.id} yAxisId={item.y_axis.id} dataKey={item.label} type="monotone"
          fill={item.color} stroke={item.color} fillOpacity={0.3} name={name}
        />
      );
    }
    return <Line key={item.id} yAxisId={item.y_axis.id} dataKey={item.label} type="monotone" dot={false} stroke={item.color} name={name} />;
  };

  return (
    <div className="page">
      <PageHeader
        title="Visualization"
        subtitle="프로토콜 필드를 차트로 시각화합니다. Live 모드로 실시간 데이터를 확인할 수 있습니다."
      />

      <div className="card">
        <div className="card-header">
          <h2>Configuration</h2>
        </div>
        <div className="form-row">
          <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
            <option value="">Select Board</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
            <option value="">Select Protocol</option>
            {protocols.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
          </select>
          <button type="button" onClick={addAllFields}>+ Add All Fields</button>
          <button type="button" onClick={fetchAll} className="btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            className={`btn-live${liveMode ? ' active' : ''}`}
            onClick={() => setLiveMode(v => !v)}
          >
            {liveMode ? '● LIVE' : 'Live'}
          </button>
          {chartData.length > 0 && <button type="button" onClick={exportCSV}>Export CSV</button>}
        </div>

        <h3>Time Range {liveMode && <span className="muted">(disabled in Live mode)</span>}</h3>
        <div className="form-row">
          {TIME_PRESETS.map(p => (
            <button
              key={p.label}
              className={timeRangePreset === p.seconds ? 'btn-primary' : ''}
              onClick={() => { setTimeRangePreset(p.seconds); setCustomStart(''); setCustomEnd(''); }}
              disabled={liveMode}
            >
              {p.label}
            </button>
          ))}
          <input
            type="datetime-local" value={customStart}
            onChange={e => { setCustomStart(e.target.value); setTimeRangePreset(0); }}
            disabled={liveMode}
          />
          <span style={{ color: 'var(--text-muted)' }}>~</span>
          <input
            type="datetime-local" value={customEnd}
            onChange={e => { setCustomEnd(e.target.value); setTimeRangePreset(0); }}
            disabled={liveMode}
          />
        </div>
      </div>

      <div className="card">
        <h2>Items ({items.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Vis</th>
              <th>Label</th>
              <th>Type</th>
              <th>Y-Axis</th>
              <th>Unit</th>
              <th>Offset</th>
              <th>Weight</th>
              <th>Color</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td><input type="checkbox" checked={item.visible} onChange={() => toggleVisibility(item.id)} /></td>
                <td>{item.label}</td>
                <td>
                  <select value={item.chart_type} onChange={e => updateItem(item.id, 'chart_type', e.target.value)}>
                    {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td>
                  <select value={item.y_axis.id} onChange={e => updateItem(item.id, 'y_axis', { ...item.y_axis, id: e.target.value } as YAxisConfig)}>
                    {yAxisIds.map(yId => <option key={yId} value={yId}>{yId}</option>)}
                    <option value={item.label}>+ New: {item.label}</option>
                  </select>
                </td>
                <td>
                  <input
                    type="text" value={item.y_axis.unit || ''}
                    onChange={e => updateItem(item.id, 'y_axis', { ...item.y_axis, unit: e.target.value } as YAxisConfig)}
                    style={{ width: 50 }}
                  />
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
        <h2>
          Chart ({chartData.length} points)
          {liveMode && <span className="muted" style={{ marginLeft: 8 }}>· polling every {POLL_INTERVAL / 1000}s</span>}
        </h2>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2e3040" />
            <XAxis dataKey="timestamp" fontSize={11} stroke="#888aa0" />
            {yAxisConfigs.map((y, i) => (
              <YAxis
                key={y.id} yAxisId={y.id}
                orientation={i % 2 === 0 ? 'left' : 'right'}
                label={{
                  value: y.unit ? `${y.label} (${y.unit})` : y.label,
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#888aa0', fontSize: 11 },
                }}
                stroke="#888aa0" fontSize={11}
              />
            ))}
            <Tooltip
              contentStyle={{ background: '#1a1b23', border: '1px solid #2e3040', borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: '#e4e5ec' }}
            />
            <Legend />
            {visibleItems.map(item => renderChartShape(item))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {Object.keys(statistics).length > 0 && (
        <div className="card">
          <h2>Statistics</h2>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Min</th>
                <th>Max</th>
                <th>Avg</th>
                <th>Latest</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(statistics).map(([label, s]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{s.min.toFixed(2)}</td>
                  <td>{s.max.toFixed(2)}</td>
                  <td>{s.avg.toFixed(2)}</td>
                  <td>{typeof s.last === 'number' ? s.last.toFixed(2) : s.last}</td>
                  <td>{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Save / Load Profile</h2>
        <div className="form-row">
          <input placeholder="Profile Name" value={profileName} onChange={e => setProfileName(e.target.value)} />
          <button onClick={saveProfile} className="btn-primary">Save</button>
          {savedProfileId && <span className="muted">Saved as "{profileName}"</span>}
        </div>
        {profiles.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {profiles.map(p => (
              <div key={p.id} className="list-item">
                <span>{p.name}</span>
                <button onClick={() => loadProfile(p.id)}>Load</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
