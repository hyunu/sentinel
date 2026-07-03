import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';
import ChartZoomNavigator from '../components/ChartZoomNavigator';
import ChartHelpManual from '../components/ChartHelpManual';
import ChartSeriesGroup from '../components/ChartSeriesGroup';
import { buildCursorValueRows } from '../components/ChartCursorValues';
import VizCanvasChart, { type VizCanvasChartHandle } from '../components/VizCanvasChart';
import PageHeader from '../components/PageHeader';
import {
  IconFullscreen,
  IconFullscreenExit,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconSearch,
  IconManual,
  IconTooltip,
  IconFieldValues,
} from '../components/ChartControlIcons';
import { formatDateTimeFromDate, formatChartAxisTime, formatTimeInterval, parseDateTime } from '../utils/date';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';
import {
  cancelChartZoomRaf,
  chartZoomEquals,
  computePanWindow,
  computeWheelZoomWindow,
  createChartZoomCommitter,
  getChartTimeMsFromClientX,
  findChartIndexLowerBoundForTimeMs,
  findChartIndexUpperBoundForTimeMs,
  getChartPlotBoundsFromViewport,
  getChartPlotMetricsFromViewport,
  mergeWheelZoomEvent,
  normalizeWheelDeltaY,
  syncChartZoomRef,
  wheelDeltaToZoomFactor,
  wheelFocusRatioFromClientX,
  useChartSelectionOverlay,
  useChartTimeMeasureOverlay,
  type ChartZoomRange,
  type WheelZoomEvent,
} from '../lib/vizChartInteraction';
import { buildDetailCacheKey, VizDetailCache } from '../lib/vizDetailCache';
import {
  assessAllTimeRangeLoad,
  estimateVizPayloadBytes,
  formatFullLoadBytes,
  FULL_LOAD_BYTE_BUDGET,
  FULL_LOAD_MAX_POINTS,
  shouldFullLoadInMemory,
  type AllRangeLoadAssessment,
} from '../lib/vizFullLoad';
import { useTranslation, type TFunction } from '../i18n';

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
const CHART_TYPES = ['line', 'bar', 'area'] as const;
const MAX_POINTS = 8000;
const MAX_CHART_SERIES = 24;
const MAX_PROFILES = 5;
const POLL_INTERVAL = 3000;
const MIN_CHART_ZOOM_POINTS = 10;

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

const TIME_PRESET_IDS: TimePresetId[] = ['1d', '3d', '7d', '15d', '30d', '3m', '6m', '1y', 'all'];

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

function buildAllRangeGuideCopy(guide: AllRangeLoadAssessment, t: TFunction): {
  title: string;
  summary: string;
  why: string;
  recommend: string;
} {
  const total = guide.totalMatched.toLocaleString();
  const sample = guide.returned.toLocaleString();
  const limitPoints = FULL_LOAD_MAX_POINTS.toLocaleString();
  const limitBytes = formatFullLoadBytes(FULL_LOAD_BYTE_BUDGET);

  if (guide.heavyReason === 'points') {
    return {
      title: t('viz.guide.pointsTitle'),
      summary: t('viz.guide.pointsSummary', { total, sample, limitPoints }),
      why: t('viz.guide.pointsWhy'),
      recommend: t('viz.guide.pointsRecommend'),
    };
  }

  const est = formatFullLoadBytes(guide.estimatedBytes ?? 0);
  return {
    title: t('viz.guide.bytesTitle'),
    summary: t('viz.guide.bytesSummary', { total, est, limitBytes, sample }),
    why: t('viz.guide.bytesWhy'),
    recommend: t('viz.guide.bytesRecommend'),
  };
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

type VizQueryParams = {
  board_id: string;
  items: VizItem[];
  time_range?: { start: string; end: string };
  since?: string;
};

async function queryVizDataset(
  params: VizQueryParams,
  options?: { assessAllRange?: boolean },
): Promise<{
  data: VizDataRow[];
  meta: VizQueryMeta | null;
  inMemoryFull: boolean;
  allRangeAssessment: AllRangeLoadAssessment | null;
}> {
  const overview = await api.viz.queryItems({ ...params, limit: MAX_POINTS });
  const meta = overview.meta ?? null;
  const allRangeAssessment = options?.assessAllRange
    ? assessAllTimeRangeLoad(meta, overview.data)
    : null;

  if (!shouldFullLoadInMemory(meta, overview.data)) {
    return {
      data: overview.data,
      meta,
      inMemoryFull: !!meta && !meta.downsampled,
      allRangeAssessment,
    };
  }
  const full = await api.viz.queryItems({
    ...params,
    limit: meta!.total_matched,
  });
  return {
    data: full.data,
    meta: full.meta ?? null,
    inMemoryFull: true,
    allRangeAssessment,
  };
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
  const { t } = useTranslation();
  const timePresets = useMemo(
    () => TIME_PRESET_IDS.map(id => ({
      id,
      label: id === TIME_PRESET_ALL ? t('viz.time.all') : id,
    })),
    [t],
  );
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
  const refAreaLeftClientXRef = useRef<number | null>(null);
  const refAreaRightClientXRef = useRef<number | null>(null);
  const chartPlotBoundsRef = useRef({ left: 0, width: 0 });
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
  const [seriesValuesOpen, setSeriesValuesOpen] = useState(true);
  const [hoverTimeKey, setHoverTimeKey] = useState<string | null>(null);
  const [queryMeta, setQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailRawVizData, setDetailRawVizData] = useState<VizDataRow[] | null>(null);
  const [detailQueryMeta, setDetailQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inMemoryFull, setInMemoryFull] = useState(false);
  const [allRangeGuide, setAllRangeGuide] = useState<AllRangeLoadAssessment | null>(null);
  const detailFetchSeqRef = useRef(0);
  const detailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCacheRef = useRef(new VizDetailCache());
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
  const [chartManualOpen, setChartManualOpen] = useState(false);
  const [chartViewportHeight, setChartViewportHeight] = useState(600);
  const lastTimestampRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const chartCanvasRef = useRef<VizCanvasChartHandle | null>(null);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const chartZoomRef = useRef<ChartZoomRange | null>(null);
  chartZoomRef.current = chartZoom;
  const chartDataLengthRef = useRef(0);
  chartDataLengthRef.current = chartData.length;
  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;
  const wheelRafRef = useRef<number | null>(null);
  const wheelEventRef = useRef<WheelZoomEvent | null>(null);
  const panRafRef = useRef<number | null>(null);
  const pendingPanDeltaRef = useRef(0);
  const reactChartZoomRef = useRef(chartZoom);
  reactChartZoomRef.current = chartZoom;
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
  const inMemoryFullRef = useRef(inMemoryFull);
  inMemoryFullRef.current = inMemoryFull;

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

  const syncReactChartZoomFromRef = useCallback(() => {
    const next = chartZoomRef.current;
    if (chartZoomEquals(next, reactChartZoomRef.current)) return;
    setChartZoom(next);
  }, []);

  const applyCanvasZoomWindow = useCallback((start: number, end: number) => {
    const len = chartDataLengthRef.current;
    if (len === 0) return;
    const next = clampChartZoom(start, end, len);
    chartZoomRef.current = next;
    chartCanvasRef.current?.setWindowByIndex(next.start, next.end);
    syncReactChartZoomFromRef();
  }, [syncReactChartZoomFromRef]);

  const syncReactChartZoomFromRefFn = useRef(syncReactChartZoomFromRef);
  syncReactChartZoomFromRefFn.current = syncReactChartZoomFromRef;

  const applyCanvasZoomWindowRef = useRef(applyCanvasZoomWindow);
  applyCanvasZoomWindowRef.current = applyCanvasZoomWindow;

  useEffect(() => {
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    refAreaLeftClientXRef.current = null;
    refAreaRightClientXRef.current = null;
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
      chartCanvasRef.current?.resetWindow();
      return;
    }
    const clamped = clampChartZoom(start, end, chartData.length);
    const span = clamped.end - clamped.start + 1;
    if (span >= chartData.length) {
      syncChartZoomRef(chartZoomRef, null);
      setChartZoom(null);
      chartCanvasRef.current?.resetWindow();
      return;
    }
    syncChartZoomRef(chartZoomRef, clamped);
    setChartZoom(clamped);
    chartCanvasRef.current?.setWindowByIndex(clamped.start, clamped.end);
  }, [chartData.length]);

  const resetChartZoom = useCallback(() => {
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    chartCanvasRef.current?.resetWindow();
    setDetailRawVizData(null);
    setDetailQueryMeta(null);
    setDetailLoading(false);
    detailFetchSeqRef.current += 1;
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    refAreaLeftClientXRef.current = null;
    refAreaRightClientXRef.current = null;
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
    const leftClientX = refAreaLeftClientXRef.current;
    const rightClientX = refAreaRightClientXRef.current;
    isChartSelectingRef.current = false;
    setIsChartSelecting(false);
    selectionOverlay.hide();
    refAreaLeftRef.current = null;
    refAreaRightRef.current = null;
    refAreaLeftClientXRef.current = null;
    refAreaRightClientXRef.current = null;
    if (leftClientX == null || rightClientX == null) return;

    const renderPoints = renderChartPointsRef.current;
    const data = chartDataRef.current;
    if (renderPoints.length === 0 || data.length === 0) return;

    const el = chartViewportRef.current;
    if (!el) return;
    const { plotLeft, plotWidth } = getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current);

    const minX = Math.min(leftClientX, rightClientX);
    const maxX = Math.max(leftClientX, rightClientX);
    const startMs = getChartTimeMsFromClientX(minX, plotLeft, plotWidth, renderPoints);
    const endMs = getChartTimeMsFromClientX(maxX, plotLeft, plotWidth, renderPoints);
    if (startMs == null || endMs == null) return;

    const loMs = Math.min(startMs, endMs);
    const hiMs = Math.max(startMs, endMs);
    const startIdx = findChartIndexLowerBoundForTimeMs(data, loMs);
    const endIdx = findChartIndexUpperBoundForTimeMs(data, hiMs);
    if (endIdx - startIdx + 1 < MIN_CHART_ZOOM_POINTS) return;

    applyChartZoomWindow(startIdx, endIdx);
  }, [applyChartZoomWindow, selectionOverlay.hide]);

  const finalizeChartSelectionRef = useRef(finalizeChartSelection);
  finalizeChartSelectionRef.current = finalizeChartSelection;

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const getPlotMetrics = () => {
      const canvasMetrics = chartCanvasRef.current?.getPlotClientMetrics();
      if (canvasMetrics) {
        return { plotLeft: canvasMetrics.plotLeft, plotWidth: canvasMetrics.plotWidth };
      }
      return getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current);
    };

    const getRenderIndexFromClientX = (clientX: number): number => {
      const { plotLeft, plotWidth } = getPlotMetrics();
      const ratio = Math.max(0, Math.min(1, (clientX - plotLeft) / plotWidth));
      const len = renderChartDataLengthRef.current;
      if (len <= 1) return 0;
      return Math.round(ratio * (len - 1));
    };

    const getTimeMsFromClientX = (clientX: number): number | null => {
      const { plotLeft, plotWidth } = getPlotMetrics();
      return getChartTimeMsFromClientX(
        clientX,
        plotLeft,
        plotWidth,
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

    const schedulePanDelta = (deltaX: number) => {
      pendingPanDeltaRef.current = deltaX;
      if (panRafRef.current != null) return;
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        applyPanDelta(pendingPanDeltaRef.current);
      });
    };

    const applyPanDelta = (deltaX: number) => {
      const session = panSessionRef.current;
      if (!session) return;
      const len = chartDataLengthRef.current;
      const data = chartDataRef.current;
      const { plotWidth } = getPlotMetrics();
      if (plotWidth <= 0 || len === 0 || data.length === 0) return;

      const { start: newStart, end: newEnd } = computePanWindow(
        data,
        session.zoomStart,
        session.zoomEnd,
        deltaX,
        plotWidth,
        len,
      );
      if (newEnd - newStart + 1 >= len) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
      } else if (inMemoryFullRef.current) {
        applyCanvasZoomWindowRef.current(newStart, newEnd);
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
        refAreaLeftClientXRef.current = e.clientX;
        refAreaRightClientXRef.current = e.clientX;
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
        schedulePanDelta(e.clientX - panSessionRef.current.startX);
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
      refAreaRightClientXRef.current = e.clientX;
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
      if (panRafRef.current != null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
    };
  }, [rawVizDataKey, liveMode, syncReactChartZoomFromRef]);

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

    const getWheelPlotWidth = () => {
      const canvasMetrics = chartCanvasRef.current?.getPlotClientMetrics();
      if (canvasMetrics) return canvasMetrics.plotWidth;
      return getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotWidth;
    };

    const applyWheelPan = (deltaX: number) => {
      const len = chartDataLengthRef.current;
      const data = chartDataRef.current;
      if (len === 0 || data.length === 0) return;
      const zoom = chartZoomRef.current;
      if (!zoom) return;
      if (zoom.end - zoom.start + 1 >= len) return;

      const plotWidth = getWheelPlotWidth();
      if (plotWidth <= 0) return;

      const { start: newStart, end: newEnd } = computePanWindow(
        data,
        zoom.start,
        zoom.end,
        deltaX,
        plotWidth,
        len,
      );
      if (newEnd - newStart + 1 >= len) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
      } else if (inMemoryFullRef.current) {
        applyCanvasZoomWindowRef.current(newStart, newEnd);
      } else {
        commitChartZoomRef.current({ start: newStart, end: newEnd });
      }
    };

    const applyWheelZoom = (deltaY: number, focusRatio: number, focusMs: number | null) => {
      if (liveModeRef.current) return;
      const len = chartDataLengthRef.current;
      if (len === 0) return;
      const factor = wheelDeltaToZoomFactor(deltaY);
      if (factor == null) return;

      const zoom = chartZoomRef.current;
      const currentStart = zoom?.start ?? 0;
      const currentEnd = zoom?.end ?? len - 1;
      const span = currentEnd - currentStart + 1;
      const newSpan = Math.max(
        MIN_CHART_ZOOM_POINTS,
        Math.min(len, Math.round(span * factor)),
      );
      if (newSpan === span) return;

      const data = chartDataRef.current;
      let newStart = 0;
      let newEnd = len - 1;
      if (data.length > 0) {
        ({ start: newStart, end: newEnd } = computeWheelZoomWindow(
          data,
          currentStart,
          currentEnd,
          focusRatio,
          newSpan,
          len,
          focusMs,
        ));
      }

      if (newStart === 0 && newEnd >= len - 1) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
        return;
      }

      if (inMemoryFullRef.current) {
        applyCanvasZoomWindowRef.current(newStart, newEnd);
      } else {
        commitChartZoomRef.current(clampChartZoom(newStart, newEnd, len));
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (liveModeRef.current || chartDataLengthRef.current === 0) return;
      e.preventDefault();

      const focusMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(e.clientX) ?? null;
      const canvasMetrics = chartCanvasRef.current?.getPlotClientMetrics();
      const plotLeft = canvasMetrics?.plotLeft
        ?? getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotLeft;
      const plotWidth = canvasMetrics?.plotWidth
        ?? getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotWidth;
      if (plotWidth <= 0) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const horizontalScroll = absX > absY || (e.shiftKey && absY > 0);

      if (horizontalScroll && isZoomedIn()) {
        const panDelta = absX > absY ? e.deltaX : e.deltaY;
        applyWheelPan(panDelta);
        return;
      }

      const focusRatio = wheelFocusRatioFromClientX(e.clientX, plotLeft, plotWidth);
      wheelEventRef.current = mergeWheelZoomEvent(
        wheelEventRef.current,
        normalizeWheelDeltaY(e),
        { focusRatio, focusMs },
      );
      if (!wheelEventRef.current) return;
      if (wheelRafRef.current != null) return;
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const ev = wheelEventRef.current;
        wheelEventRef.current = null;
        if (!ev) return;
        applyWheelZoom(ev.deltaY, ev.focusRatio, ev.focusMs);
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      if (panRafRef.current != null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
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

  const applyOverviewResult = useCallback((
    data: VizDataRow[],
    meta: VizQueryMeta | null,
    memoryFull = false,
  ) => {
    setRawVizData(data);
    setQueryMeta(meta);
    setInMemoryFull(memoryFull);
    setDetailRawVizData(null);
    setDetailQueryMeta(null);
    setDetailLoading(false);
    detailFetchSeqRef.current += 1;
    detailCacheRef.current.clear();
  }, []);

  const applyQueryResult = useCallback((
    result: Awaited<ReturnType<typeof queryVizDataset>>,
    assessAllRange: boolean,
  ) => {
    applyOverviewResult(result.data, result.meta, result.inMemoryFull);
    if (assessAllRange && result.allRangeAssessment?.level === 'heavy') {
      setAllRangeGuide(result.allRangeAssessment);
    } else {
      setAllRangeGuide(null);
    }
    if (result.data.length > 0) {
      lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
    }
  }, [applyOverviewResult]);

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
      const isAllRange = !p.time_range?.start || !p.time_range?.end;
      const result = await queryVizDataset({
        board_id: p.board_id,
        items: itemsForDataQuery(p.items),
        time_range: p.time_range?.start && p.time_range?.end
          ? { start: p.time_range.start, end: p.time_range.end }
          : undefined,
      }, { assessAllRange: isAllRange });
      applyQueryResult(result, isAllRange);
    } finally {
      setLoading(false);
    }
  }, [applyQueryResult]);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
    setAllRangeGuide(null);
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
    if (id !== TIME_PRESET_ALL) {
      setAllRangeGuide(null);
    }
  }, []);

  const runVizQuery = useCallback(async (
    timeRange: { start: string; end: string } | undefined,
    assessAllRange: boolean,
  ) => {
    if (!selectedBoard || !itemsRef.current.length) return;
    setLoading(true);
    try {
      const result = await queryVizDataset({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        time_range: timeRange,
      }, { assessAllRange });
      applyQueryResult(result, assessAllRange);
    } finally {
      setLoading(false);
    }
  }, [selectedBoard, applyQueryResult]);

  const fetchAll = useCallback(async () => {
    const isAllRange = isAllTimeRangeSelection(timeRangePresetId, customStart, customEnd);
    await runVizQuery(buildTimeRange(), isAllRange);
  }, [runVizQuery, buildTimeRange, timeRangePresetId, customStart, customEnd]);

  const applyGuideTimePreset = useCallback(async (id: TimePresetId) => {
    selectTimePreset(id);
    if (id === TIME_PRESET_ALL) {
      await runVizQuery(undefined, true);
      return;
    }
    const end = new Date();
    const start = presetRangeStart(end, id);
    await runVizQuery({ start: start.toISOString(), end: end.toISOString() }, false);
  }, [selectTimePreset, runVizQuery]);

  const dismissAllRangeGuide = useCallback(() => {
    setAllRangeGuide(null);
  }, []);

  const clearCustomTimeRange = useCallback(() => {
    setCustomStart('');
    setCustomEnd('');
    setTimeRangePresetId(TIME_PRESET_ALL);
  }, []);

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

  const visibleItems = useMemo(
    () => items.filter(i => i.visible),
    [items],
  );
  const filteredItems = useMemo(
    () => items.filter(item => itemMatchesFieldSearch(item, itemFieldSearch)),
    [items, itemFieldSearch],
  );
  const chartItems = useMemo(() => items, [items]);
  const activeChartItems = useMemo(
    () => items.filter(i => i.visible).slice(0, MAX_CHART_SERIES),
    [items],
  );
  const chartSeriesTruncated = visibleItems.length > MAX_CHART_SERIES;

  const zoomWindow = useMemo(() => {
    if (!chartZoom || chartData.length === 0) return null;
    const { start, end } = clampChartZoom(chartZoom.start, chartZoom.end, chartData.length);
    const startTs = chartData[start]?.timeKey;
    const endTs = chartData[end]?.timeKey;
    if (!startTs || !endTs) return null;
    if (end - start + 1 >= chartData.length) return null;
    return { start, end, startTs, endTs, indexKey: `${start}:${end}` };
  }, [chartZoom, chartData]);

  const detailChartData = useMemo(
    () => (detailRawVizData ? toChartPoints(detailRawVizData, items) : null),
    [detailRawVizData, items, itemTransformKey],
  );

  useEffect(() => {
    if (detailDebounceRef.current) {
      clearTimeout(detailDebounceRef.current);
      detailDebounceRef.current = null;
    }

    if (liveMode || !selectedBoard || !zoomWindow || inMemoryFull) {
      setDetailRawVizData(null);
      setDetailQueryMeta(null);
      setDetailLoading(false);
      return;
    }

    const { startTs, endTs, indexKey } = zoomWindow;
    const cacheKey = buildDetailCacheKey(selectedBoard, startTs, endTs, itemTransformKey);
    const cached = detailCacheRef.current.get(cacheKey);

    const applyDetail = (
      data: VizDataRow[],
      meta: VizQueryMeta | null,
      fromCache: boolean,
    ) => {
      const currentZoom = chartZoomRef.current;
      if (!currentZoom || chartDataLengthRef.current === 0) {
        setDetailRawVizData(null);
        setDetailQueryMeta(null);
        return;
      }
      const clamped = clampChartZoom(
        currentZoom.start,
        currentZoom.end,
        chartDataLengthRef.current,
      );
      if (`${clamped.start}:${clamped.end}` !== indexKey) return;

      setDetailRawVizData(data);
      setDetailQueryMeta(meta);
      if (!fromCache) {
        detailCacheRef.current.set(cacheKey, data, meta);
      }
    };

    if (cached) {
      applyDetail(cached.data, cached.meta, true);
      if (detailCacheRef.current.isFresh(cached)) {
        setDetailLoading(false);
        return;
      }
    }

    const seq = ++detailFetchSeqRef.current;
    if (!cached) setDetailLoading(true);

    const runFetch = () => {
      void (async () => {
        try {
          const result = await api.viz.queryItems({
            board_id: selectedBoard,
            items: itemsForDataQuery(itemsRef.current),
            time_range: { start: startTs, end: endTs },
            limit: MAX_POINTS,
          });
          if (detailFetchSeqRef.current !== seq) return;
          applyDetail(result.data, result.meta ?? null, false);
        } catch {
          if (detailFetchSeqRef.current !== seq) return;
          if (!cached) {
            setDetailRawVizData(null);
            setDetailQueryMeta(null);
          }
        } finally {
          if (detailFetchSeqRef.current === seq) {
            setDetailLoading(false);
          }
        }
      })();
    };

    if (cached) {
      runFetch();
      return;
    }

    detailDebounceRef.current = setTimeout(runFetch, 80);

    return () => {
      if (detailDebounceRef.current) {
        clearTimeout(detailDebounceRef.current);
        detailDebounceRef.current = null;
      }
    };
  }, [zoomWindow, liveMode, selectedBoard, itemTransformKey, inMemoryFull]);

  const displayChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (!zoomWindow) return chartData;
    if (inMemoryFull) {
      return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
    }
    if (detailChartData && detailChartData.length > 0) return detailChartData;
    return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
  }, [chartData, zoomWindow, detailChartData, inMemoryFull]);

  const displayRawVizData = useMemo(() => {
    if (!rawVizData.length) return [];
    if (!zoomWindow) return rawVizData;
    if (inMemoryFull) {
      return rawVizData.slice(zoomWindow.start, zoomWindow.end + 1);
    }
    if (detailRawVizData && detailRawVizData.length > 0) return detailRawVizData;
    return rawVizData.slice(zoomWindow.start, zoomWindow.end + 1);
  }, [rawVizData, zoomWindow, detailRawVizData, inMemoryFull]);

  const rawValuesByTimeKey = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of displayRawVizData) {
      map.set(row.timestamp, row.values);
    }
    return map;
  }, [displayRawVizData]);

  const canvasChartData = useMemo(() => {
    if (!chartData.length) return [];
    return inMemoryFull ? chartData : displayChartData;
  }, [chartData, displayChartData, inMemoryFull]);

  const interactionChartPoints = useMemo(() => {
    if (!chartData.length) return [];
    if (zoomWindow && inMemoryFull) {
      return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
    }
    return canvasChartData;
  }, [chartData, canvasChartData, zoomWindow, inMemoryFull]);

  renderChartDataLengthRef.current = interactionChartPoints.length;
  renderChartPointsRef.current = interactionChartPoints;

  const canvasWindowIndices = useMemo(
    () => (zoomWindow
      ? { start: zoomWindow.start, end: zoomWindow.end }
      : null),
    [zoomWindow?.start, zoomWindow?.end],
  );

  const resolveCanvasYScale = useCallback((item: VizItem) => (
    item.y_axis.id === SECONDARY_Y_AXIS_ID ? 'y2' : 'y'
  ), []);

  const chartInteractionHidden = isChartPanning || isChartSelecting || isChartMeasuring;

  const chartZoomActive = zoomWindow != null;

  const chartNavigatorWindow = useMemo(() => {
    if (liveMode || chartData.length <= 1) return null;
    if (chartZoomActive && chartZoom) {
      return { start: chartZoom.start, end: chartZoom.end };
    }
    return { start: 0, end: chartData.length - 1 };
  }, [liveMode, chartData.length, chartZoomActive, chartZoom]);

  const allRangeGuideCopy = useMemo(
    () => (allRangeGuide ? buildAllRangeGuideCopy(allRangeGuide, t) : null),
    [allRangeGuide, t],
  );

  const chartSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(t('viz.summary.points', { count: canvasChartData.length.toLocaleString() }));
    if (inMemoryFull && rawVizData.length > 0) {
      parts.push(t('viz.summary.inMemory', { size: formatFullLoadBytes(estimateVizPayloadBytes(rawVizData)) }));
    } else if (chartZoomActive && detailQueryMeta?.downsampled) {
      parts.push(t('viz.summary.detailRatio', {
        returned: detailQueryMeta.returned.toLocaleString(),
        total: detailQueryMeta.total_matched.toLocaleString(),
      }));
    } else if (chartZoomActive && detailQueryMeta) {
      parts.push(t('viz.summary.detailPts', { count: detailQueryMeta.returned.toLocaleString() }));
    } else if (queryMeta?.downsampled) {
      parts.push(t('viz.summary.sampled', {
        returned: queryMeta.returned.toLocaleString(),
        total: queryMeta.total_matched.toLocaleString(),
      }));
    }
    if (chartSeriesTruncated) {
      parts.push(t('viz.summary.series', { shown: MAX_CHART_SERIES, total: visibleItems.length }));
    }
    if (inMemoryFull) {
      parts.push(t('viz.summary.canvas'));
    }
    if (detailLoading && !detailRawVizData?.length) {
      parts.push(t('viz.summary.loadingDetail'));
    } else if (detailLoading) {
      parts.push(t('viz.summary.refreshingDetail'));
    }
    if (chartZoomActive) {
      parts.push(t('viz.summary.zoomed'));
    }
    if (liveMode) {
      parts.push(t('viz.summary.polling', { seconds: POLL_INTERVAL / 1000 }));
    }
    return parts.join(' · ');
  }, [
    t,
    canvasChartData.length,
    queryMeta,
    rawVizData,
    inMemoryFull,
    detailQueryMeta,
    detailLoading,
    detailRawVizData,
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
    () => new Set(activeChartItems.map(i => i.id)),
    [activeChartItems],
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

  const handleChartHoverTimeKey = useCallback((timeKey: string | null) => {
    if (isChartPanning || isChartSelecting || isChartMeasuring) return;
    if (timeKey == null) return;
    setHoverTimeKey(timeKey);
  }, [isChartPanning, isChartSelecting, isChartMeasuring]);

  const handleChartPlotBoundsChange = useCallback((bounds: { left: number; width: number }) => {
    chartPlotBoundsRef.current = bounds;
  }, []);

  const yAxisOptions = useMemo(() => {
    const ids = new Set(PRESET_Y_AXES.map(a => a.id));
    for (const item of items) ids.add(item.y_axis.id);
    return [...ids];
  }, [items]);

  const chartYAxes = useMemo(() => {
    if (activeChartItems.length === 0) return [];
    const usesRight = activeChartItems.some(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    const leftItems = activeChartItems.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
    const rightItems = activeChartItems.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
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
  }, [activeChartItems]);

  const chartYAxisDomains = useMemo(() => {
    const leftIds = activeChartItems
      .filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID)
      .map(i => i.id);
    const rightIds = activeChartItems
      .filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID)
      .map(i => i.id);
    return {
      [PRIMARY_Y_AXIS_ID]: computeYAxisDomain(chartData, leftIds),
      [SECONDARY_Y_AXIS_ID]: computeYAxisDomain(chartData, rightIds),
    } as Record<string, [number, number] | undefined>;
  }, [chartData, activeChartItems]);

  const canvasYAxisDomains = useMemo(() => ({
    y: chartYAxisDomains[PRIMARY_Y_AXIS_ID],
    y2: chartYAxisDomains[SECONDARY_Y_AXIS_ID],
  }), [chartYAxisDomains]);

  const canvasYAxes = useMemo(
    () => chartYAxes.map(axis => ({
      ...axis,
      id: axis.id === SECONDARY_Y_AXIS_ID ? 'y2' : 'y',
    })),
    [chartYAxes],
  );

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        chartPlotBoundsRef.current = chartCanvasRef.current?.refreshPlotBounds()
          ?? getChartPlotBoundsFromViewport(el);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasChartData, canvasYAxes, chartViewportHeight]);

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

  return (
    <div className="page">
      <PageHeader
        title={t('viz.title')}
        subtitle={t('viz.subtitle')}
      />

      <div className={`card table-card viz-config-card${configOpen ? '' : ' is-collapsed'}`}>
        <div className="card-header viz-config-header">
          <div className="viz-config-header-main">
            <h2>{t('viz.configuration')}</h2>
            {!configOpen && (
              <>
                {liveMode && (
                  <span className="viz-time-live-badge" aria-label={t('viz.liveActive')}>
                    {t('viz.live')}
                  </span>
                )}
                <span className="muted viz-config-summary">{configSummary}</span>
              </>
            )}
          </div>
          {configOpen && (
            <div className="btn-group viz-config-actions">
              <button type="button" onClick={fetchAll} className="btn-primary btn-sm" disabled={loading}>
                {loading ? t('common.loading') : t('common.refresh')}
              </button>
              {chartData.length > 0 && (
                <button type="button" className="btn-sm" onClick={exportCSV}>{t('viz.exportCsv')}</button>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm viz-config-collapse-btn"
            onClick={() => setConfigOpen(v => !v)}
            aria-expanded={configOpen}
            aria-label={configOpen ? t('viz.collapseConfig') : t('viz.expandConfig')}
            title={configOpen ? t('viz.collapse') : t('viz.expand')}
          >
            <span className={`viz-collapse-chevron${configOpen ? ' open' : ''}`} aria-hidden>›</span>
          </button>
        </div>
        {configOpen && (
        <div className="viz-config-panel">
        <div className="viz-config-row" aria-labelledby="viz-board-title">
          <div className="viz-config-row-head">
            <div id="viz-board-title" className="viz-config-row-title">{t('common.board')}</div>
          </div>
          <div className="viz-config-row-content viz-source-row">
            <label className="viz-source-field">
              <span className="viz-source-field-label">{t('common.board')}</span>
              <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
                <option value="">{t('viz.selectBoard')}</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="viz-source-field">
              <span className="viz-source-field-label">{t('common.protocol')}</span>
              <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
                <option value="">{t('viz.selectProtocol')}</option>
                {protocols.map(p => <option key={p.id} value={p.id}>{p.name} v{p.version}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className={`viz-config-row viz-config-row-time${liveMode ? ' is-live' : ''}`} aria-labelledby="viz-time-range-title">
          <div className="viz-config-row-head">
            <div id="viz-time-range-title" className="viz-config-row-title">
              {t('viz.timeRange')}
            </div>
          </div>
          <div className="viz-config-row-content viz-time-toolbar">
            <div className="viz-time-toolbar-main">
              <div className="viz-time-preset-group">
                <span className="viz-time-group-label">{t('viz.quickRange')}</span>
                <div
                  className="viz-time-presets"
                  role="group"
                  aria-label={t('viz.quickRange')}
                >
                  {timePresets.map(p => {
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
                aria-label={t('viz.searchByPeriod')}
              >
                <span className="viz-time-group-label">{t('viz.searchByPeriod')}</span>
                <div className="viz-time-custom-bar">
                  <input
                    type="text"
                    className="viz-time-input mono"
                    value={customStart}
                    onChange={e => {
                      setCustomStart(e.target.value);
                      setTimeRangePresetId(TIME_PRESET_ALL);
                      setAllRangeGuide(null);
                    }}
                    disabled={liveMode}
                    aria-label={t('viz.startTime')}
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
                      setAllRangeGuide(null);
                    }}
                    disabled={liveMode}
                    aria-label={t('viz.endTime')}
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
                      {t('viz.clear')}
                    </button>
                  )}
                </div>
              </div>
              <div className="viz-time-live-group">
                <span className="viz-time-group-label">{t('viz.liveMode')}</span>
                <div className="viz-time-live-bar">
                  <button
                    type="button"
                    className={`viz-time-live-toggle btn-live${liveMode ? ' active' : ''}`}
                    onClick={() => setLiveMode(v => !v)}
                    aria-pressed={liveMode}
                  >
                    {liveMode ? t('viz.liveBadge') : t('viz.live')}
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
                {t('viz.items')}
                <span className="tag tag-subtle">{items.length}</span>
              </div>
              <button type="button" className="btn-sm" onClick={addAllFields} disabled={!selectedProto}>
                {t('viz.addAllFields')}
              </button>
            </div>
            <div className="viz-items-header-right">
              {showProfileAdd ? (
                <div className="viz-profile-add-form">
                  <input
                    autoFocus
                    placeholder={t('viz.profileName')}
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
                    {profileSaving ? '…' : t('common.save')}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={cancelProfileAdd} disabled={profileSaving}>
                    {t('common.cancel')}
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
                        title={t('viz.profileItems', {
                          count: p.items.length,
                          visible: p.items.filter(i => i.visible).length,
                        })}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        className="viz-profile-tag-remove"
                        aria-label={t('viz.deleteProfile', { name: p.name })}
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
                      title={t('viz.addProfile')}
                    >
                      +
                    </button>
                  )}
                </div>
              ) : (
                <span className="muted viz-items-header-hint">{t('viz.selectBoardForProfiles')}</span>
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
                      title={t('viz.selectAll')}
                      aria-label={t('viz.selectAll')}
                    />
                  </div>
                </th>
                <th className="viz-name-col">NAME</th>
                <th className="viz-field-col-head">
                  <div className="viz-field-col-head-inner">
                    <span>{t('viz.field')}</span>
                    <button
                      type="button"
                      className={`viz-field-search-toggle${itemFieldSearchOpen || itemFieldSearch.trim() ? ' active' : ''}`}
                      onMouseDown={e => {
                        if (itemFieldSearchOpen) e.preventDefault();
                      }}
                      onClick={toggleItemFieldSearch}
                      aria-label={t('viz.searchFields')}
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
                        placeholder={t('viz.searchFieldPlaceholder')}
                        aria-label={t('viz.searchFieldAria')}
                      />
                    )}
                  </div>
                </th>
                <th>{t('viz.type')}</th>
                <th>{t('viz.yAxis')}</th>
                <th>{t('viz.unit')}</th>
                <th>{t('viz.offset')}</th>
                <th>{t('viz.weight')}</th>
                <th>{t('viz.color')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="viz-items-empty">
                    {t('viz.noItems')}
                  </td>
                </tr>
              )}
              {items.length > 0 && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="viz-items-empty">
                    {t('viz.noFieldMatch', { query: itemFieldSearch.trim() })}
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
                      title={t('viz.chartNameTitle')}
                      ariaLabel={t('viz.chartNameAria', { label: item.label })}
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
                      ariaLabel={t('viz.offsetAria', { label: item.label })}
                      onCommit={n => updateItem(item.id, 'offset', n)}
                    />
                  </td>
                  <td>
                    <VizItemNumericInput
                      value={item.weight}
                      emptyFallback={1}
                      ariaLabel={t('viz.weightAria', { label: item.label })}
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
                      aria-label={t('viz.colorAria', { label: item.label })}
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
        {allRangeGuideCopy && (
          <div className="viz-all-range-guide" role="status">
            <div className="viz-all-range-guide-content">
              <strong className="viz-all-range-guide-title">{allRangeGuideCopy.title}</strong>
              <p className="viz-all-range-guide-summary">{allRangeGuideCopy.summary}</p>
              <div className="viz-all-range-guide-why">
                <span className="viz-all-range-guide-why-label">{t('viz.guide.whyLabel')}</span>
                <p>{allRangeGuideCopy.why}</p>
              </div>
              <p className="viz-all-range-guide-recommend">{allRangeGuideCopy.recommend}</p>
            </div>
            <div className="viz-all-range-guide-actions">
              <button
                type="button"
                className="btn-sm"
                onClick={() => void applyGuideTimePreset('7d')}
                disabled={loading}
              >
                {t('viz.guide.adjust7d')}
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={() => void applyGuideTimePreset('30d')}
                disabled={loading}
              >
                {t('viz.guide.adjust30d')}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={dismissAllRangeGuide}
              >
                {t('viz.guide.continueSample')}
              </button>
            </div>
          </div>
        )}
        <div className="card-header viz-chart-header">
          <div className="viz-chart-header-main">
            <h2>{t('viz.chart')}</h2>
            <p className="viz-chart-summary">{chartSummary}</p>
          </div>
          <div className="viz-chart-toolbar">
            <button
              type="button"
              className="viz-chart-icon-btn"
              onClick={() => setChartManualOpen(true)}
              title={t('common.manual')}
              aria-label={t('common.manual')}
            >
              <IconManual />
            </button>
            <div className="viz-chart-toolbar-sep" aria-hidden />
            <div className="viz-chart-toolbar-group" role="group" aria-label={t('viz.chartView')}>
              <button
                type="button"
                className={`viz-chart-icon-btn viz-chart-fullscreen-toggle${chartFullscreen ? ' active' : ''}`}
                onClick={() => void toggleChartFullscreen()}
                title={chartFullscreen ? t('viz.exitFullscreen') : t('viz.fullscreen')}
                aria-label={chartFullscreen ? t('viz.exitFullscreen') : t('viz.fullscreen')}
                aria-pressed={chartFullscreen}
              >
                {chartFullscreen ? <IconFullscreenExit /> : <IconFullscreen />}
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={() => zoomChartByFactor(0.8)}
                disabled={liveMode || displayChartData.length === 0}
                title={t('viz.zoomIn')}
                aria-label={t('viz.zoomIn')}
              >
                <IconZoomIn />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={() => zoomChartByFactor(1.25)}
                disabled={liveMode || !chartZoomActive}
                title={t('viz.zoomOut')}
                aria-label={t('viz.zoomOut')}
              >
                <IconZoomOut />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={resetChartZoom}
                disabled={liveMode || !chartZoomActive}
                title={t('viz.resetZoom')}
                aria-label={t('viz.resetZoom')}
              >
                <IconZoomReset />
              </button>
            </div>
            {items.length > 0 && (
              <>
                <div className="viz-chart-toolbar-sep" aria-hidden />
                <div className="viz-chart-toolbar-group" role="group" aria-label={t('viz.seriesGroup.panelToggles')}>
                  <button
                    type="button"
                    className={`viz-chart-icon-btn viz-chart-tooltip-toggle${chartTooltipEnabled ? ' active' : ''}`}
                    onClick={() => setChartTooltipEnabled(v => !v)}
                    title={t('viz.tooltipToggle')}
                    aria-label={t('viz.tooltipToggle')}
                    aria-pressed={chartTooltipEnabled}
                  >
                    <IconTooltip />
                  </button>
                  <button
                    type="button"
                    className={`viz-chart-icon-btn${seriesValuesOpen ? ' active' : ''}`}
                    onClick={() => setSeriesValuesOpen(v => !v)}
                    title={t('viz.seriesGroup.valuesToggle')}
                    aria-label={t('viz.seriesGroup.valuesToggle')}
                    aria-pressed={seriesValuesOpen}
                  >
                    <IconFieldValues />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="viz-chart-panel">
        <div
          ref={chartViewportRef}
          className={`viz-chart-viewport${isChartSelecting ? ' selecting' : ''}${isChartPanning ? ' panning' : ''}${isChartMeasuring ? ' measuring' : ''}${chartZoomActive ? ' zoomed' : ''}${liveMode ? ' live' : ''}`}
          tabIndex={-1}
          onDoubleClick={liveMode ? undefined : resetChartZoom}
        >
          {selectionOverlay.overlayNode}
          {timeMeasureOverlay.overlayNode}
          {canvasChartData.length > 0 && activeChartItems.length > 0 ? (
          <VizCanvasChart
            ref={chartCanvasRef}
            points={canvasChartData}
            fullTimeline={inMemoryFull ? chartData : undefined}
            windowIndices={canvasWindowIndices}
            chartItems={chartItems}
            maxVisibleSeries={MAX_CHART_SERIES}
            yAxisDomains={canvasYAxisDomains}
            yAxes={canvasYAxes}
            chartLabel={chartLabel}
            resolveYScale={resolveCanvasYScale}
            height={chartViewportHeight}
            tooltipEnabled={chartTooltipEnabled}
            hideTooltip={chartInteractionHidden}
            itemById={tooltipItemById}
            rawValuesByTimeKey={rawValuesByTimeKey}
            onHoverTimeKey={handleChartHoverTimeKey}
            onPlotBoundsChange={handleChartPlotBoundsChange}
            formatYTick={formatYAxisTick}
            formatTooltipValue={formatTooltipItemValue}
          />
          ) : canvasChartData.length > 0 && items.length > 0 ? (
            <p className="viz-chart-empty muted">{t('viz.noVisibleItems')}</p>
          ) : null}
        </div>
        {chartNavigatorWindow && (
          <ChartZoomNavigator
            chartData={chartData}
            chartZoom={chartNavigatorWindow}
            sparkItemId={activeChartItems[0]?.id}
            formatTime={formatChartAxisTime}
            onWindowChange={applyChartZoomWindow}
            totalMatched={queryMeta?.total_matched}
            returned={queryMeta?.returned ?? chartData.length}
            downsampled={queryMeta?.downsampled}
          />
        )}
        {items.length > 0 && canvasChartData.length > 0 && (
          <ChartSeriesGroup
            open={seriesValuesOpen}
            timeKey={hoverTimeKey}
            formatTime={formatChartAxisTime}
            rows={cursorValueRows}
            onToggleVisibility={toggleVisibility}
            onToggleFavorite={toggleItemFavorite}
          />
        )}
        </div>
      </div>

      {Object.keys(statistics).length > 0 && (
        <div className={`card table-card viz-stats-card${statsOpen ? '' : ' is-collapsed'}`}>
          <div className="card-header viz-stats-header">
            <div className="viz-stats-header-main">
              <h2>{t('viz.statistics')}</h2>
              {!statsOpen && statsSummary && (
                <span className="muted viz-config-summary">{statsSummary}</span>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm viz-config-collapse-btn"
              onClick={() => setStatsOpen(v => !v)}
              aria-expanded={statsOpen}
              aria-label={statsOpen ? t('viz.collapse') : t('viz.expand')}
              title={statsOpen ? t('viz.collapse') : t('viz.expand')}
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
                  <th>{t('viz.min')}</th>
                  <th>{t('viz.max')}</th>
                  <th>{t('viz.avg')}</th>
                  <th>{t('viz.last')}</th>
                  <th>{t('viz.count')}</th>
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
      <ChartHelpManual open={chartManualOpen} onClose={() => setChartManualOpen(false)} />
    </div>
  );
}
