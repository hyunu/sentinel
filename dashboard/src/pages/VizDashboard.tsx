import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';
import ChartZoomNavigator from '../components/ChartZoomNavigator';
import ChartCursorValues, { buildCursorValueRows } from '../components/ChartCursorValues';
import PageHeader from '../components/PageHeader';
import {
  IconFullscreen,
  IconFullscreenExit,
  IconTooltip,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconSearch,
} from '../components/ChartControlIcons';
import { formatDateTimeFromDate, formatChartAxisTime, formatTimeInterval, parseDateTime } from '../utils/date';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';
import {
  cancelChartZoomRaf,
  createChartZoomCommitter,
  getChartTimeMsFromClientX,
  mergeWheelZoomEvent,
  shouldHideTooltipDuringInteraction,
  syncChartZoomRef,
  useChartSelectionOverlay,
  useChartTimeMeasureOverlay,
  type ChartZoomRange,
} from '../lib/vizChartInteraction';

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
const CHART_TYPES = ['line', 'bar', 'area'] as const;
const MAX_POINTS = 8000;
const MAX_CHART_SERIES = 24;
const MAX_PROFILES = 5;
const POLL_INTERVAL = 3000;
const MIN_CHART_ZOOM_POINTS = 10;
const CHART_RENDER_MAX = 8000;
const CHART_ANIMATION = false;

function formatDisplayValue(value: number, unit?: string): string {
  const text = value.toLocaleString();
  const u = unit?.trim();
  return u ? `${text} ${u}` : text;
}

function axisUnitLabel(itemsOnAxis: VizItem[]): string {
  const units = [...new Set(
    itemsOnAxis.map(i => i.y_axis.unit?.trim() || '').filter(Boolean),
  )];
  if (units.length === 1) return units[0];
  if (units.length > 1) return units.join(' / ');
  return '';
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

function itemMatchesFieldSearch(item: VizItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.label,
    item.field_ref.field_name,
    item.short_label ?? '',
    chartLabel(item),
  ].join('\n').toLowerCase();
  return haystack.includes(q);
}

function resolveRawValue(item: VizItem, rawValuesAtTime?: Record<string, number>): number | undefined {
  if (!rawValuesAtTime) return undefined;
  for (const key of [item.label, item.field_ref.field_name]) {
    const v = rawValuesAtTime[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return undefined;
}

function applyItemTransform(raw: number, item: VizItem): number {
  return raw * item.weight + item.offset;
}

function formatTooltipItemValue(
  item: VizItem | undefined,
  rawValuesAtTime: Record<string, number> | undefined,
  chartValue: unknown,
): string {
  if (!item) return chartValue != null ? String(chartValue) : '';
  const unit = item.y_axis.unit?.trim();
  if (typeof chartValue === 'number' && !Number.isNaN(chartValue)) {
    const display = formatDisplayValue(chartValue, unit);
    const raw = resolveRawValue(item, rawValuesAtTime);
    if (typeof raw === 'number' && (item.weight !== 1 || item.offset !== 0)) {
      return `${display} (raw ${formatDisplayValue(raw, unit)})`;
    }
    return display;
  }
  const raw = resolveRawValue(item, rawValuesAtTime);
  if (typeof raw === 'number') {
    return formatDisplayValue(applyItemTransform(raw, item), unit);
  }
  const base = chartValue != null ? String(chartValue) : '';
  return unit && base ? `${base} ${unit}` : base;
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
  rawValuesAtTime?: Record<string, number>;
}

function VizChartTooltip({ active, label, payload, itemById, rawValuesAtTime }: VizChartTooltipProps) {
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
        const displayValue = formatTooltipItemValue(item, rawValuesAtTime, entry.value);
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

function chartPointValue(point: ChartPoint, seriesIds: string[]): number | null {
  for (const id of seriesIds) {
    const v = point[id];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  for (const key of Object.keys(point)) {
    if (key === 'timeKey') continue;
    const v = point[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return null;
}

function decimateChartPoints(
  data: ChartPoint[],
  maxPoints: number,
  seriesIds: string[] = [],
): {
  points: ChartPoint[];
  decimated: boolean;
  sourceCount: number;
} {
  if (data.length <= maxPoints) {
    return { points: data, decimated: false, sourceCount: data.length };
  }

  const targetBuckets = Math.max(2, maxPoints - 1);
  const bucketSize = data.length / targetBuckets;
  const chosenIndices = new Set<number>([0, data.length - 1]);

  for (let b = 0; b < targetBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(data.length, Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    const firstVal = chartPointValue(data[start], seriesIds);
    if (firstVal == null) continue;
    let minVal = firstVal;
    let maxVal = firstVal;

    for (let i = start + 1; i < end; i++) {
      const v = chartPointValue(data[i], seriesIds);
      if (v == null) continue;
      if (v < minVal) {
        minVal = v;
        minIdx = i;
      }
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    chosenIndices.add(minIdx);
    if (maxIdx !== minIdx) chosenIndices.add(maxIdx);
  }

  let points = [...chosenIndices].sort((a, b) => a - b).map(i => data[i]);
  if (points.length > maxPoints) {
    const stride = Math.ceil(points.length / maxPoints);
    const trimmed: ChartPoint[] = [];
    for (let i = 0; i < points.length; i += stride) trimmed.push(points[i]);
    const last = points[points.length - 1];
    if (trimmed[trimmed.length - 1]?.timeKey !== last.timeKey) trimmed.push(last);
    points = trimmed;
  }

  return { points, decimated: true, sourceCount: data.length };
}

function computeYAxisDomain(data: ChartPoint[], itemIds: string[]): [number, number] | undefined {
  if (itemIds.length === 0 || data.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const point of data) {
    for (const id of itemIds) {
      const v = point[id];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

interface Statistics {
  min: number;
  max: number;
  avg: number;
  count: number;
  last: number | string;
}

const TIME_PRESET_ALL = 'all' as const;

type TimePresetId = typeof TIME_PRESET_ALL | '1d' | '3d' | '7d' | '15d' | '30d' | '3m' | '6m' | '1y';

const TIME_PRESETS: Array<{ id: TimePresetId; label: string }> = [
  { id: '1d', label: '1d' },
  { id: '3d', label: '3d' },
  { id: '7d', label: '7d' },
  { id: '15d', label: '15d' },
  { id: '30d', label: '30d' },
  { id: '3m', label: '3m' },
  { id: '6m', label: '6m' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All' },
];

function presetRangeStart(end: Date, presetId: TimePresetId): Date {
  switch (presetId) {
    case '1d':
      return new Date(end.getTime() - 86400000);
    case '3d':
      return new Date(end.getTime() - 3 * 86400000);
    case '7d':
      return new Date(end.getTime() - 7 * 86400000);
    case '15d':
      return new Date(end.getTime() - 15 * 86400000);
    case '30d':
      return new Date(end.getTime() - 30 * 86400000);
    case '3m': {
      const start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      return start;
    }
    case '6m': {
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      return start;
    }
    case '1y': {
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      return start;
    }
    default:
      return end;
  }
}

function isAllTimeRangeSelection(presetId: TimePresetId, customStart: string, customEnd: string): boolean {
  return presetId === TIME_PRESET_ALL && !customStart && !customEnd;
}

function isCustomTimeRangeSelection(presetId: TimePresetId, customStart: string, customEnd: string): boolean {
  return presetId === TIME_PRESET_ALL && !!(customStart || customEnd);
}

type VizDataRow = { timestamp: string; values: Record<string, number> };
type VizQueryMeta = { total_matched: number; returned: number; downsampled: boolean };

function itemsForDataQuery(items: VizItem[]): VizItem[] {
  return items.map(i => ({
    id: i.id,
    label: i.label,
    short_label: i.short_label,
    color: i.color,
    visible: i.visible,
    field_ref: i.field_ref,
    chart_type: i.chart_type,
    y_axis: i.y_axis,
    offset: i.offset,
    weight: i.weight,
  }));
}

function toChartPoints(
  rows: VizDataRow[],
  sourceItems: VizItem[],
): ChartPoint[] {
  const visible = sourceItems.filter(i => i.visible);
  return rows.map(row => {
    const point: ChartPoint = {
      timeKey: row.timestamp,
    };
    for (const item of visible) {
      const raw = row.values[item.label];
      if (typeof raw === 'number' && !Number.isNaN(raw)) {
        point[item.id] = applyItemTransform(raw, item);
      }
    }
    return point;
  });
}

function parseNumericDraft(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return fallback;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

interface VizItemNumericInputProps {
  value: number;
  onCommit: (value: number) => void;
  emptyFallback: number;
  width?: number;
  ariaLabel: string;
}

function VizItemNumericInput({
  value,
  onCommit,
  emptyFallback,
  width = 70,
  ariaLabel,
}: VizItemNumericInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <input
      type="text"
      inputMode="decimal"
      className="viz-item-numeric-input"
      value={editing ? draft : String(value)}
      aria-label={ariaLabel}
      style={{ width }}
      onFocus={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => {
        setEditing(false);
        onCommit(parseNumericDraft(e.target.value, emptyFallback));
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

interface VizItemNameInputProps {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  title?: string;
}

function VizItemNameInput({ value, onCommit, ariaLabel, title }: VizItemNameInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <input
      type="text"
      className="viz-item-name-input"
      value={editing ? draft : value}
      aria-label={ariaLabel}
      title={title}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => {
        setEditing(false);
        onCommit(e.target.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function VizDashboardPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [items, setItems] = useState<VizItem[]>([]);
  const itemTransformKey = useMemo(
    () => items.map(i => `${i.id}:${i.offset}:${i.weight}:${i.visible}:${i.color}:${i.chart_type}:${i.y_axis.id}:${i.y_axis.unit ?? ''}`).join('|'),
    [items],
  );
  const [rawVizData, setRawVizData] = useState<VizDataRow[]>([]);
  const chartData = useMemo(
    () => toChartPoints(rawVizData, items),
    [rawVizData, itemTransformKey],
  );
  const [chartZoom, setChartZoom] = useState<ChartZoomRange | null>(null);
  const refAreaLeftRef = useRef<number | null>(null);
  const refAreaRightRef = useRef<number | null>(null);
  const [isChartSelecting, setIsChartSelecting] = useState(false);
  const [isChartPanning, setIsChartPanning] = useState(false);
  const [isChartMeasuring, setIsChartMeasuring] = useState(false);
  const [profiles, setProfiles] = useState<VizProfile[]>([]);
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [timeRangePresetId, setTimeRangePresetId] = useState<TimePresetId>(TIME_PRESET_ALL);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [chartTooltipEnabled, setChartTooltipEnabled] = useState(true);
  const [hoverTimeKey, setHoverTimeKey] = useState<string | null>(null);
  const [queryMeta, setQueryMeta] = useState<VizQueryMeta | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [fieldTooltip, setFieldTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [itemFieldSearch, setItemFieldSearch] = useState('');
  const [itemFieldSearchOpen, setItemFieldSearchOpen] = useState(false);
  const itemFieldSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [chartViewportHeight, setChartViewportHeight] = useState(600);
  const lastTimestampRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const chartZoomRef = useRef<ChartZoomRange | null>(null);
  chartZoomRef.current = chartZoom;
  const chartDataLengthRef = useRef(0);
  chartDataLengthRef.current = chartData.length;
  const wheelRafRef = useRef<number | null>(null);
  const wheelEventRef = useRef<{ deltaY: number; focusRatio: number } | null>(null);
  const pendingChartZoomRef = useRef<ChartZoomRange | null | undefined>(undefined);
  const chartZoomRafRef = useRef<number | null>(null);
  const chartZoomRafRefs = useMemo(
    () => ({ pendingRef: pendingChartZoomRef, rafRef: chartZoomRafRef }),
    [],
  );
  const selectionOverlay = useChartSelectionOverlay();
  const timeMeasureOverlay = useChartTimeMeasureOverlay();
  const panSessionRef = useRef<{
    pointerId: number;
    startX: number;
    zoomStart: number;
    zoomEnd: number;
    span: number;
  } | null>(null);
  const activeChartPointerRef = useRef<number | null>(null);
  const isChartSelectingRef = useRef(false);
  isChartSelectingRef.current = isChartSelecting;
  const isChartMeasuringRef = useRef(false);
  isChartMeasuringRef.current = isChartMeasuring;
  const renderChartDataLengthRef = useRef(0);
  const renderChartPointsRef = useRef<ChartPoint[]>([]);
  const measureSessionRef = useRef<{
    pointerId: number;
    startTimeMs: number;
  } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;

  const rawVizDataKey = useMemo(
    () => (rawVizData.length > 0
      ? `${rawVizData.length}:${rawVizData[0]?.timestamp}:${rawVizData[rawVizData.length - 1]?.timestamp}`
      : 'empty'),
    [rawVizData],
  );

  const commitChartZoom = useMemo(
    () => createChartZoomCommitter(chartZoomRef, setChartZoom, chartZoomRafRefs),
    [chartZoomRafRefs],
  );

  const commitChartZoomRef = useRef(commitChartZoom);
  commitChartZoomRef.current = commitChartZoom;

  useEffect(() => {
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    setIsChartSelecting(false);
    selectionOverlay.hide();
    setIsChartPanning(false);
    setIsChartMeasuring(false);
    isChartSelectingRef.current = false;
    isChartMeasuringRef.current = false;
    measureSessionRef.current = null;
    timeMeasureOverlay.hide();
    panSessionRef.current = null;
    activeChartPointerRef.current = null;
    cancelChartZoomRaf(chartZoomRafRefs);
  }, [rawVizDataKey, selectionOverlay.hide, timeMeasureOverlay.hide, chartZoomRafRefs]);

  useEffect(() => {
    setHoverTimeKey(null);
  }, [rawVizDataKey]);

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height;
      if (height > 0) setChartViewportHeight(height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartFullscreen, chartData.length]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setChartFullscreen(document.fullscreenElement === chartCardRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleChartFullscreen = useCallback(async () => {
    const el = chartCardRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const configSummary = useMemo(() => {
    const boardName = boards.find(b => b.id === selectedBoard)?.name ?? 'Board not selected';
    const protoName = protocols.find(p => p.id === selectedProto)?.name;
    const visibleCount = items.filter(i => i.visible).length;
    return [boardName, protoName, `${visibleCount}/${items.length} items visible`].filter(Boolean).join(' · ');
  }, [boards, protocols, selectedBoard, selectedProto, items]);

  const applyChartZoomWindow = useCallback((start: number, end: number) => {
    if (chartData.length === 0) {
      syncChartZoomRef(chartZoomRef, null);
      setChartZoom(null);
      return;
    }
    const clamped = clampChartZoom(start, end, chartData.length);
    const span = clamped.end - clamped.start + 1;
    if (span >= chartData.length) {
      syncChartZoomRef(chartZoomRef, null);
      setChartZoom(null);
      return;
    }
    syncChartZoomRef(chartZoomRef, clamped);
    setChartZoom(clamped);
  }, [chartData.length]);

  const resetChartZoom = useCallback(() => {
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    setIsChartSelecting(false);
    selectionOverlay.hide();
    setIsChartPanning(false);
    isChartSelectingRef.current = false;
    panSessionRef.current = null;
    activeChartPointerRef.current = null;
  }, [selectionOverlay.hide]);

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
    const left = refAreaLeftRef.current;
    const right = refAreaRightRef.current;
    isChartSelectingRef.current = false;
    setIsChartSelecting(false);
    selectionOverlay.hide();
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    if (left == null || right == null) return;

    const renderLeft = Math.min(left, right);
    const renderRight = Math.max(left, right);
    if (renderRight - renderLeft + 1 < MIN_CHART_ZOOM_POINTS) return;

    const viewStart = chartZoom?.start ?? 0;
    const { start, end } = chartZoom
      ? clampChartZoom(chartZoom.start, chartZoom.end, chartData.length)
      : { start: 0, end: chartData.length - 1 };
    const windowData = chartData.slice(start, end + 1);
    const seriesIds = itemsRef.current
      .filter(i => i.visible)
      .slice(0, MAX_CHART_SERIES)
      .map(i => i.id);
    const { points: renderPoints } = decimateChartPoints(
      windowData,
      CHART_RENDER_MAX,
      seriesIds,
    );
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
  }, [applyChartZoomWindow, chartData, chartZoom, selectionOverlay.hide]);

  const finalizeChartSelectionRef = useRef(finalizeChartSelection);
  finalizeChartSelectionRef.current = finalizeChartSelection;

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const getRenderIndexFromClientX = (clientX: number): number => {
      const rect = el.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / width));
      const len = renderChartDataLengthRef.current;
      if (len <= 1) return 0;
      return Math.round(ratio * (len - 1));
    };

    const getTimeMsFromClientX = (clientX: number): number | null => {
      const rect = el.getBoundingClientRect();
      return getChartTimeMsFromClientX(
        clientX,
        rect.left,
        rect.width,
        renderChartPointsRef.current,
      );
    };

    const isZoomedIn = (): boolean => {
      const len = chartDataLengthRef.current;
      if (len === 0) return false;
      const zoom = chartZoomRef.current;
      if (!zoom) return false;
      return zoom.end - zoom.start + 1 < len;
    };

    const applyPanDelta = (deltaX: number) => {
      const session = panSessionRef.current;
      if (!session) return;
      const len = chartDataLengthRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || len === 0) return;

      const shift = Math.round(-(deltaX / rect.width) * session.span);
      let newStart = session.zoomStart + shift;
      let newEnd = session.zoomEnd + shift;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd >= len) {
        newStart -= newEnd - len + 1;
        newEnd = len - 1;
      }
      newStart = Math.max(0, newStart);
      newEnd = Math.min(len - 1, newEnd);
      if (newEnd - newStart + 1 >= len) {
        commitChartZoomRef.current(null);
      } else {
        commitChartZoomRef.current({ start: newStart, end: newEnd });
      }
    };

    const releasePointerCaptureSafe = (pointerId: number) => {
      if (el.hasPointerCapture(pointerId)) {
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // ignore — capture may already be released
        }
      }
    };

    const endPointerSession = (pointerId: number) => {
      if (activeChartPointerRef.current !== pointerId) return;

      const wasPanning = panSessionRef.current?.pointerId === pointerId;
      const wasSelecting = isChartSelectingRef.current;
      const wasMeasuring = measureSessionRef.current?.pointerId === pointerId;

      activeChartPointerRef.current = null;
      releasePointerCaptureSafe(pointerId);

      if (wasPanning) {
        panSessionRef.current = null;
        setIsChartPanning(false);
      }
      if (wasMeasuring) {
        measureSessionRef.current = null;
        isChartMeasuringRef.current = false;
        setIsChartMeasuring(false);
        timeMeasureOverlay.hide();
      }
      if (wasSelecting) {
        finalizeChartSelectionRef.current();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (liveModeRef.current || e.button !== 0) return;
      if (activeChartPointerRef.current != null) {
        endPointerSession(activeChartPointerRef.current);
      }

      if (e.shiftKey) {
        if (chartDataLengthRef.current === 0 || renderChartDataLengthRef.current === 0) return;
        const rect = el.getBoundingClientRect();
        const overlayX = e.clientX - rect.left;
        const idx = getRenderIndexFromClientX(e.clientX);
        refAreaLeftRef.current = idx;
        refAreaRightRef.current = idx;
        isChartSelectingRef.current = true;
        selectionOverlay.start(overlayX);
        setIsChartSelecting(true);
        activeChartPointerRef.current = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          activeChartPointerRef.current = null;
          isChartSelectingRef.current = false;
          setIsChartSelecting(false);
          selectionOverlay.hide();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.altKey) {
        if (renderChartDataLengthRef.current === 0) return;
        const startTimeMs = getTimeMsFromClientX(e.clientX);
        if (startTimeMs == null) return;
        const rect = el.getBoundingClientRect();
        const overlayX = e.clientX - rect.left;
        measureSessionRef.current = { pointerId: e.pointerId, startTimeMs };
        isChartMeasuringRef.current = true;
        isChartSelectingRef.current = false;
        panSessionRef.current = null;
        setIsChartMeasuring(true);
        setIsChartSelecting(false);
        setIsChartPanning(false);
        selectionOverlay.hide();
        timeMeasureOverlay.start(overlayX);
        activeChartPointerRef.current = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          activeChartPointerRef.current = null;
          measureSessionRef.current = null;
          isChartMeasuringRef.current = false;
          setIsChartMeasuring(false);
          timeMeasureOverlay.hide();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isZoomedIn()) {
        const zoom = chartZoomRef.current!;
        panSessionRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          zoomStart: zoom.start,
          zoomEnd: zoom.end,
          span: zoom.end - zoom.start + 1,
        };
        isChartSelectingRef.current = false;
        refAreaLeftRef.current = null;
        refAreaRightRef.current = null;
        setIsChartPanning(true);
        setIsChartSelecting(false);
        selectionOverlay.hide();
        activeChartPointerRef.current = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          activeChartPointerRef.current = null;
          panSessionRef.current = null;
          setIsChartPanning(false);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activeChartPointerRef.current !== e.pointerId) return;

      // pointerup missed — primary button no longer held
      if (e.buttons === 0) {
        endPointerSession(e.pointerId);
        return;
      }

      if (panSessionRef.current?.pointerId === e.pointerId) {
        applyPanDelta(e.clientX - panSessionRef.current.startX);
        e.preventDefault();
        return;
      }
      if (measureSessionRef.current?.pointerId === e.pointerId) {
        const endTimeMs = getTimeMsFromClientX(e.clientX);
        if (endTimeMs != null) {
          const durationMs = Math.abs(endTimeMs - measureSessionRef.current.startTimeMs);
          const rect = el.getBoundingClientRect();
          timeMeasureOverlay.move(
            e.clientX - rect.left,
            formatTimeInterval(durationMs),
          );
        }
        e.preventDefault();
        return;
      }
      if (!isChartSelectingRef.current) return;

      const rect = el.getBoundingClientRect();
      const overlayX = e.clientX - rect.left;
      const idx = getRenderIndexFromClientX(e.clientX);
      refAreaRightRef.current = idx;
      selectionOverlay.move(overlayX);
      e.preventDefault();
    };

    const onPointerUp = (e: PointerEvent) => {
      endPointerSession(e.pointerId);
    };

    const onWindowPointerEnd = (e: PointerEvent) => {
      endPointerSession(e.pointerId);
    };

    const onWindowBlur = () => {
      const pointerId = activeChartPointerRef.current;
      if (pointerId == null) return;
      endPointerSession(pointerId);
    };

    const onLostPointerCapture = (e: PointerEvent) => {
      if (activeChartPointerRef.current !== e.pointerId) return;
      activeChartPointerRef.current = null;
      if (panSessionRef.current?.pointerId === e.pointerId) {
        panSessionRef.current = null;
        setIsChartPanning(false);
      }
      if (measureSessionRef.current?.pointerId === e.pointerId) {
        measureSessionRef.current = null;
        isChartMeasuringRef.current = false;
        setIsChartMeasuring(false);
        timeMeasureOverlay.hide();
      }
      if (isChartSelectingRef.current) {
        isChartSelectingRef.current = false;
        setIsChartSelecting(false);
        selectionOverlay.hide();
        refAreaLeftRef.current = null;
        refAreaRightRef.current = null;
      }
    };

    const pointerOpts: AddEventListenerOptions = { capture: true };
    el.addEventListener('pointerdown', onPointerDown, pointerOpts);
    el.addEventListener('pointermove', onPointerMove, pointerOpts);
    el.addEventListener('pointerup', onPointerUp, pointerOpts);
    el.addEventListener('pointercancel', onPointerUp, pointerOpts);
    el.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown, pointerOpts);
      el.removeEventListener('pointermove', onPointerMove, pointerOpts);
      el.removeEventListener('pointerup', onPointerUp, pointerOpts);
      el.removeEventListener('pointercancel', onPointerUp, pointerOpts);
      el.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [rawVizDataKey, liveMode]);

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const isZoomedIn = (): boolean => {
      const len = chartDataLengthRef.current;
      if (len === 0) return false;
      const zoom = chartZoomRef.current;
      if (!zoom) return false;
      return zoom.end - zoom.start + 1 < len;
    };

    const applyWheelPan = (deltaX: number) => {
      const len = chartDataLengthRef.current;
      if (len === 0) return;
      const zoom = chartZoomRef.current;
      if (!zoom) return;
      const span = zoom.end - zoom.start + 1;
      if (span >= len) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;

      const shift = Math.round(-(deltaX / rect.width) * span);
      if (shift === 0) return;

      let newStart = zoom.start + shift;
      let newEnd = zoom.end + shift;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd >= len) {
        newStart -= newEnd - len + 1;
        newEnd = len - 1;
      }
      newStart = Math.max(0, newStart);
      newEnd = Math.min(len - 1, newEnd);
      if (newEnd - newStart + 1 >= len) {
        commitChartZoomRef.current(null);
      } else {
        commitChartZoomRef.current({ start: newStart, end: newEnd });
      }
    };

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
        commitChartZoomRef.current(null);
      } else {
        commitChartZoomRef.current(clampChartZoom(newStart, newEnd, len));
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (liveModeRef.current || chartDataLengthRef.current === 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const horizontalScroll = absX > absY || (e.shiftKey && absY > 0);

      if (horizontalScroll && isZoomedIn()) {
        const panDelta = absX > absY ? e.deltaX : e.deltaY;
        applyWheelPan(panDelta);
        return;
      }

      const focusRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      wheelEventRef.current = mergeWheelZoomEvent(wheelEventRef.current, e.deltaY, focusRatio);
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
      cancelChartZoomRaf(chartZoomRafRefs);
    };
  }, [rawVizDataKey, liveMode, chartZoomRafRefs]);

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

  const applyOverviewResult = useCallback((data: VizDataRow[], meta: VizQueryMeta | null) => {
    setRawVizData(data);
    setQueryMeta(meta);
  }, []);

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
      setCustomStart(formatDateTimeFromDate(new Date(p.time_range.start)));
      setCustomEnd(formatDateTimeFromDate(new Date(p.time_range.end)));
      setTimeRangePresetId(TIME_PRESET_ALL);
    }
    setLoading(true);
    try {
      const result = await api.viz.queryItems({
        board_id: p.board_id,
        items: itemsForDataQuery(p.items),
        time_range: p.time_range?.start && p.time_range?.end
          ? { start: p.time_range.start, end: p.time_range.end }
          : undefined,
        limit: MAX_POINTS,
      });
      applyOverviewResult(result.data, result.meta ?? null);
      if (result.data.length > 0) {
        lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      }
    } finally {
      setLoading(false);
    }
  }, [applyOverviewResult]);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
  }, [selectedBoard]);

  const buildTimeRange = useCallback((): { start: string; end: string } | undefined => {
    if (timeRangePresetId !== TIME_PRESET_ALL) {
      const end = new Date();
      const start = presetRangeStart(end, timeRangePresetId);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    if (customStart && customEnd) {
      const startDate = parseDateTime(customStart);
      const endDate = parseDateTime(customEnd);
      if (startDate && endDate) {
        return { start: startDate.toISOString(), end: endDate.toISOString() };
      }
    }
    return undefined;
  }, [timeRangePresetId, customStart, customEnd]);

  const isCustomTimeRange = isCustomTimeRangeSelection(timeRangePresetId, customStart, customEnd);

  const selectTimePreset = useCallback((id: TimePresetId) => {
    setTimeRangePresetId(id);
    setCustomStart('');
    setCustomEnd('');
  }, []);

  const clearCustomTimeRange = useCallback(() => {
    setCustomStart('');
    setCustomEnd('');
    setTimeRangePresetId(TIME_PRESET_ALL);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    setLoading(true);
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        time_range: buildTimeRange(),
        limit: MAX_POINTS,
      });
      applyOverviewResult(result.data, result.meta ?? null);
      if (result.data.length > 0) {
        lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      }
    } finally {
      setLoading(false);
    }
  }, [selectedBoard, buildTimeRange, applyOverviewResult]);

  const appendLive = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    const since = lastTimestampRef.current;
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        since: since || undefined,
        limit: MAX_POINTS,
      });
      if (!result.data.length) return;
      lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      setRawVizData(prev => {
        const existing = since ? prev : [];
        const merged = [...existing, ...result.data];
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

  useEffect(() => {
    if (itemFieldSearchOpen) {
      itemFieldSearchInputRef.current?.focus();
    }
  }, [itemFieldSearchOpen]);

  const toggleItemFieldSearch = useCallback(() => {
    setItemFieldSearchOpen(open => !open);
  }, []);

  const closeItemFieldSearch = useCallback(() => {
    setItemFieldSearchOpen(false);
  }, []);
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
      setProfileError('Select a board first.');
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileError('Enter a profile name.');
      return false;
    }
    if (items.length === 0) {
      setProfileError('No items to save.');
      return false;
    }

    const existing = profiles.find(p => p.name === trimmed);
    if (!existing && profiles.length >= MAX_PROFILES) {
      setProfileError(`You can save up to ${MAX_PROFILES} profiles per board.`);
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
      setProfileError(e instanceof Error ? e.message : 'Failed to save profile.');
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
      setProfileError(e instanceof Error ? e.message : 'Failed to delete profile.');
    }
  };

  const visibleItems = items.filter(i => i.visible);
  const filteredItems = useMemo(
    () => items.filter(item => itemMatchesFieldSearch(item, itemFieldSearch)),
    [items, itemFieldSearch],
  );
  const chartItems = visibleItems.slice(0, MAX_CHART_SERIES);
  const chartSeriesTruncated = visibleItems.length > MAX_CHART_SERIES;

  const displayChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (!chartZoom) return chartData;
    const { start, end } = clampChartZoom(chartZoom.start, chartZoom.end, chartData.length);
    return chartData.slice(start, end + 1);
  }, [chartData, chartZoom]);

  const displayRawVizData = useMemo(() => {
    if (!rawVizData.length) return [];
    if (!chartZoom) return rawVizData;
    const { start, end } = clampChartZoom(chartZoom.start, chartZoom.end, rawVizData.length);
    return rawVizData.slice(start, end + 1);
  }, [rawVizData, chartZoom]);

  const rawValuesByTimeKey = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of rawVizData) {
      map.set(row.timestamp, row.values);
    }
    return map;
  }, [rawVizData]);

  const chartRender = useMemo(
    () => decimateChartPoints(displayChartData, CHART_RENDER_MAX, chartItems.map(i => i.id)),
    [displayChartData, chartItems],
  );
  const renderChartData = chartRender.points;
  renderChartDataLengthRef.current = renderChartData.length;
  renderChartPointsRef.current = renderChartData;

  const chartZoomActive = chartZoom != null && displayChartData.length < chartData.length;

  const chartSummary = useMemo(() => {
    const parts: string[] = [];
    const pointLabel = `${renderChartData.length.toLocaleString()}${chartRender.decimated ? ` / ${chartRender.sourceCount.toLocaleString()}` : ''} points`;
    parts.push(pointLabel);
    if (queryMeta?.downsampled) {
      parts.push(`sampled ${queryMeta.returned.toLocaleString()} / ${queryMeta.total_matched.toLocaleString()}`);
    }
    if (chartSeriesTruncated) {
      parts.push(`showing ${MAX_CHART_SERIES} / ${visibleItems.length} series`);
    }
    if (chartRender.decimated) {
      parts.push('render sampled');
    }
    if (chartZoomActive) {
      parts.push('zoomed');
    }
    if (liveMode) {
      parts.push(`polling every ${POLL_INTERVAL / 1000}s`);
    }
    return parts.join(' · ');
  }, [
    renderChartData.length,
    chartRender.decimated,
    chartRender.sourceCount,
    queryMeta,
    chartSeriesTruncated,
    visibleItems.length,
    chartZoomActive,
    liveMode,
  ]);

  const tooltipItemById = useMemo(
    () => new Map(visibleItems.map(item => [item.id, item])),
    [visibleItems],
  );

  const chartItemIds = useMemo(
    () => new Set(chartItems.map(i => i.id)),
    [chartItems],
  );

  const hoverPrevTimeKey = useMemo(() => {
    if (!hoverTimeKey) return undefined;
    const idx = displayRawVizData.findIndex(r => r.timestamp === hoverTimeKey);
    if (idx <= 0) return undefined;
    return displayRawVizData[idx - 1].timestamp;
  }, [hoverTimeKey, displayRawVizData]);

  const cursorValueRows = useMemo(() => {
    const rows = buildCursorValueRows(
      items,
      hoverTimeKey ? rawValuesByTimeKey.get(hoverTimeKey) : undefined,
      hoverPrevTimeKey ? rawValuesByTimeKey.get(hoverPrevTimeKey) : undefined,
      chartItemIds,
    );
    return rows.sort((a, b) => {
      const aFav = !!a.item.favorite;
      const bFav = !!b.item.favorite;
      if (aFav !== bFav) return aFav ? -1 : 1;
      if (a.onChart !== b.onChart) return a.onChart ? -1 : 1;
      return chartLabel(a.item).localeCompare(chartLabel(b.item));
    });
  }, [items, hoverTimeKey, hoverPrevTimeKey, rawValuesByTimeKey, chartItemIds]);

  const toggleItemFavorite = useCallback((id: string) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, favorite: !i.favorite } : i)));
  }, []);

  const handleChartMouseMove = useCallback((state: { activeLabel?: string | number }) => {
    if (isChartPanning || isChartSelecting || isChartMeasuring) return;
    if (state?.activeLabel != null) {
      setHoverTimeKey(String(state.activeLabel));
    }
  }, [isChartPanning, isChartSelecting, isChartMeasuring]);

  const yAxisOptions = useMemo(() => {
    const ids = new Set(PRESET_Y_AXES.map(a => a.id));
    for (const item of items) ids.add(item.y_axis.id);
    return [...ids];
  }, [items]);

  const chartYAxes = useMemo(() => {
    if (chartItems.length === 0) return [];
    const usesRight = chartItems.some(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    const leftItems = chartItems.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
    const rightItems = chartItems.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    const axes: Array<{ id: string; orientation: 'left' | 'right'; unitLabel: string }> = [
      { id: PRIMARY_Y_AXIS_ID, orientation: 'left', unitLabel: axisUnitLabel(leftItems) },
    ];
    if (usesRight) {
      axes.push({
        id: SECONDARY_Y_AXIS_ID,
        orientation: 'right',
        unitLabel: axisUnitLabel(rightItems),
      });
    }
    return axes;
  }, [chartItems]);

  const chartYAxisDomains = useMemo(() => {
    const leftIds = chartItems
      .filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID)
      .map(i => i.id);
    const rightIds = chartItems
      .filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID)
      .map(i => i.id);
    return {
      [PRIMARY_Y_AXIS_ID]: computeYAxisDomain(chartData, leftIds),
      [SECONDARY_Y_AXIS_ID]: computeYAxisDomain(chartData, rightIds),
    } as Record<string, [number, number] | undefined>;
  }, [chartData, chartItems]);

  const resolveItemYAxisId = useCallback((item: VizItem) => (
    item.y_axis.id === SECONDARY_Y_AXIS_ID ? SECONDARY_Y_AXIS_ID : PRIMARY_Y_AXIS_ID
  ), []);

  const statistics = useMemo(() => {
    const stats: Record<string, Statistics> = {};
    for (const item of visibleItems) {
      const values = displayRawVizData
        .map(row => row.values[item.label])
        .filter((v): v is number => typeof v === 'number' && !isNaN(v))
        .map(raw => applyItemTransform(raw, item));
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
  }, [visibleItems, displayRawVizData]);

  const statsSummary = useMemo(() => {
    const seriesCount = Object.keys(statistics).length;
    if (seriesCount === 0) return '';
    const parts = [`${seriesCount} series`];
    if (displayRawVizData.length > 0) {
      parts.push(`${displayRawVizData.length.toLocaleString()} points`);
    }
    return parts.join(' · ');
  }, [statistics, displayRawVizData.length]);

  const exportCSV = () => {
    if (!displayRawVizData.length) return;
    const headers = ['timestamp', ...visibleItems.map(i => chartLabel(i))];
    const rows = displayRawVizData.map(row => [
      formatChartAxisTime(row.timestamp),
      ...visibleItems.map(i => row.values[i.label] ?? ''),
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

  return (
    <div className="page">
      <PageHeader
        title="Visualization"
        subtitle="Visualize protocol fields as charts. Use Live mode for real-time data."
      />

      <div className={`card table-card viz-config-card${configOpen ? '' : ' is-collapsed'}`}>
        <div className="card-header viz-config-header">
          <div className="viz-config-header-main">
            <h2>Configuration</h2>
            {!configOpen && (
              <>
                {liveMode && (
                  <span className="viz-time-live-badge" aria-label="Live mode active">
                    Live
                  </span>
                )}
                <span className="muted viz-config-summary">{configSummary}</span>
              </>
            )}
          </div>
          {configOpen && (
            <div className="btn-group viz-config-actions">
              <button type="button" onClick={fetchAll} className="btn-primary btn-sm" disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              {chartData.length > 0 && (
                <button type="button" className="btn-sm" onClick={exportCSV}>Export CSV</button>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm viz-config-collapse-btn"
            onClick={() => setConfigOpen(v => !v)}
            aria-expanded={configOpen}
            aria-label={configOpen ? 'Collapse configuration' : 'Expand configuration'}
            title={configOpen ? 'Collapse' : 'Expand'}
          >
            <span className={`viz-collapse-chevron${configOpen ? ' open' : ''}`} aria-hidden>›</span>
          </button>
        </div>
        {configOpen && (
        <div className="viz-config-panel">
        <div className="viz-config-row" aria-labelledby="viz-board-title">
          <div className="viz-config-row-head">
            <div id="viz-board-title" className="viz-config-row-title">Board</div>
          </div>
          <div className="viz-config-row-content viz-source-row">
            <label className="viz-source-field">
              <span className="viz-source-field-label">Board</span>
              <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
                <option value="">Select Board</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="viz-source-field">
              <span className="viz-source-field-label">Protocol</span>
              <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
                <option value="">Select Protocol</option>
                {protocols.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className={`viz-config-row viz-config-row-time${liveMode ? ' is-live' : ''}`} aria-labelledby="viz-time-range-title">
          <div className="viz-config-row-head">
            <div id="viz-time-range-title" className="viz-config-row-title">
              Time Range
            </div>
          </div>
          <div className="viz-config-row-content viz-time-toolbar">
            <div className="viz-time-toolbar-main">
              <div className="viz-time-preset-group">
                <span className="viz-time-group-label">Quick range</span>
                <div
                  className="viz-time-presets"
                  role="group"
                  aria-label="Quick range"
                >
                  {TIME_PRESETS.map(p => {
                    const isActive = p.id === TIME_PRESET_ALL
                      ? isAllTimeRangeSelection(timeRangePresetId, customStart, customEnd)
                      : timeRangePresetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`viz-time-preset${isActive ? ' is-active' : ''}`}
                        onClick={() => selectTimePreset(p.id)}
                        disabled={liveMode}
                        aria-pressed={isActive}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className={`viz-time-custom-group${isCustomTimeRange ? ' is-active' : ''}`}
                aria-label="Search by period"
              >
                <span className="viz-time-group-label">Search by period</span>
                <div className="viz-time-custom-bar">
                  <input
                    type="text"
                    className="viz-time-input mono"
                    value={customStart}
                    onChange={e => {
                      setCustomStart(e.target.value);
                      setTimeRangePresetId(TIME_PRESET_ALL);
                    }}
                    disabled={liveMode}
                    aria-label="Start time"
                    placeholder="yyyy-MM-dd HH:mm:ss"
                    spellCheck={false}
                    autoComplete="off"
                    lang="en"
                  />
                  <span className="viz-time-custom-sep" aria-hidden>→</span>
                  <input
                    type="text"
                    className="viz-time-input mono"
                    value={customEnd}
                    onChange={e => {
                      setCustomEnd(e.target.value);
                      setTimeRangePresetId(TIME_PRESET_ALL);
                    }}
                    disabled={liveMode}
                    aria-label="End time"
                    placeholder="yyyy-MM-dd HH:mm:ss"
                    spellCheck={false}
                    autoComplete="off"
                    lang="en"
                  />
                  {isCustomTimeRange && (
                    <button
                      type="button"
                      className="viz-time-custom-clear"
                      onClick={clearCustomTimeRange}
                      disabled={liveMode}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="viz-time-live-group">
                <span className="viz-time-group-label">Live mode</span>
                <div className="viz-time-live-bar">
                  <button
                    type="button"
                    className={`viz-time-live-toggle btn-live${liveMode ? ' active' : ''}`}
                    onClick={() => setLiveMode(v => !v)}
                    aria-pressed={liveMode}
                  >
                    {liveMode ? '● LIVE' : 'Live'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="viz-config-row viz-config-row-items">
          <div className="viz-items-header">
            <div className="viz-items-header-left">
              <div className="viz-config-row-title">
                Items
                <span className="tag tag-subtle">{items.length}</span>
              </div>
              <button type="button" className="btn-sm" onClick={addAllFields} disabled={!selectedProto}>
                + Add All Fields
              </button>
            </div>
            <div className="viz-items-header-right">
              {showProfileAdd ? (
                <div className="viz-profile-add-form">
                  <input
                    autoFocus
                    placeholder="Profile name"
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
                      title="Add profile"
                    >
                      +
                    </button>
                  )}
                </div>
              ) : (
                <span className="muted viz-items-header-hint">Select a board to save profiles</span>
              )}
              {profileError && (
                <span className="viz-profile-error-inline" title={profileError}>!</span>
              )}
            </div>
          </div>
          <div className="viz-config-row-content">
            <div className="viz-items-table-wrap">
              <div className="viz-items-scroll">
                <table className="viz-items-table">
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
                      title="Select or deselect all"
                      aria-label="Select or deselect all"
                    />
                  </div>
                </th>
                <th className="viz-name-col">NAME</th>
                <th className="viz-field-col-head">
                  <div className="viz-field-col-head-inner">
                    <span>Field</span>
                    <button
                      type="button"
                      className={`viz-field-search-toggle${itemFieldSearchOpen || itemFieldSearch.trim() ? ' active' : ''}`}
                      onMouseDown={e => {
                        if (itemFieldSearchOpen) e.preventDefault();
                      }}
                      onClick={toggleItemFieldSearch}
                      aria-label="Search fields"
                      aria-expanded={itemFieldSearchOpen}
                      disabled={items.length === 0}
                    >
                      <IconSearch />
                    </button>
                    {itemFieldSearchOpen && (
                      <input
                        ref={itemFieldSearchInputRef}
                        type="search"
                        className="viz-field-search-popover"
                        value={itemFieldSearch}
                        onChange={e => setItemFieldSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            closeItemFieldSearch();
                          }
                        }}
                        placeholder="Search field…"
                        aria-label="Search items by field name"
                      />
                    )}
                  </div>
                </th>
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
                    No items. Use + Add All Fields above to add fields.
                  </td>
                </tr>
              )}
              {items.length > 0 && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="viz-items-empty">
                    No fields match &quot;{itemFieldSearch.trim()}&quot;.
                  </td>
                </tr>
              )}
              {filteredItems.map(item => (
                <tr key={item.id}>
                  <td><input type="checkbox" checked={item.visible} onChange={() => toggleVisibility(item.id)} /></td>
                  <td className="viz-name-col">
                    <VizItemNameInput
                      value={item.short_label ?? ''}
                      onCommit={v => updateItem(item.id, 'short_label', v)}
                      title="Name shown on chart"
                      ariaLabel={`Chart name for ${item.label}`}
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
                      updateItem(item.id, 'y_axis', { ...item.y_axis, id: e.target.value } as YAxisConfig);
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
                  <td>
                    <VizItemNumericInput
                      value={item.offset}
                      emptyFallback={0}
                      ariaLabel={`Offset for ${item.label}`}
                      onCommit={n => updateItem(item.id, 'offset', n)}
                    />
                  </td>
                  <td>
                    <VizItemNumericInput
                      value={item.weight}
                      emptyFallback={1}
                      ariaLabel={`Weight for ${item.label}`}
                      onCommit={n => updateItem(item.id, 'weight', n)}
                    />
                  </td>
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
          </div>
        </div>
        </div>
        )}
      </div>

      <div ref={chartCardRef} className={`card table-card viz-chart-card${chartFullscreen ? ' is-fullscreen' : ''}`}>
        <div className="card-header viz-chart-header">
          <div className="viz-chart-header-main">
            <h2>Chart</h2>
            <p className="viz-chart-summary">{chartSummary}</p>
          </div>
          <div className="viz-chart-toolbar">
            <div className="viz-chart-toolbar-group" role="group" aria-label="Chart view">
              <button
                type="button"
                className={`viz-chart-icon-btn viz-chart-fullscreen-toggle${chartFullscreen ? ' active' : ''}`}
                onClick={() => void toggleChartFullscreen()}
                title={chartFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                aria-label={chartFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                aria-pressed={chartFullscreen}
              >
                {chartFullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={() => zoomChartByFactor(0.8)}
                disabled={liveMode || displayChartData.length === 0}
                title="Zoom in horizontally"
                aria-label="Zoom in horizontally"
              >
                <IconZoomIn />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={() => zoomChartByFactor(1.25)}
                disabled={liveMode || !chartZoomActive}
                title="Zoom out horizontally"
                aria-label="Zoom out horizontally"
              >
                <IconZoomOut />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={resetChartZoom}
                disabled={liveMode || !chartZoomActive}
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <IconZoomReset />
              </button>
            </div>
            <div className="viz-chart-toolbar-sep" aria-hidden />
            <div className="viz-chart-toolbar-group" role="group" aria-label="Tooltip">
              <button
                type="button"
                className={`viz-chart-icon-btn viz-chart-tooltip-toggle${chartTooltipEnabled ? ' active' : ''}`}
                onClick={() => setChartTooltipEnabled(v => !v)}
                title="Show value popup on hover"
                aria-label="Show value popup on hover"
                aria-pressed={chartTooltipEnabled}
              >
                <IconTooltip />
              </button>
            </div>
          </div>
        </div>
        <div className="viz-chart-panel">
        {!liveMode && displayChartData.length > 0 && (
          <p className="viz-chart-zoom-hint muted">
            Shift+drag: zoom region · Alt+drag: measure time · Drag: pan (zoomed) · Bottom bar: pan · Wheel: zoom · Double-click: reset
          </p>
        )}
        <div
          ref={chartViewportRef}
          className={`viz-chart-viewport${isChartSelecting ? ' selecting' : ''}${isChartPanning ? ' panning' : ''}${isChartMeasuring ? ' measuring' : ''}${chartZoomActive ? ' zoomed' : ''}${liveMode ? ' live' : ''}`}
          tabIndex={-1}
          onDoubleClick={liveMode ? undefined : resetChartZoom}
        >
          {selectionOverlay.overlayNode}
          {timeMeasureOverlay.overlayNode}
          <ResponsiveContainer width="100%" height={chartViewportHeight}>
            <ComposedChart
              key={`${rawVizDataKey}:${itemTransformKey}`}
              data={renderChartData}
              margin={{ top: 8, right: 0, left: 0, bottom: 4 }}
              onMouseMove={handleChartMouseMove}
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
                  key={`${y.id}-${y.unitLabel}`}
                  yAxisId={y.id}
                  orientation={y.orientation}
                  width={y.unitLabel ? 44 : 30}
                  domain={chartYAxisDomains[y.id]}
                  allowDataOverflow
                  tickFormatter={formatYAxisTick}
                  tick={{ fontSize: 9, fill: '#888aa0' }}
                  stroke="#888aa0"
                  tickLine={false}
                  axisLine={false}
                  label={y.unitLabel ? {
                    value: y.unitLabel,
                    angle: y.orientation === 'left' ? -90 : 90,
                    position: y.orientation === 'left' ? 'insideLeft' : 'insideRight',
                    offset: 0,
                    style: { fill: '#888aa0', fontSize: 10, textAnchor: 'middle' },
                  } : undefined}
                />
              ))}
              {chartTooltipEnabled && !shouldHideTooltipDuringInteraction(isChartPanning, isChartSelecting, isChartMeasuring) && (
                <Tooltip
                  key={itemTransformKey}
                  isAnimationActive={CHART_ANIMATION}
                  content={(props) => (
                    <VizChartTooltip
                      active={props.active}
                      label={props.label}
                      payload={props.payload as VizChartTooltipProps['payload']}
                      itemById={tooltipItemById}
                      rawValuesAtTime={
                        props.label != null
                          ? rawValuesByTimeKey.get(String(props.label))
                          : undefined
                      }
                    />
                  )}
                />
              )}
              {chartItems.map(item => renderChartShape(item))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {chartZoom != null && !liveMode && (
          <ChartZoomNavigator
            chartData={chartData}
            chartZoom={chartZoom}
            sparkItemId={chartItems[0]?.id}
            formatTime={formatChartAxisTime}
            onWindowChange={applyChartZoomWindow}
            totalMatched={queryMeta?.total_matched}
            returned={queryMeta?.returned ?? chartData.length}
            downsampled={queryMeta?.downsampled}
          />
        )}
        {items.length > 0 && renderChartData.length > 0 && (
          <ChartCursorValues
            timeKey={hoverTimeKey}
            formatTime={formatChartAxisTime}
            rows={cursorValueRows}
            onToggleFavorite={toggleItemFavorite}
          />
        )}
        {chartItems.length > 0 && (
          <div className="viz-chart-legend" aria-label="Chart series">
            {chartItems.map(item => (
              <span key={item.id} className="viz-chart-legend-item" title={item.label}>
                <span className="viz-chart-legend-swatch" style={{ backgroundColor: item.color }} />
                <span className="viz-chart-legend-label">
                  {chartLabel(item)}
                  {item.y_axis.unit?.trim() ? ` (${item.y_axis.unit.trim()})` : ''}
                </span>
              </span>
            ))}
          </div>
        )}
        </div>
      </div>

      {Object.keys(statistics).length > 0 && (
        <div className={`card table-card viz-stats-card${statsOpen ? '' : ' is-collapsed'}`}>
          <div className="card-header viz-stats-header">
            <div className="viz-stats-header-main">
              <h2>Statistics</h2>
              {!statsOpen && statsSummary && (
                <span className="muted viz-config-summary">{statsSummary}</span>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm viz-config-collapse-btn"
              onClick={() => setStatsOpen(v => !v)}
              aria-expanded={statsOpen}
              aria-label={statsOpen ? 'Collapse statistics' : 'Expand statistics'}
              title={statsOpen ? 'Collapse' : 'Expand'}
            >
              <span className={`viz-collapse-chevron${statsOpen ? ' open' : ''}`} aria-hidden>›</span>
            </button>
          </div>
          {statsOpen && (
          <div className="viz-stats-panel">
          <div className="viz-stats-scroll">
            <table>
              <thead>
                <tr>
                  <th>NAME</th>
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
                  const unit = item.y_axis.unit?.trim();
                  const fmt = (v: number) => formatDisplayValue(v, unit);
                  return (
                    <tr key={item.label}>
                      <td title={item.label}>{chartLabel(item)}</td>
                      <td>{fmt(s.min)}</td>
                      <td>{fmt(s.max)}</td>
                      <td>{fmt(s.avg)}</td>
                      <td>{typeof s.last === 'number' ? fmt(s.last) : s.last}</td>
                      <td>{s.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
          )}
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
