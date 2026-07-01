import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';
import PageHeader from '../components/PageHeader';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
const CHART_TYPES = ['line', 'bar', 'area'] as const;
const MAX_POINTS = 2000;
const MAX_CHART_SERIES = 24;
const MAX_PROFILES = 5;
const POLL_INTERVAL = 3000;
const MIN_CHART_ZOOM_POINTS = 10;
const CHART_RENDER_MAX = 3000;
const CHART_ANIMATION = false;

function formatChartAxisTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatYAxisTick(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (abs >= 1000) return `${(n / 1_000).toFixed(1)}k`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
function clampChartZoom(start: number, end: number, length: number): { start: number; end: number } {
  if (length <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, length - 1));
  const e = Math.max(s, Math.min(end, length - 1));
  return { start: s, end: e };
}

interface ChartZoomRange {
  start: number;
  end: number;
}

function chartPointIndex(activeTooltipIndex: unknown): number | null {
  if (typeof activeTooltipIndex === 'number' && activeTooltipIndex >= 0) {
    return activeTooltipIndex;
  }
  if (
    activeTooltipIndex != null
    && typeof activeTooltipIndex === 'object'
    && 'index' in activeTooltipIndex
    && typeof (activeTooltipIndex as { index?: unknown }).index === 'number'
  ) {
    const idx = (activeTooltipIndex as { index: number }).index;
    return idx >= 0 ? idx : null;
  }
  return null;
}
const PRIMARY_Y_AXIS_ID = 'y-left';
const SECONDARY_Y_AXIS_ID = 'y-right';
const PRESET_Y_AXES: YAxisConfig[] = [
  { id: PRIMARY_Y_AXIS_ID, label: 'Left', unit: '' },
  { id: SECONDARY_Y_AXIS_ID, label: 'Right', unit: '' },
];

function shortLabelFromField(fieldName: string): string {
  const dot = fieldName.lastIndexOf('.');
  return dot >= 0 ? fieldName.slice(dot + 1) : fieldName;
}

function ensureUniqueShortLabel(base: string, used: Set<string>): string {
  const trimmed = base.trim() || 'field';
  if (!used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  let n = 2;
  while (used.has(`${trimmed}_${n}`)) n += 1;
  const next = `${trimmed}_${n}`;
  used.add(next);
  return next;
}

function chartLabel(item: VizItem): string {
  return item.short_label?.trim() || shortLabelFromField(item.field_ref.field_name || item.label);
}

interface VizChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{
    dataKey?: string | number | ((obj: unknown) => unknown);
    value?: unknown;
    color?: string;
  }>;
  itemById: Map<string, VizItem>;
}

function VizChartTooltip({ active, label, payload, itemById }: VizChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="viz-chart-tooltip">
      <div className="viz-chart-tooltip-label">
        {label != null ? formatChartAxisTime(String(label)) : ''}
      </div>
      {payload.map(entry => {
        const rawKey = entry.dataKey;
        const key = typeof rawKey === 'function' ? '' : String(rawKey ?? '');
        if (!key) return null;
        const item = itemById.get(key);
        const name = item ? chartLabel(item) : key;
        const value = entry.value;
        const displayValue = typeof value === 'number'
          ? value.toLocaleString()
          : value != null
            ? String(value)
            : '';
        return (
          <div key={key} className="viz-chart-tooltip-row">
            <span className="viz-chart-tooltip-swatch" style={{ backgroundColor: entry.color }} />
            <span className="viz-chart-tooltip-name">{name}</span>
            <span className="viz-chart-tooltip-value">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}

function normalizeVizItems(items: VizItem[]): VizItem[] {
  const used = new Set<string>();
  return items.map(item => ({
    ...item,
    short_label: ensureUniqueShortLabel(
      item.short_label?.trim() || shortLabelFromField(item.field_ref.field_name || item.label),
      used,
    ),
  }));
}

function makeItem(protoId: string, fieldName: string, idx: number, usedShortLabels: Set<string>): VizItem {
  return {
    id: crypto.randomUUID(),
    label: fieldName,
    short_label: ensureUniqueShortLabel(shortLabelFromField(fieldName), usedShortLabels),
    color: COLORS[idx % COLORS.length],
    visible: true,
    field_ref: { protocol_id: protoId, field_name: fieldName },
    chart_type: 'line',
    y_axis: { ...PRESET_Y_AXES[0] },
    offset: 0,
    weight: 1,
  };
}

type ChartPoint = { timeKey: string } & Record<string, string | number>;

function decimateChartPoints(data: ChartPoint[], maxPoints: number): {
  points: ChartPoint[];
  decimated: boolean;
  sourceCount: number;
} {
  if (data.length <= maxPoints) {
    return { points: data, decimated: false, sourceCount: data.length };
  }
  const stride = Math.ceil(data.length / maxPoints);
  const points: ChartPoint[] = [];
  for (let i = 0; i < data.length; i += stride) {
    points.push(data[i]);
  }
  const last = data[data.length - 1];
  if (points[points.length - 1]?.timeKey !== last.timeKey) {
    points.push(last);
  }
  return { points, decimated: true, sourceCount: data.length };
}

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

function slimItemsForQuery(items: VizItem[]): VizItem[] {
  return items
    .filter(i => i.visible)
    .map(i => ({
      id: i.id,
      label: i.label,
      short_label: i.short_label,
      color: i.color,
      visible: true,
      field_ref: i.field_ref,
      chart_type: i.chart_type,
      y_axis: i.y_axis,
      offset: i.offset,
      weight: i.weight,
    }));
}

function toChartPoints(
  rows: Array<{ timestamp: string; values: Record<string, number> }>,
  sourceItems: VizItem[],
): ChartPoint[] {
  const visible = sourceItems.filter(i => i.visible);
  return rows.map(row => {
    const point: ChartPoint = {
      timeKey: row.timestamp,
    };
    for (const item of visible) {
      const v = row.values[item.label];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        point[item.id] = v;
      }
    }
    return point;
  });
}

export default function VizDashboardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [items, setItems] = useState<VizItem[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [chartZoom, setChartZoom] = useState<ChartZoomRange | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [isChartSelecting, setIsChartSelecting] = useState(false);
  const [profiles, setProfiles] = useState<VizProfile[]>([]);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [timeRangePreset, setTimeRangePreset] = useState(0);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [chartTooltipEnabled, setChartTooltipEnabled] = useState(true);
  const [queryMeta, setQueryMeta] = useState<{ total_matched: number; returned: number; downsampled: boolean } | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [fieldTooltip, setFieldTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const lastTimestampRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const chartZoomRef = useRef<ChartZoomRange | null>(null);
  chartZoomRef.current = chartZoom;
  const chartDataLengthRef = useRef(0);
  chartDataLengthRef.current = chartData.length;
  const wheelRafRef = useRef<number | null>(null);
  const wheelEventRef = useRef<{ deltaY: number; focusRatio: number } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;

  useEffect(() => {
    setChartZoom(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setIsChartSelecting(false);
  }, [chartData]);

  const applyChartZoomWindow = useCallback((start: number, end: number) => {
    if (chartData.length === 0) {
      setChartZoom(null);
      return;
    }
    const clamped = clampChartZoom(start, end, chartData.length);
    const span = clamped.end - clamped.start + 1;
    if (span >= chartData.length) {
      setChartZoom(null);
      return;
    }
    setChartZoom(clamped);
  }, [chartData.length]);

  const resetChartZoom = useCallback(() => {
    setChartZoom(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setIsChartSelecting(false);
  }, []);

  const zoomChartByFactor = useCallback((factor: number, focusRatio = 0.5) => {
    if (chartData.length === 0 || liveMode) return;
    const currentStart = chartZoom?.start ?? 0;
    const currentEnd = chartZoom?.end ?? chartData.length - 1;
    const span = currentEnd - currentStart + 1;
    const newSpan = Math.max(
      MIN_CHART_ZOOM_POINTS,
      Math.min(chartData.length, Math.round(span * factor)),
    );
    const focusIndex = Math.round(currentStart + focusRatio * (span - 1));
    let newStart = Math.round(focusIndex - focusRatio * (newSpan - 1));
    let newEnd = newStart + newSpan - 1;
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd >= chartData.length) {
      newStart -= newEnd - chartData.length + 1;
      newEnd = chartData.length - 1;
    }
    applyChartZoomWindow(newStart, newEnd);
  }, [applyChartZoomWindow, chartData.length, chartZoom, liveMode]);

  const finalizeChartSelection = useCallback(() => {
    if (!isChartSelecting || refAreaLeft == null || refAreaRight == null) {
      setIsChartSelecting(false);
      setRefAreaLeft(null);
      setRefAreaRight(null);
      return;
    }
    const viewStart = chartZoom?.start ?? 0;
    const renderLeft = Math.min(refAreaLeft, refAreaRight);
    const renderRight = Math.max(refAreaLeft, refAreaRight);
    setIsChartSelecting(false);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    if (renderRight - renderLeft + 1 < MIN_CHART_ZOOM_POINTS) return;

    const { start, end } = chartZoom
      ? clampChartZoom(chartZoom.start, chartZoom.end, chartData.length)
      : { start: 0, end: chartData.length - 1 };
    const windowData = chartData.slice(start, end + 1);
    const { points: renderPoints } = decimateChartPoints(windowData, CHART_RENDER_MAX);
    const mapRenderIndex = (renderIndex: number) => {
      const key = renderPoints[renderIndex]?.timeKey;
      if (!key) return renderIndex;
      const idx = windowData.findIndex(p => p.timeKey === key);
      return idx >= 0 ? idx : renderIndex;
    };
    applyChartZoomWindow(
      viewStart + mapRenderIndex(renderLeft),
      viewStart + mapRenderIndex(renderRight),
    );
  }, [applyChartZoomWindow, chartData, chartZoom, isChartSelecting, refAreaLeft, refAreaRight]);

  const handleChartMouseDown = useCallback((state: { activeTooltipIndex?: unknown }) => {
    if (liveMode) return;
    const idx = chartPointIndex(state.activeTooltipIndex);
    if (idx == null) return;
    setRefAreaLeft(idx);
    setRefAreaRight(idx);
    setIsChartSelecting(true);
  }, [liveMode]);

  const handleChartMouseMove = useCallback((state: { activeTooltipIndex?: unknown }) => {
    if (!isChartSelecting || refAreaLeft == null) return;
    const idx = chartPointIndex(state.activeTooltipIndex);
    if (idx == null) return;
    setRefAreaRight(idx);
  }, [isChartSelecting, refAreaLeft]);

  useEffect(() => {
    if (!isChartSelecting) return;
    const onMouseUp = () => finalizeChartSelection();
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [finalizeChartSelection, isChartSelecting]);

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const applyWheelZoom = (deltaY: number, focusRatio: number) => {
      if (liveModeRef.current) return;
      const len = chartDataLengthRef.current;
      if (len === 0) return;
      const factor = deltaY > 0 ? 1.12 : 0.89;
      const zoom = chartZoomRef.current;
      const currentStart = zoom?.start ?? 0;
      const currentEnd = zoom?.end ?? len - 1;
      const span = currentEnd - currentStart + 1;
      const newSpan = Math.max(
        MIN_CHART_ZOOM_POINTS,
        Math.min(len, Math.round(span * factor)),
      );
      const focusIndex = Math.round(currentStart + focusRatio * (span - 1));
      let newStart = Math.round(focusIndex - focusRatio * (newSpan - 1));
      let newEnd = newStart + newSpan - 1;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd >= len) {
        newStart -= newEnd - len + 1;
        newEnd = len - 1;
      }
      newStart = Math.max(0, newStart);
      if (newStart === 0 && newEnd >= len - 1) {
        setChartZoom(null);
      } else {
        setChartZoom(clampChartZoom(newStart, newEnd, len));
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (liveModeRef.current || chartDataLengthRef.current === 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const focusRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      wheelEventRef.current = { deltaY: e.deltaY, focusRatio };
      if (wheelRafRef.current != null) return;
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const ev = wheelEventRef.current;
        wheelEventRef.current = null;
        if (!ev) return;
        applyWheelZoom(ev.deltaY, ev.focusRatio);
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    api.boards.list().then(setBoards);
    api.protocols.list().then(setProtocols);
  }, []);

  useEffect(() => {
    if (selectedBoard || boards.length === 0) return;
    const preferred = boards.find(b => b.name === 'STN-001') ?? boards[0];
    setSelectedBoard(preferred.id);
  }, [boards, selectedBoard]);

  useEffect(() => {
    if (!selectedBoard) return;
    const board = boards.find(b => b.id === selectedBoard);
    if (board?.protocol_id) {
      setSelectedProto(board.protocol_id);
    }
  }, [selectedBoard, boards]);

  const loadProfile = useCallback(async (id: string) => {
    setProfileError('');
    const p = await api.viz.getProfile(id);
    setSelectedBoard(p.board_id);
    setItems(normalizeVizItems(p.items));
    setSavedProfileId(p.id);
    setShowProfileAdd(false);
    setProfileDraftName('');
    const protoId = p.items.find(i => i.field_ref.protocol_id)?.field_ref.protocol_id;
    if (protoId) setSelectedProto(protoId);
    if (p.time_range?.start && p.time_range?.end) {
      setCustomStart(toLocalISO(new Date(p.time_range.start)));
      setCustomEnd(toLocalISO(new Date(p.time_range.end)));
      setTimeRangePreset(0);
    }
    setLoading(true);
    try {
      const result = await api.viz.queryItems({
        board_id: p.board_id,
        items: slimItemsForQuery(p.items),
        time_range: p.time_range?.start && p.time_range?.end
          ? { start: p.time_range.start, end: p.time_range.end }
          : undefined,
        limit: p.time_range?.start && p.time_range?.end ? MAX_POINTS : 0,
      });
      const points = toChartPoints(result.data, p.items);
      setChartData(points);
      setQueryMeta(result.meta ?? null);
      if (points.length > 0) {
        lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      }
    } finally {
      setLoading(false);
    }
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

  const isAllTimeRange = useCallback(
    () => timeRangePreset === 0 && !customStart && !customEnd,
    [timeRangePreset, customStart, customEnd],
  );

  const resolveQueryLimit = useCallback(
    () => (isAllTimeRange() ? 0 : MAX_POINTS),
    [isAllTimeRange],
  );

  const fetchAll = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    setLoading(true);
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: slimItemsForQuery(itemsRef.current),
        time_range: buildTimeRange(),
        limit: resolveQueryLimit(),
      });
      const points = toChartPoints(result.data, itemsRef.current);
      setChartData(points);
      setQueryMeta(result.meta ?? null);
      if (points.length > 0) {
        lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      }
    } finally {
      setLoading(false);
    }
  }, [selectedBoard, buildTimeRange, resolveQueryLimit]);

  const appendLive = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    const since = lastTimestampRef.current;
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: slimItemsForQuery(itemsRef.current),
        since: since || undefined,
        limit: MAX_POINTS,
      });
      if (!result.data.length) return;
      const newPoints = toChartPoints(result.data, itemsRef.current);
      lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      setChartData(prev => {
        const existing = since ? prev : [];
        const merged = [...existing, ...newPoints];
        if (isAllTimeRange()) return merged;
        return merged.length > MAX_POINTS ? merged.slice(-MAX_POINTS) : merged;
      });
    } catch {
      // ignore polling errors
    }
  }, [selectedBoard, isAllTimeRange]);

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

  const selectedProtocol = useMemo(
    () => protocols.find(p => p.id === selectedProto),
    [protocols, selectedProto],
  );

  const existingFieldLabels = useMemo(
    () => new Set(items.map(i => i.label)),
    [items],
  );

  const protocolFieldPaths = useMemo(
    () => collectParseRuleFieldPaths(selectedProtocol?.parse_rules),
    [selectedProtocol],
  );

  const addAllFields = () => {
    if (!selectedProto || !selectedProtocol) return;
    const usedShortLabels = new Set(items.map(i => chartLabel(i)));
    const newItems = protocolFieldPaths
      .filter(name => !existingFieldLabels.has(name))
      .map((name, i) => ({
        ...makeItem(selectedProto, name, items.length + i, usedShortLabels),
        visible: i < 5,
      }));
    if (newItems.length) setItems(prev => [...prev, ...newItems]);
  };

  const toggleVisibility = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  };

  const setAllVisible = (visible: boolean) => {
    setItems(prev => prev.map(i => ({ ...i, visible })));
  };

  const visHeaderRef = useRef<HTMLInputElement>(null);
  const allVisible = items.length > 0 && items.every(i => i.visible);
  const someVisible = items.some(i => i.visible) && !allVisible;

  useEffect(() => {
    if (visHeaderRef.current) {
      visHeaderRef.current.indeterminate = someVisible;
    }
  }, [someVisible]);

  const toggleAllVisibility = () => {
    setAllVisible(!allVisible);
  };

  const updateItem = (id: string, key: keyof VizItem, value: unknown) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [key]: value } as VizItem : i));
  };

  const saveProfile = async (name: string) => {
    if (!selectedBoard) {
      setProfileError('보드를 먼저 선택하세요.');
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileError('프로파일 이름을 입력하세요.');
      return false;
    }
    if (items.length === 0) {
      setProfileError('저장할 Items가 없습니다.');
      return false;
    }

    const existing = profiles.find(p => p.name === trimmed);
    if (!existing && profiles.length >= MAX_PROFILES) {
      setProfileError(`보드당 최대 ${MAX_PROFILES}개까지 저장할 수 있습니다.`);
      return false;
    }

    setProfileSaving(true);
    setProfileError('');
    try {
      const data = {
        name: trimmed,
        board_id: selectedBoard,
        items,
        time_range: buildTimeRange(),
      };
      if (existing) {
        await api.viz.updateProfile(existing.id, { ...existing, ...data });
        setSavedProfileId(existing.id);
      } else {
        const created = await api.viz.createProfile(data as Parameters<typeof api.viz.createProfile>[0]);
        setSavedProfileId(created.id);
      }
      setProfiles(await api.viz.listProfiles(selectedBoard));
      return true;
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : '프로파일 저장에 실패했습니다.');
      return false;
    } finally {
      setProfileSaving(false);
    }
  };

  const confirmSaveProfile = async () => {
    const ok = await saveProfile(profileDraftName);
    if (ok) {
      setShowProfileAdd(false);
      setProfileDraftName('');
    }
  };

  const cancelProfileAdd = () => {
    setShowProfileAdd(false);
    setProfileDraftName('');
    setProfileError('');
  };

  const openProfileAdd = () => {
    setProfileError('');
    setProfileDraftName('');
    setShowProfileAdd(true);
  };

  const deleteProfile = async (id: string) => {
    setProfileError('');
    try {
      await api.viz.deleteProfile(id);
      if (savedProfileId === id) {
        setSavedProfileId(null);
      }
      if (selectedBoard) {
        setProfiles(await api.viz.listProfiles(selectedBoard));
      }
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : '프로파일 삭제에 실패했습니다.');
    }
  };

  const visibleItems = items.filter(i => i.visible);
  const chartItems = visibleItems.slice(0, MAX_CHART_SERIES);
  const chartSeriesTruncated = visibleItems.length > MAX_CHART_SERIES;

  const displayChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (!chartZoom) return chartData;
    const { start, end } = clampChartZoom(chartZoom.start, chartZoom.end, chartData.length);
    return chartData.slice(start, end + 1);
  }, [chartData, chartZoom]);

  const chartRender = useMemo(
    () => decimateChartPoints(displayChartData, CHART_RENDER_MAX),
    [displayChartData],
  );
  const renderChartData = chartRender.points;

  const chartZoomActive = chartZoom != null && displayChartData.length < chartData.length;

  const chartItemById = useMemo(
    () => new Map(chartItems.map(item => [item.id, item])),
    [chartItems],
  );

  const yAxisOptions = useMemo(() => {
    const ids = new Set(PRESET_Y_AXES.map(a => a.id));
    for (const item of items) ids.add(item.y_axis.id);
    return [...ids];
  }, [items]);

  const chartYAxes = useMemo(() => {
    if (chartItems.length === 0) return [];
    const usesRight = chartItems.some(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    const axes: Array<{ id: string; orientation: 'left' | 'right' }> = [
      { id: PRIMARY_Y_AXIS_ID, orientation: 'left' },
    ];
    if (usesRight) {
      axes.push({ id: SECONDARY_Y_AXIS_ID, orientation: 'right' });
    }
    return axes;
  }, [chartItems]);

  const resolveItemYAxisId = useCallback((item: VizItem) => (
    item.y_axis.id === SECONDARY_Y_AXIS_ID ? SECONDARY_Y_AXIS_ID : PRIMARY_Y_AXIS_ID
  ), []);

  const statistics = useMemo(() => {
    const stats: Record<string, Statistics> = {};
    for (const item of visibleItems) {
      const values = displayChartData
        .map(d => d[item.id])
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
  }, [visibleItems, displayChartData]);

  const exportCSV = () => {
    if (!displayChartData.length) return;
    const headers = ['timestamp', ...visibleItems.map(i => chartLabel(i))];
    const rows = displayChartData.map(d => [
      formatChartAxisTime(String(d.timeKey)),
      ...visibleItems.map(i => d[i.id] ?? ''),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profiles.find(p => p.id === savedProfileId)?.name || 'chart-data'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderChartShape = (item: VizItem) => {
    const yAxisId = resolveItemYAxisId(item);
    const name = chartLabel(item);
    if (item.chart_type === 'bar') {
      return (
        <Bar
          key={item.id}
          yAxisId={yAxisId}
          dataKey={item.id}
          fill={item.color}
          name={name}
          isAnimationActive={CHART_ANIMATION}
        />
      );
    }
    if (item.chart_type === 'area') {
      return (
        <Area
          key={item.id}
          yAxisId={yAxisId}
          dataKey={item.id}
          type="linear"
          fill={item.color}
          stroke={item.color}
          fillOpacity={0.3}
          name={name}
          isAnimationActive={CHART_ANIMATION}
        />
      );
    }
    return (
      <Line
        key={item.id}
        yAxisId={yAxisId}
        dataKey={item.id}
        type="linear"
        dot={false}
        stroke={item.color}
        name={name}
        isAnimationActive={CHART_ANIMATION}
      />
    );
  };

  const selectionLeft = refAreaLeft == null || refAreaRight == null
    ? null
    : Math.min(refAreaLeft, refAreaRight);
  const selectionRight = refAreaLeft == null || refAreaRight == null
    ? null
    : Math.max(refAreaLeft, refAreaRight);
  const selectionX1 = selectionLeft != null ? renderChartData[selectionLeft]?.timeKey : undefined;
  const selectionX2 = selectionRight != null ? renderChartData[selectionRight]?.timeKey : undefined;

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
          <button type="button" onClick={addAllFields} disabled={!selectedProto}>+ Add All Fields</button>
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

      <div className="card viz-items-card">
        <div className="viz-items-header">
          <h2>Items ({items.length})</h2>
          <div className="viz-items-header-right">
            {showProfileAdd ? (
              <div className="viz-profile-add-form">
                <input
                  autoFocus
                  placeholder="프로파일 이름"
                  value={profileDraftName}
                  onChange={e => setProfileDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void confirmSaveProfile();
                    if (e.key === 'Escape') cancelProfileAdd();
                  }}
                  disabled={profileSaving}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => void confirmSaveProfile()}
                  disabled={profileSaving || items.length === 0 || !selectedBoard}
                >
                  {profileSaving ? '…' : 'Save'}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={cancelProfileAdd} disabled={profileSaving}>
                  Cancel
                </button>
              </div>
            ) : selectedBoard ? (
              <div className="viz-profile-tags">
                {profiles.map(p => (
                  <span
                    key={p.id}
                    className={`viz-profile-tag-wrap${savedProfileId === p.id ? ' active' : ''}`}
                  >
                    <button
                      type="button"
                      className="viz-profile-tag"
                      onClick={() => loadProfile(p.id)}
                      title={`${p.items.length} items · visible ${p.items.filter(i => i.visible).length}`}
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      className="viz-profile-tag-remove"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => void deleteProfile(p.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {profiles.length < MAX_PROFILES && (
                  <button
                    type="button"
                    className="viz-profile-tag-add"
                    onClick={openProfileAdd}
                    title="프로파일 추가"
                  >
                    +
                  </button>
                )}
              </div>
            ) : (
              <span className="muted viz-items-header-hint">보드 선택 후 프로파일 저장</span>
            )}
            {profileError && (
              <span className="viz-profile-error-inline" title={profileError}>!</span>
            )}
          </div>
        </div>
        <div className="viz-items-scroll">
          <table>
            <thead>
              <tr>
                <th className="viz-vis-col">
                  <div className="viz-vis-header">
                    <input
                      ref={visHeaderRef}
                      type="checkbox"
                      checked={allVisible}
                      onChange={toggleAllVisibility}
                      disabled={items.length === 0}
                      title="모두 선택/해제"
                      aria-label="모두 선택/해제"
                    />
                    <span className="viz-vis-actions">
                      <button
                        type="button"
                        className="viz-vis-action"
                        onClick={() => setAllVisible(true)}
                        disabled={items.length === 0 || allVisible}
                      >
                        전체
                      </button>
                      <button
                        type="button"
                        className="viz-vis-action"
                        onClick={() => setAllVisible(false)}
                        disabled={items.length === 0 || !items.some(i => i.visible)}
                      >
                        해제
                      </button>
                    </span>
                  </div>
                </th>
                <th>Short</th>
                <th>Field</th>
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
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="viz-items-empty">
                    Items가 없습니다. Configuration에서 필드를 추가하세요.
                  </td>
                </tr>
              )}
              {items.map(item => (
                <tr key={item.id}>
                  <td><input type="checkbox" checked={item.visible} onChange={() => toggleVisibility(item.id)} /></td>
                  <td>
                    <input
                      type="text"
                      value={item.short_label ?? ''}
                      onChange={e => updateItem(item.id, 'short_label', e.target.value)}
                      style={{ width: 110 }}
                      title="차트에 표시되는 짧은 이름"
                    />
                  </td>
                  <td
                    className="mono viz-item-field"
                    onMouseEnter={e => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setFieldTooltip({
                        text: item.label,
                        x: rect.left + rect.width / 2,
                        y: rect.bottom + 8,
                      });
                    }}
                    onMouseLeave={() => setFieldTooltip(null)}
                  >
                    {item.label}
                  </td>
                  <td>
                    <select value={item.chart_type} onChange={e => updateItem(item.id, 'chart_type', e.target.value)}>
                      {CHART_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={item.y_axis.id} onChange={e => {
                      const preset = PRESET_Y_AXES.find(a => a.id === e.target.value);
                      updateItem(item.id, 'y_axis', preset ?? { ...item.y_axis, id: e.target.value } as YAxisConfig);
                    }}>
                      {yAxisOptions.map(yId => <option key={yId} value={yId}>{yId}</option>)}
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
                  <td className="viz-color-col">
                    <input
                      type="color"
                      className="viz-item-color-input"
                      value={item.color}
                      onChange={e => updateItem(item.id, 'color', e.target.value)}
                      title={item.color}
                      aria-label={`Color for ${item.label}`}
                    />
                  </td>
                  <td><button className="btn-danger" onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card viz-chart-card">
        <div className="viz-chart-header">
          <h2>
            Chart ({renderChartData.length.toLocaleString()}{chartRender.decimated ? ` / ${chartRender.sourceCount.toLocaleString()}` : ''} points
            {queryMeta?.downsampled && (
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                · sampled {queryMeta.returned.toLocaleString()} / {queryMeta.total_matched.toLocaleString()}
              </span>
            )}
            {chartSeriesTruncated && (
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                · showing {MAX_CHART_SERIES} / {visibleItems.length} series
              </span>
            )}
            {chartRender.decimated && (
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                · render sampled
              </span>
            )}
            {chartZoomActive && (
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                · zoomed
              </span>
            )}
            )
            {liveMode && <span className="muted" style={{ marginLeft: 8 }}>· polling every {POLL_INTERVAL / 1000}s</span>}
          </h2>
          <div className="viz-chart-zoom-controls">
            <button
              type="button"
              className={`btn-ghost btn-sm viz-chart-tooltip-toggle${chartTooltipEnabled ? ' active' : ''}`}
              onClick={() => setChartTooltipEnabled(v => !v)}
              title="호버 시 값 팝업 표시"
              aria-pressed={chartTooltipEnabled}
            >
              팝업
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => zoomChartByFactor(0.8)}
              disabled={liveMode || displayChartData.length === 0}
              title="수평 확대"
            >
              +
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => zoomChartByFactor(1.25)}
              disabled={liveMode || !chartZoomActive}
              title="수평 축소"
            >
              −
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={resetChartZoom}
              disabled={liveMode || !chartZoomActive}
              title="줌 초기화"
            >
              Reset
            </button>
          </div>
        </div>
        {!liveMode && displayChartData.length > 0 && (
          <p className="viz-chart-zoom-hint muted">
            드래그: 영역 확대 · 휠: 수평 줌 · 더블클릭: 초기화
          </p>
        )}
        <div
          ref={chartViewportRef}
          className={`viz-chart-viewport${isChartSelecting ? ' selecting' : ''}${liveMode ? ' live' : ''}`}
          tabIndex={-1}
          onDoubleClick={liveMode ? undefined : resetChartZoom}
        >
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart
              data={renderChartData}
              margin={{ top: 8, right: 0, left: 0, bottom: 4 }}
              onMouseDown={handleChartMouseDown}
              onMouseMove={handleChartMouseMove}
              onMouseUp={finalizeChartSelection}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3040" />
              <XAxis
                dataKey="timeKey"
                tickFormatter={formatChartAxisTime}
                fontSize={11}
                stroke="#888aa0"
                tickMargin={6}
                minTickGap={28}
              />
              {chartYAxes.map(y => (
                <YAxis
                  key={y.id}
                  yAxisId={y.id}
                  orientation={y.orientation}
                  width={30}
                  tickFormatter={formatYAxisTick}
                  tick={{ fontSize: 9, fill: '#888aa0' }}
                  stroke="#888aa0"
                  tickLine={false}
                  axisLine={false}
                />
              ))}
              {chartTooltipEnabled && (
                <Tooltip
                  isAnimationActive={CHART_ANIMATION}
                  content={(props) => (
                    <VizChartTooltip
                      active={props.active}
                      label={props.label}
                      payload={props.payload as VizChartTooltipProps['payload']}
                      itemById={chartItemById}
                    />
                  )}
                />
              )}
              {isChartSelecting && selectionX1 != null && selectionX2 != null && selectionX1 !== selectionX2 && (
                <ReferenceArea
                  x1={selectionX1}
                  x2={selectionX2}
                  stroke="var(--accent, #7c83ff)"
                  strokeOpacity={0.8}
                  fill="var(--accent, #7c83ff)"
                  fillOpacity={0.15}
                />
              )}
              {chartItems.map(item => renderChartShape(item))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {chartItems.length > 0 && (
          <div className="viz-chart-legend" aria-label="Chart series">
            {chartItems.map(item => (
              <span key={item.id} className="viz-chart-legend-item" title={item.label}>
                <span className="viz-chart-legend-swatch" style={{ backgroundColor: item.color }} />
                <span className="viz-chart-legend-label">{chartLabel(item)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {Object.keys(statistics).length > 0 && (
        <div className="card viz-stats-card">
          <h2>Statistics</h2>
          <div className="viz-stats-scroll">
            <table>
              <thead>
                <tr>
                  <th>Short</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Avg</th>
                  <th>Latest</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(item => {
                  const s = statistics[item.label];
                  if (!s) return null;
                  return (
                    <tr key={item.label}>
                      <td title={item.label}>{chartLabel(item)}</td>
                      <td>{s.min.toFixed(2)}</td>
                      <td>{s.max.toFixed(2)}</td>
                      <td>{s.avg.toFixed(2)}</td>
                      <td>{typeof s.last === 'number' ? s.last.toFixed(2) : s.last}</td>
                      <td>{s.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fieldTooltip && (
        <div
          className="viz-field-tooltip"
          style={{ left: fieldTooltip.x, top: fieldTooltip.y }}
          role="tooltip"
        >
          {fieldTooltip.text}
        </div>
      )}
    </div>
  );
}
