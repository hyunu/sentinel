import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig } from '../api';
import ChartZoomNavigator from '../components/ChartZoomNavigator';
import DateRangePicker from '../components/DateRangePicker';
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
  IconPanelBottom,
  IconPanelLeft,
} from '../components/ChartControlIcons';
import { formatDateOnly, formatChartAxisTime, formatTimeInterval, parseDateOnly } from '../utils/date';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';
import {
  cancelChartZoomRaf,
  chartZoomEquals,
  createChartZoomCommitter,
  getChartTimeMsFromClientX,
  findNearestChartIndexForTimeMs,
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
import {
  chartZoomRangeFromTimeMs,
  computePanTimeRange,
  computeWheelZoomTimeRange,
  fullChartTimeSpan,
  isFullChartTimeRange,
  minChartZoomSpanMs,
  resolveChartZoomTimeRange,
} from '../lib/vizChartZoomTime';
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
import {
  clampChartZoom,
  computeYAxisDomain,
  parseOptionalNumber,
  vizErrorMessage,
  yAxisOptionLabel,
  PRIMARY_Y_AXIS_ID,
  SECONDARY_Y_AXIS_ID,
  type VizChartPoint,
} from '../lib/vizDashboardUtils';
import {
  TIME_PRESET_ALL,
  TIME_PRESET_IDS,
  isAllTimeRangeSelection,
  isCustomTimeRangeSelection,
  presetRangeStart,
  type TimePresetId,
} from '../lib/vizTimePresets';
import {
  CHART_KEYBOARD_PAN_PX,
  isEditableKeyboardTarget,
  resolveChartKeyboardAction,
} from '../lib/vizChartKeyboard';
import { spectrumBinRangeToTimeRange } from '../lib/vizChartSpectrum';
import {
  findSessionBreakTimesFromSpectrum,
  findSessionBreakTimesSec,
  spectrumBinsForSessionGaps,
} from '../lib/vizChartSessionBreaks';
import { useTranslation, type TFunction } from '../i18n';

type ChartPoint = VizChartPoint;

const COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd', '#98d8c8', '#f7dc6f'];
const CHART_TYPES = ['line', 'bar', 'area'] as const;
const MAX_POINTS = 8000;
const MAX_CHART_SERIES = 24;
const MAX_PROFILES = 5;
const POLL_INTERVAL = 3000;
const MIN_CHART_ZOOM_POINTS = 10;

type FieldValuesLayout = 'bottom' | 'left';
const FIELD_VALUES_LAYOUT_KEY = 'sentinel-viz-field-values-layout';

function readFieldValuesLayout(): FieldValuesLayout {
  try {
    const stored = localStorage.getItem(FIELD_VALUES_LAYOUT_KEY);
    if (stored === 'bottom' || stored === 'left') return stored;
  } catch {
    /* ignore */
  }
  return 'bottom';
}

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
    chart_type: String(item.chart_type) === 'scatter' ? 'line' : item.chart_type,
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

interface Statistics {
  min: number;
  max: number;
  avg: number;
  count: number;
  last: number | string;
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

type VizDataRow = { timestamp: string; values: Record<string, number> };
type VizQueryMeta = { total_matched: number; returned: number; downsampled: boolean };

function isRequestAborted(error: unknown): boolean {
  return error instanceof Error
    && /timeout or cancelled|aborted|abort/i.test(error.message);
}

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
  options?: { assessAllRange?: boolean; signal?: AbortSignal; timeoutMs?: number },
): Promise<{
  data: VizDataRow[];
  meta: VizQueryMeta | null;
  inMemoryFull: boolean;
  allRangeAssessment: AllRangeLoadAssessment | null;
}> {
  const overview = await api.viz.queryItems(
    { ...params, limit: MAX_POINTS },
    { signal: options?.signal, timeoutMs: options?.timeoutMs },
  );
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
  const full = await api.viz.queryItems(
    {
      ...params,
      limit: meta!.total_matched,
    },
    { signal: options?.signal, timeoutMs: options?.timeoutMs },
  );
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
  const [selectedBoard, setSelectedBoard] = useState('');
  const [boardProtocol, setBoardProtocol] = useState<ProtocolSpec | null>(null);
  const [items, setItems] = useState<VizItem[]>([]);
  const itemQueryKey = useMemo(
    () => items.map(i => `${i.id}:${i.field_ref.protocol_id}:${i.field_ref.field_name}:${i.visible}`).join('|'),
    [items],
  );
  const itemTransformKey = useMemo(
    () => items.map(i => `${i.id}:${i.label}:${i.visible}:${i.offset}:${i.weight}`).join('|'),
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
  /** Exact chart query range from spectrum drag — preserved separately from date-only custom range. */
  const [chartQueryTimeRange, setChartQueryTimeRange] = useState<{ start: string; end: string } | null>(null);
  const [spectrum, setSpectrum] = useState<{ present: boolean[]; start: string; end: string } | null>(null);
  const [spectrumLoading, setSpectrumLoading] = useState(false);
  const [spectrumSel, setSpectrumSel] = useState<{ start: number; end: number } | null>(null);
  const spectrumSelRef = useRef<{ start: number; end: number } | null>(null);
  const spectrumDragRef = useRef<{ pointerId: number; startIndex: number } | null>(null);
  const spectrumTrackRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [livePollError, setLivePollError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [chartTooltipEnabled, setChartTooltipEnabled] = useState(true);
  const [seriesValuesOpen, setSeriesValuesOpen] = useState(true);
  const [fieldValuesLayout, setFieldValuesLayout] = useState<FieldValuesLayout>(readFieldValuesLayout);
  const [hoverTimeKey, setHoverTimeKey] = useState<string | null>(null);
  const [queryMeta, setQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailRawVizData, setDetailRawVizData] = useState<VizDataRow[] | null>(null);
  const [detailQueryMeta, setDetailQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sessionPresence, setSessionPresence] = useState<{
    start: string;
    end: string;
    present: boolean[];
  } | null>(null);
  const [inMemoryFull, setInMemoryFull] = useState(false);
  const [allRangeGuide, setAllRangeGuide] = useState<AllRangeLoadAssessment | null>(null);
  const detailFetchSeqRef = useRef(0);
  const detailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCacheRef = useRef(new VizDetailCache());
  const overviewAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [fieldTooltip, setFieldTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [itemFieldSearch, setItemFieldSearch] = useState('');
  const [itemFieldSearchOpen, setItemFieldSearchOpen] = useState(false);
  const [addFieldPick, setAddFieldPick] = useState('');
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
    startTs?: string;
    endTs?: string;
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

  const applyChartZoomRange = useCallback((range: ChartZoomRange) => {
    const len = chartDataLengthRef.current || chartData.length;
    const data = chartDataRef.current;
    if (len === 0) {
      syncChartZoomRef(chartZoomRef, null);
      setChartZoom(null);
      chartCanvasRef.current?.resetWindow();
      return;
    }

    const fullSpan = fullChartTimeSpan(data);
    if (fullSpan && range.startTs && range.endTs) {
      const startMs = Date.parse(range.startTs);
      const endMs = Date.parse(range.endTs);
      if (
        Number.isFinite(startMs)
        && Number.isFinite(endMs)
        && isFullChartTimeRange({ startMs, endMs }, fullSpan.startMs, fullSpan.endMs)
      ) {
        syncChartZoomRef(chartZoomRef, null);
        setChartZoom(null);
        chartCanvasRef.current?.resetWindow();
        return;
      }
    } else {
      const clamped = clampChartZoom(range.start, range.end, len);
      if (clamped.end - clamped.start + 1 >= len) {
        syncChartZoomRef(chartZoomRef, null);
        setChartZoom(null);
        chartCanvasRef.current?.resetWindow();
        return;
      }
    }

    const next = clampChartZoom(range.start, range.end, len);
    const nextRange: ChartZoomRange = {
      start: next.start,
      end: next.end,
      startTs: range.startTs,
      endTs: range.endTs,
    };
    syncChartZoomRef(chartZoomRef, nextRange);
    setChartZoom(nextRange);

    if (inMemoryFullRef.current) {
      chartCanvasRef.current?.setWindowByIndex(nextRange.start, nextRange.end);
    } else if (nextRange.startTs && nextRange.endTs) {
      chartCanvasRef.current?.setWindowByTimeKeys(nextRange.startTs, nextRange.endTs);
    }
  }, [chartData.length]);

  const applyChartZoomRangeImmediate = useCallback((range: ChartZoomRange) => {
    const len = chartDataLengthRef.current;
    const data = chartDataRef.current;
    if (len === 0) return;

    const fullSpan = fullChartTimeSpan(data);
    const next = clampChartZoom(range.start, range.end, len);
    const nextRange: ChartZoomRange = {
      start: next.start,
      end: next.end,
      startTs: range.startTs,
      endTs: range.endTs,
    };

    if (
      fullSpan
      && nextRange.startTs
      && nextRange.endTs
      && isFullChartTimeRange(
        { startMs: Date.parse(nextRange.startTs), endMs: Date.parse(nextRange.endTs) },
        fullSpan.startMs,
        fullSpan.endMs,
      )
    ) {
      chartZoomRef.current = null;
      chartCanvasRef.current?.resetWindow();
      syncReactChartZoomFromRef();
      return;
    }

    chartZoomRef.current = nextRange;
    if (inMemoryFullRef.current) {
      chartCanvasRef.current?.setWindowByIndex(nextRange.start, nextRange.end);
    } else if (nextRange.startTs && nextRange.endTs) {
      chartCanvasRef.current?.setWindowByTimeKeys(nextRange.startTs, nextRange.endTs);
    }
    syncReactChartZoomFromRef();
  }, [syncReactChartZoomFromRef]);

  const applyChartZoomFromTimeMs = useCallback((startMs: number, endMs: number) => {
    const data = chartDataRef.current;
    const len = chartDataLengthRef.current || data.length;
    if (len === 0) return;
    applyChartZoomRange(chartZoomRangeFromTimeMs(data, startMs, endMs, len));
  }, [applyChartZoomRange]);

  const applyChartZoomFromTimeMsImmediate = useCallback((startMs: number, endMs: number) => {
    const data = chartDataRef.current;
    const len = chartDataLengthRef.current || data.length;
    if (len === 0) return;
    applyChartZoomRangeImmediate(chartZoomRangeFromTimeMs(data, startMs, endMs, len));
  }, [applyChartZoomRangeImmediate]);

  const applyChartZoomFromTimeMsImmediateRef = useRef(applyChartZoomFromTimeMsImmediate);
  applyChartZoomFromTimeMsImmediateRef.current = applyChartZoomFromTimeMsImmediate;

  const applyCanvasZoomWindowRef = useRef(applyChartZoomRangeImmediate);
  applyCanvasZoomWindowRef.current = applyChartZoomRangeImmediate;

  const syncReactChartZoomFromRefFn = useRef(syncReactChartZoomFromRef);
  syncReactChartZoomFromRefFn.current = syncReactChartZoomFromRef;

  useEffect(() => {
    if (liveModeRef.current) return;
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
    const protoName = boardProtocol?.name;
    const visibleCount = items.filter(i => i.visible).length;
    return [boardName, protoName, `${visibleCount}/${items.length} items visible`].filter(Boolean).join(' · ');
  }, [boards, selectedBoard, boardProtocol, items]);

  const applyChartZoomWindow = useCallback((range: ChartZoomRange) => {
    applyChartZoomRange(range);
  }, [applyChartZoomRange]);

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
    if (chartData.length === 0) return;
    const fullSpan = fullChartTimeSpan(chartData);
    if (!fullSpan) return;
    const current = resolveChartZoomTimeRange(chartData, chartZoom, chartData.length) ?? fullSpan;
    const focusMs = current.startMs + focusRatio * (current.endMs - current.startMs);
    const minSpanMs = minChartZoomSpanMs(
      fullSpan.endMs - fullSpan.startMs,
      chartData.length,
      MIN_CHART_ZOOM_POINTS,
    );
    const next = computeWheelZoomTimeRange(
      current,
      focusMs,
      factor,
      fullSpan.startMs,
      fullSpan.endMs,
      minSpanMs,
    );
    applyChartZoomFromTimeMs(next.startMs, next.endMs);
  }, [applyChartZoomFromTimeMs, chartData, chartZoom]);

  const panChartByKeyboard = useCallback((direction: -1 | 1) => {
    if (chartData.length === 0) return;
    const zoom = chartZoom;
    const fullSpan = fullChartTimeSpan(chartData);
    if (!zoom || !fullSpan) return;
    const current = resolveChartZoomTimeRange(chartData, zoom, chartData.length);
    if (!current || isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs)) return;

    const plotWidth = chartCanvasRef.current?.getPlotClientMetrics()?.plotWidth
      ?? chartPlotBoundsRef.current.width;
    if (plotWidth <= 0) return;

    const next = computePanTimeRange(
      current,
      direction * CHART_KEYBOARD_PAN_PX,
      plotWidth,
      fullSpan.startMs,
      fullSpan.endMs,
    );
    applyChartZoomFromTimeMs(next.startMs, next.endMs);
  }, [applyChartZoomFromTimeMs, chartData, chartZoom]);

  const handleChartViewportKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableKeyboardTarget(e.target)) return;
    const action = resolveChartKeyboardAction(e.key);
    if (!action) return;

    if (action.type === 'reset-zoom') {
      if (!chartZoom || chartData.length === 0) return;
      const fullSpan = fullChartTimeSpan(chartData);
      const current = resolveChartZoomTimeRange(chartData, chartZoom, chartData.length);
      if (!fullSpan || !current || isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs)) return;
    }

    switch (action.type) {
      case 'zoom-in':
        e.preventDefault();
        zoomChartByFactor(0.8, 0.5);
        break;
      case 'zoom-out':
        e.preventDefault();
        zoomChartByFactor(1.25, 0.5);
        break;
      case 'pan-left':
        e.preventDefault();
        panChartByKeyboard(-1);
        break;
      case 'pan-right':
        e.preventDefault();
        panChartByKeyboard(1);
        break;
      case 'reset-zoom':
        e.preventDefault();
        resetChartZoom();
        break;
      default:
        break;
    }
  }, [liveMode, chartZoom, chartData.length, zoomChartByFactor, panChartByKeyboard, resetChartZoom]);

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

    const data = chartDataRef.current;
    if (data.length === 0) return;

    const minX = Math.min(leftClientX, rightClientX);
    const maxX = Math.max(leftClientX, rightClientX);
    const startMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(minX)
      ?? (() => {
        const el = chartViewportRef.current;
        if (!el) return null;
        const { plotLeft, plotWidth } = getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current);
        return getChartTimeMsFromClientX(minX, plotLeft, plotWidth, data);
      })();
    const endMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(maxX)
      ?? (() => {
        const el = chartViewportRef.current;
        if (!el) return null;
        const { plotLeft, plotWidth } = getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current);
        return getChartTimeMsFromClientX(maxX, plotLeft, plotWidth, data);
      })();
    if (startMs == null || endMs == null) return;

    const loMs = Math.min(startMs, endMs);
    const hiMs = Math.max(startMs, endMs);
    const fullSpan = fullChartTimeSpan(data);
    if (!fullSpan) return;
    const minSpanMs = minChartZoomSpanMs(
      fullSpan.endMs - fullSpan.startMs,
      data.length,
      MIN_CHART_ZOOM_POINTS,
    );
    if (hiMs - loMs < minSpanMs) return;

    applyChartZoomFromTimeMs(loMs, hiMs);
  }, [applyChartZoomFromTimeMs, selectionOverlay.hide]);

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
      const len = chartDataLengthRef.current;
      if (len <= 1) return 0;
      const data = chartDataRef.current;
      const focusMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(clientX);
      if (focusMs != null && data.length > 0) {
        return findNearestChartIndexForTimeMs(data, focusMs, len);
      }
      const { plotLeft, plotWidth } = getPlotMetrics();
      const ratio = Math.max(0, Math.min(1, (clientX - plotLeft) / plotWidth));
      return Math.round(ratio * (len - 1));
    };

    const getTimeMsFromClientX = (clientX: number): number | null => {
      const focusMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(clientX);
      if (focusMs != null) return focusMs;
      const { plotLeft, plotWidth } = getPlotMetrics();
      return getChartTimeMsFromClientX(
        clientX,
        plotLeft,
        plotWidth,
        chartDataRef.current,
      );
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

      const fullSpan = fullChartTimeSpan(data);
      const current = resolveChartZoomTimeRange(
        data,
        {
          start: session.zoomStart,
          end: session.zoomEnd,
          startTs: session.startTs,
          endTs: session.endTs,
        },
        len,
      );
      if (!fullSpan || !current) return;

      const next = computePanTimeRange(
        current,
        deltaX,
        plotWidth,
        fullSpan.startMs,
        fullSpan.endMs,
      );
      if (isFullChartTimeRange(next, fullSpan.startMs, fullSpan.endMs)) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
      } else {
        applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
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
      if (e.button !== 0) return;
      if (activeChartPointerRef.current != null) {
        endPointerSession(activeChartPointerRef.current);
      }

      if (e.shiftKey) {
        if (chartDataLengthRef.current === 0) return;
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
        if (chartDataLengthRef.current === 0) return;
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

      {
        const len = chartDataLengthRef.current;
        if (len === 0) return;
        const zoom = chartZoomRef.current;
        const zoomStart = zoom?.start ?? 0;
        const zoomEnd = zoom?.end ?? len - 1;
        panSessionRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          zoomStart,
          zoomEnd,
          startTs: zoom?.startTs,
          endTs: zoom?.endTs,
          span: zoomEnd - zoomStart + 1,
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
      const fullSpan = fullChartTimeSpan(data);
      const current = resolveChartZoomTimeRange(data, zoom, len);
      if (!fullSpan || !current) return;

      const plotWidth = getWheelPlotWidth();
      if (plotWidth <= 0) return;

      const next = computePanTimeRange(
        current,
        deltaX,
        plotWidth,
        fullSpan.startMs,
        fullSpan.endMs,
      );
      if (isFullChartTimeRange(next, fullSpan.startMs, fullSpan.endMs)) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
      } else {
        applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
      }
    };

    const applyWheelZoom = (deltaY: number, focusRatio: number, focusMs: number | null) => {
      const len = chartDataLengthRef.current;
      if (len === 0) return;
      const factor = wheelDeltaToZoomFactor(deltaY);
      if (factor == null) return;

      const data = chartDataRef.current;
      const fullSpan = fullChartTimeSpan(data);
      const current = resolveChartZoomTimeRange(data, chartZoomRef.current, len) ?? fullSpan;
      if (!fullSpan || !current) return;

      const focus = focusMs ?? current.startMs + focusRatio * (current.endMs - current.startMs);
      const minSpanMs = minChartZoomSpanMs(
        fullSpan.endMs - fullSpan.startMs,
        len,
        MIN_CHART_ZOOM_POINTS,
      );
      const next = computeWheelZoomTimeRange(
        current,
        focus,
        factor,
        fullSpan.startMs,
        fullSpan.endMs,
        minSpanMs,
      );

      if (isFullChartTimeRange(next, fullSpan.startMs, fullSpan.endMs)) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        syncReactChartZoomFromRefFn.current();
        return;
      }

      applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
    };

    const onWheel = (e: WheelEvent) => {
      if (chartDataLengthRef.current === 0) return;

      const canvasMetrics = chartCanvasRef.current?.getPlotClientMetrics();
      const plotLeft = canvasMetrics?.plotLeft
        ?? getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotLeft;
      const plotWidth = canvasMetrics?.plotWidth
        ?? getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotWidth;
      if (plotWidth <= 0) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const isPinch = e.ctrlKey;
      const horizontalScroll = !isPinch && (absX > absY || (e.shiftKey && absY > 0));

      e.preventDefault();

      if (horizontalScroll) {
        wheelEventRef.current = null;
        if (wheelRafRef.current != null) {
          cancelAnimationFrame(wheelRafRef.current);
          wheelRafRef.current = null;
        }
        const panDelta = absX > absY ? e.deltaX : e.deltaY;
        applyWheelPan(panDelta);
        return;
      }

      const focusRatio = wheelFocusRatioFromClientX(e.clientX, plotLeft, plotWidth);
      const focusMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(e.clientX) ?? null;
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
  }, []);

  useEffect(() => {
    if (selectedBoard || boards.length === 0) return;
    const preferred = boards.find(b => b.name === 'STN-001') ?? boards[0];
    setSelectedBoard(preferred.id);
  }, [boards, selectedBoard]);



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
    setQueryError(null);
    setLoading(true);
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    try {
      const p = await api.viz.getProfile(id);
      setSelectedBoard(p.board_id);
      setItems(normalizeVizItems(p.items));
      setSavedProfileId(p.id);
      setShowProfileAdd(false);
      setProfileDraftName('');
      if (p.time_range?.start && p.time_range?.end) {
        setCustomStart(formatDateOnly(new Date(p.time_range.start)));
        setCustomEnd(formatDateOnly(new Date(p.time_range.end)));
        setTimeRangePresetId(TIME_PRESET_ALL);
      }
      const isAllRange = !p.time_range?.start || !p.time_range?.end;
      const result = await queryVizDataset({
        board_id: p.board_id,
        items: itemsForDataQuery(p.items),
        time_range: p.time_range?.start && p.time_range?.end
          ? { start: p.time_range.start, end: p.time_range.end }
          : undefined,
      }, {
        assessAllRange: isAllRange,
        signal: controller.signal,
        timeoutMs: 45000,
      });
      if (controller.signal.aborted) return;
      applyQueryResult(result, isAllRange);
    } catch (e) {
      if (isRequestAborted(e)) return;
      setQueryError(vizErrorMessage(e, t('viz.queryError')));
    } finally {
      if (overviewAbortRef.current === controller) {
        overviewAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [applyQueryResult, t]);

  const dismissQueryError = useCallback(() => {
    setQueryError(null);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
    setAllRangeGuide(null);
  }, [selectedBoard]);

  const buildTimeRange = useCallback((): { start: string; end: string } | undefined => {
    if (chartQueryTimeRange) return chartQueryTimeRange;
    if (timeRangePresetId !== TIME_PRESET_ALL) {
      const end = new Date();
      const start = presetRangeStart(end, timeRangePresetId);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    if (customStart && customEnd) {
      const startDate = parseDateOnly(customStart);
      const endDate = parseDateOnly(customEnd);
      if (startDate && endDate) {
        if (endDate.getTime() < startDate.getTime()) return undefined;
        const endEnd = new Date(endDate.getTime());
        endEnd.setHours(23, 59, 59, 999);
        return { start: startDate.toISOString(), end: endEnd.toISOString() };
      }
    }
    return undefined;
  }, [chartQueryTimeRange, timeRangePresetId, customStart, customEnd]);

  const buildSpectrumRange = useCallback((): { start: string; end: string } | undefined => {
    if (timeRangePresetId !== TIME_PRESET_ALL) {
      const end = new Date();
      const start = presetRangeStart(end, timeRangePresetId);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    return undefined;
  }, [timeRangePresetId]);

  const fetchSpectrum = useCallback(async (boardID: string, start?: string, end?: string) => {
    if (!boardID) return;
    setSpectrumLoading(true);
    try {
      const res = await api.viz.spectrum(
        start && end
          ? { board_id: boardID, start, end }
          : { board_id: boardID },
        { timeoutMs: 20000 },
      );
      if (res.bins > 0) {
        setSpectrum({ present: res.present, start: res.start, end: res.end });
      }
    } catch (e) {
      console.error('spectrum fetch failed', e);
    } finally {
      setSpectrumLoading(false);
    }
  }, []);

  const spectrumRange = buildSpectrumRange();
  useEffect(() => {
    if (!selectedBoard) {
      setSpectrum(null);
      setChartQueryTimeRange(null);
      setSpectrumSel(null);
      return;
    }
    const range = spectrumRange;
    void fetchSpectrum(selectedBoard, range?.start, range?.end);
  }, [selectedBoard, spectrumRange, fetchSpectrum]);

  const spectrumRangeKey = spectrum ? `${spectrum.start}:${spectrum.end}` : '';
  useEffect(() => {
    setSpectrumSel(null);
    spectrumSelRef.current = null;
  }, [spectrumRangeKey]);

  const isCustomTimeRange = isCustomTimeRangeSelection(timeRangePresetId, customStart, customEnd);

  const timeSpectrumCells = spectrum?.present ?? null;

  const applyTimePresetState = useCallback((id: TimePresetId) => {
    setTimeRangePresetId(id);
    setCustomStart('');
    setCustomEnd('');
    setChartQueryTimeRange(null);
    setSpectrumSel(null);
    spectrumSelRef.current = null;
    if (id !== TIME_PRESET_ALL) {
      setAllRangeGuide(null);
    }
  }, []);

  const runVizQuery = useCallback(async (
    timeRange: { start: string; end: string } | undefined,
    assessAllRange: boolean,
  ) => {
    if (!selectedBoard || !itemsRef.current.length) return;
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    setLoading(true);
    setQueryError(null);
    try {
      const result = await queryVizDataset({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        time_range: timeRange,
      }, {
        assessAllRange,
        signal: controller.signal,
        timeoutMs: 45000,
      });
      if (controller.signal.aborted) return;
      applyQueryResult(result, assessAllRange);
    } catch (e) {
      if (isRequestAborted(e)) return;
      setQueryError(vizErrorMessage(e, t('viz.queryError')));
    } finally {
      if (overviewAbortRef.current === controller) {
        overviewAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [selectedBoard, applyQueryResult, t]);

  const applyTimePresetQuery = useCallback(async (id: TimePresetId) => {
    if (liveModeRef.current || !selectedBoard || !itemsRef.current.length) return;
    const isAllRange = id === TIME_PRESET_ALL;
    const timeRange = isAllRange
      ? undefined
      : (() => {
          const end = new Date();
          const start = presetRangeStart(end, id);
          return { start: start.toISOString(), end: end.toISOString() };
        })();
    await runVizQuery(timeRange, isAllRange);
  }, [selectedBoard, runVizQuery]);

  const selectTimePreset = useCallback((id: TimePresetId) => {
    applyTimePresetState(id);
    void applyTimePresetQuery(id);
  }, [applyTimePresetState, applyTimePresetQuery]);

  const applySpectrumSelection = useCallback((startIdx: number, endIdx: number) => {
    if (!spectrum || liveModeRef.current) return;
    const bins = spectrum.present.length;
    const startMs = Date.parse(spectrum.start);
    const endMs = Date.parse(spectrum.end);
    const range = spectrumBinRangeToTimeRange(startIdx, endIdx, startMs, endMs, bins);
    if (!range || range.endMs <= range.startMs) return;

    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const selStart = new Date(range.startMs);
    const selEnd = new Date(range.endMs);
    const queryRange = { start: selStart.toISOString(), end: selEnd.toISOString() };

    setSpectrumSel({ start: lo, end: hi });
    spectrumSelRef.current = { start: lo, end: hi };
    setChartQueryTimeRange(queryRange);
    setAllRangeGuide(null);
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    chartCanvasRef.current?.resetWindow();
    void runVizQuery(queryRange, false);
  }, [spectrum, runVizQuery]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = spectrumDragRef.current;
      const track = spectrumTrackRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !track) return;
      const bins = spectrum?.present.length ?? 0;
      if (bins <= 0) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const index = Math.min(bins - 1, Math.floor(ratio * bins));
      const lo = Math.min(drag.startIndex, index);
      const hi = Math.max(drag.startIndex, index);
      spectrumSelRef.current = { start: lo, end: hi };
      setSpectrumSel({ start: lo, end: hi });
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = spectrumDragRef.current;
      const track = spectrumTrackRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      spectrumDragRef.current = null;
      if (track?.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
      const sel = spectrumSelRef.current;
      spectrumSelRef.current = null;
      if (sel) {
        applySpectrumSelection(sel.start, sel.end);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [spectrum, applySpectrumSelection]);

  const fetchAll = useCallback(async () => {
    const isAllRange = !chartQueryTimeRange
      && isAllTimeRangeSelection(timeRangePresetId, customStart, customEnd);
    await runVizQuery(buildTimeRange(), isAllRange);
  }, [runVizQuery, buildTimeRange, chartQueryTimeRange, timeRangePresetId, customStart, customEnd]);

  const applyGuideTimePreset = useCallback(async (id: TimePresetId) => {
    applyTimePresetState(id);
    await applyTimePresetQuery(id);
  }, [applyTimePresetState, applyTimePresetQuery]);

  const dismissAllRangeGuide = useCallback(() => {
    setAllRangeGuide(null);
  }, []);

  const clearCustomTimeRange = useCallback(() => {
    setCustomStart('');
    setCustomEnd('');
    setChartQueryTimeRange(null);
    setSpectrumSel(null);
    spectrumSelRef.current = null;
    setTimeRangePresetId(TIME_PRESET_ALL);
  }, []);

  const appendLive = useCallback(async () => {
    if (!selectedBoard || !itemsRef.current.length) return;
    const since = lastTimestampRef.current;
    liveAbortRef.current?.abort();
    const controller = new AbortController();
    liveAbortRef.current = controller;
    try {
      const result = await api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        since: since || undefined,
        limit: MAX_POINTS,
      }, { signal: controller.signal, timeoutMs: 20000 });
      if (controller.signal.aborted) return;
      if (!result.data.length) return;
      lastTimestampRef.current = result.data[result.data.length - 1].timestamp;
      setRawVizData(prev => {
        const existing = since ? prev : [];
        const merged = [...existing, ...result.data];
        return merged.length > MAX_POINTS ? merged.slice(-MAX_POINTS) : merged;
      });
      setLivePollError(null);
    } catch (e) {
      if (isRequestAborted(e)) return;
      setLivePollError(vizErrorMessage(e, t('viz.livePollError')));
    } finally {
      if (liveAbortRef.current === controller) {
        liveAbortRef.current = null;
      }
    }
  }, [selectedBoard, t]);

  const stopLive = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
  }, []);

  const startLive = useCallback(async () => {
    stopLive();
    lastTimestampRef.current = null;
    await fetchAll();
    pollTimerRef.current = setInterval(() => { appendLive(); }, POLL_INTERVAL);
  }, [fetchAll, appendLive, stopLive]);

  useEffect(() => {
    if (liveMode) {
      startLive();
    } else {
      stopLive();
      setLivePollError(null);
    }
    return stopLive;
  }, [liveMode, startLive, stopLive]);

  useEffect(() => {
    if (!liveMode || !selectedBoard) return;
    const range = buildSpectrumRange();
    void fetchSpectrum(selectedBoard, range?.start, range?.end);
    const timer = setInterval(() => {
      if (!selectedBoard) return;
      const r = buildSpectrumRange();
      void fetchSpectrum(selectedBoard, r?.start, r?.end);
    }, 30000);
    return () => clearInterval(timer);
  }, [liveMode, selectedBoard, fetchSpectrum, buildSpectrumRange]);

  useEffect(() => () => {
    overviewAbortRef.current?.abort();
    detailAbortRef.current?.abort();
    liveAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!selectedBoard) {
      setBoardProtocol(null);
      return;
    }
    const board = boards.find(b => b.id === selectedBoard);
    if (!board?.protocol_id) {
      setBoardProtocol(null);
      return;
    }
    api.protocols.get(board.protocol_id).then(setBoardProtocol).catch(() => setBoardProtocol(null));
  }, [selectedBoard, boards]);

  const existingFieldLabels = useMemo(
    () => new Set(items.map(i => i.label)),
    [items],
  );

  const protocolFieldPaths = useMemo(
    () => collectParseRuleFieldPaths(boardProtocol?.parse_rules),
    [boardProtocol],
  );

  const addAllFields = () => {
    if (!boardProtocol) return;
    const usedShortLabels = new Set(items.map(i => chartLabel(i)));
    const newItems = protocolFieldPaths
      .filter(name => !existingFieldLabels.has(name))
      .map((name, i) => ({
        ...makeItem(boardProtocol.id, name, items.length + i, usedShortLabels),
        visible: i < 5,
      }));
    if (newItems.length) setItems(prev => [...prev, ...newItems]);
  };

  const availableFields = useMemo(
    () => protocolFieldPaths.filter(name => !existingFieldLabels.has(name)),
    [protocolFieldPaths, existingFieldLabels],
  );

  const addField = useCallback((fieldName: string) => {
    if (!boardProtocol || !fieldName) return;
    const usedShortLabels = new Set(items.map(i => chartLabel(i)));
    setItems(prev => [...prev, makeItem(boardProtocol.id, fieldName, prev.length, usedShortLabels)]);
    setAddFieldPick('');
  }, [boardProtocol, items]);

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
      setProfileError(t('viz.profileError.noBoard'));
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileError(t('viz.profileError.noName'));
      return false;
    }
    if (items.length === 0) {
      setProfileError(t('viz.profileError.noItems'));
      return false;
    }

    const existing = profiles.find(p => p.name === trimmed);
    if (!existing && profiles.length >= MAX_PROFILES) {
      setProfileError(t('viz.profileError.maxProfiles', { max: MAX_PROFILES }));
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
      setProfileError(vizErrorMessage(e, t('viz.profileError.saveFailed')));
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
      setProfileError(vizErrorMessage(e, t('viz.profileError.deleteFailed')));
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
    const startTs = chartZoom.startTs ?? chartData[start]?.timeKey;
    const endTs = chartZoom.endTs ?? chartData[end]?.timeKey;
    if (!startTs || !endTs) return null;

    const fullSpan = fullChartTimeSpan(chartData);
    const startMs = Date.parse(startTs);
    const endMs = Date.parse(endTs);
    if (
      fullSpan
      && Number.isFinite(startMs)
      && Number.isFinite(endMs)
      && isFullChartTimeRange({ startMs, endMs }, fullSpan.startMs, fullSpan.endMs)
    ) {
      return null;
    }
    if (!fullSpan && end - start + 1 >= chartData.length) return null;

    return { start, end, startTs, endTs, timeKey: `${startTs}:${endTs}` };
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

    const { startTs, endTs } = zoomWindow;
    const cacheKey = buildDetailCacheKey(selectedBoard, startTs, endTs, itemQueryKey);
    const cached = detailCacheRef.current.get(cacheKey);

    const zoomStartMs = Date.parse(startTs);
    const zoomEndMs = Date.parse(endTs);
    const fullStartMs = chartData.length > 0 ? Date.parse(chartData[0].timeKey) : 0;
    const fullEndMs = chartData.length > 0 ? Date.parse(chartData[chartData.length - 1].timeKey) : 0;
    const zoomSpanMs = Math.max(1, zoomEndMs - zoomStartMs);
    const fullSpanMs = Math.max(1, fullEndMs - fullStartMs);
    const zoomRatio = fullSpanMs / zoomSpanMs;
    const detailLimit = Math.min(50000, Math.max(MAX_POINTS, Math.round(MAX_POINTS * zoomRatio)));

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
      if (
        !currentZoom.startTs
        || !currentZoom.endTs
        || currentZoom.startTs !== startTs
        || currentZoom.endTs !== endTs
      ) return;

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
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      void (async () => {
        try {
          const result = await api.viz.queryItems({
            board_id: selectedBoard,
            items: itemsForDataQuery(itemsRef.current),
            time_range: { start: startTs, end: endTs },
            limit: detailLimit,
          }, { signal: controller.signal, timeoutMs: 30000 });
          if (controller.signal.aborted) return;
          if (detailFetchSeqRef.current !== seq) return;
          applyDetail(result.data, result.meta ?? null, false);
        } catch (e) {
          if (isRequestAborted(e)) return;
          if (detailFetchSeqRef.current !== seq) return;
          if (!cached) {
            setDetailRawVizData(null);
            setDetailQueryMeta(null);
          }
        } finally {
          if (detailAbortRef.current === controller) {
            detailAbortRef.current = null;
          }
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
      detailAbortRef.current?.abort();
      detailAbortRef.current = null;
    };
  }, [zoomWindow, liveMode, selectedBoard, itemQueryKey, inMemoryFull]);

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

  const rawValuesSource = useMemo(() => {
    if (inMemoryFull) return rawVizData;
    return displayRawVizData;
  }, [inMemoryFull, rawVizData, displayRawVizData]);

  const rawValuesByTimeKey = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const row of rawValuesSource) {
      map.set(row.timestamp, row.values);
    }
    return map;
  }, [rawValuesSource]);

  const rawValuesIndexByTimeKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < rawValuesSource.length; i++) {
      map.set(rawValuesSource[i].timestamp, i);
    }
    return map;
  }, [rawValuesSource]);

  const canvasChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (inMemoryFull) return chartData;
    if (!zoomWindow) return chartData;
    if (detailChartData && detailChartData.length > 0 && !detailLoading && !isChartPanning) {
      return detailChartData;
    }
    return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
  }, [chartData, inMemoryFull, zoomWindow, detailChartData, detailLoading, isChartPanning]);

  /**
   * Session boundaries for overlay + line gaps — always from the full loaded overview
   * timeline. Never recomputed from detail zoom (that made markers vanish on detail load).
   */
  const sessionBreakTimesSec = useMemo(() => {
    if (rawVizData.length >= 2 && (inMemoryFull || !queryMeta?.downsampled)) {
      return findSessionBreakTimesSec(rawVizData.map(r => r.timestamp));
    }
    if (sessionPresence?.present.length && sessionPresence.start && sessionPresence.end) {
      return findSessionBreakTimesFromSpectrum(
        sessionPresence.start,
        sessionPresence.end,
        sessionPresence.present,
      );
    }
    return [];
  }, [rawVizData, inMemoryFull, queryMeta?.downsampled, sessionPresence]);

  const chartTimelineKey = chartData.length >= 2
    ? `${chartData.length}:${chartData[0].timeKey}:${chartData[chartData.length - 1].timeKey}`
    : '';

  /** Spectrum presence for downsampled overview — fixed to full chart span, not zoom/detail. */
  const sessionPresenceExtent = useMemo(() => {
    if (!selectedBoard || inMemoryFull || !queryMeta?.downsampled) return null;
    if (chartData.length < 2) return null;
    return {
      boardId: selectedBoard,
      start: chartData[0].timeKey,
      end: chartData[chartData.length - 1].timeKey,
    };
  }, [selectedBoard, inMemoryFull, queryMeta?.downsampled, chartTimelineKey]);

  const sessionPresenceExtentKey = sessionPresenceExtent
    ? `${sessionPresenceExtent.boardId}|${sessionPresenceExtent.start}|${sessionPresenceExtent.end}`
    : '';

  useEffect(() => {
    if (!sessionPresenceExtent) {
      setSessionPresence(null);
      return;
    }
    const { boardId, start, end } = sessionPresenceExtent;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }

    let cancelled = false;
    const bins = spectrumBinsForSessionGaps(endMs - startMs);
    void api.viz.spectrum(
      { board_id: boardId, start, end, bins },
      { timeoutMs: 20000 },
    ).then(res => {
      if (cancelled || res.bins <= 0) return;
      setSessionPresence({ start: res.start, end: res.end, present: res.present });
    }).catch(() => {
      /* keep previous sessionPresence on fetch failure */
    });

    return () => {
      cancelled = true;
    };
  }, [sessionPresenceExtentKey, sessionPresenceExtent]);

  renderChartDataLengthRef.current = chartData.length;
  renderChartPointsRef.current = chartData;

  const canvasWindowIndices = useMemo(
    () => (zoomWindow && inMemoryFull
      ? { start: zoomWindow.start, end: zoomWindow.end }
      : null),
    [zoomWindow?.start, zoomWindow?.end, inMemoryFull],
  );

  const canvasXWindowTimeKeys = useMemo(
    () => (zoomWindow && !inMemoryFull
      ? { start: zoomWindow.startTs, end: zoomWindow.endTs }
      : null),
    [zoomWindow?.startTs, zoomWindow?.endTs, inMemoryFull],
  );

  const resolveCanvasYScale = useCallback((item: VizItem) => (
    item.y_axis.id === SECONDARY_Y_AXIS_ID ? 'y2' : 'y'
  ), []);

  const chartInteractionHidden = isChartPanning || isChartSelecting || isChartMeasuring;

  const chartZoomActive = zoomWindow != null;

  const chartNavigatorWindow = useMemo(() => {
    if (chartData.length <= 1) return null;
    if (chartZoomActive && chartZoom) {
      return {
        start: chartZoom.start,
        end: chartZoom.end,
        startTs: chartZoom.startTs,
        endTs: chartZoom.endTs,
      };
    }
    return { start: 0, end: chartData.length - 1 };
  }, [chartData.length, chartZoomActive, chartZoom]);

  const allRangeGuideCopy = useMemo(
    () => (allRangeGuide ? buildAllRangeGuideCopy(allRangeGuide, t) : null),
    [allRangeGuide, t],
  );

  const chartEmptyMessage = useMemo(() => {
    if (loading && rawVizData.length === 0) return t('common.loading');
    if (!selectedBoard) return t('viz.noBoardSelected');
    if (!items.length) return t('viz.noItemsConfigured');
    if (rawVizData.length === 0) return t('viz.noChartData');
    return null;
  }, [loading, rawVizData.length, selectedBoard, items.length, t]);

  const chartSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(t('viz.summary.points', {
      count: (zoomWindow && detailChartData?.length
        ? detailChartData.length
        : canvasChartData.length
      ).toLocaleString(),
    }));
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
    zoomWindow,
    detailChartData,
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
    const idx = rawValuesIndexByTimeKey.get(hoverTimeKey) ?? -1;
    if (idx <= 0) return undefined;
    return rawValuesSource[idx - 1]?.timestamp;
  }, [hoverTimeKey, rawValuesIndexByTimeKey, rawValuesSource]);

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

  const setFieldValuesLayoutPersisted = useCallback((layout: FieldValuesLayout) => {
    setFieldValuesLayout(layout);
    try {
      localStorage.setItem(FIELD_VALUES_LAYOUT_KEY, layout);
    } catch {
      /* ignore */
    }
  }, []);

  const handleChartHoverTimeKey = useCallback((timeKey: string | null) => {
    if (isChartPanning || isChartSelecting || isChartMeasuring) return;
    if (timeKey == null) return;
    setHoverTimeKey(timeKey);
  }, [isChartPanning, isChartSelecting, isChartMeasuring]);

  const handleChartPlotBoundsChange = useCallback((bounds: { left: number; width: number }) => {
    chartPlotBoundsRef.current = bounds;
  }, []);

  const yAxisOptions = useMemo(() => PRESET_Y_AXES.map(axis => axis.id), []);

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
    const leftItems = activeChartItems.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
    const rightItems = activeChartItems.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);

    return {
      [PRIMARY_Y_AXIS_ID]: computeYAxisDomain(chartData, leftItems),
      [SECONDARY_Y_AXIS_ID]: computeYAxisDomain(chartData, rightItems),
    } as Record<string, [number, number] | undefined>;
  }, [chartData, activeChartItems]);

  const canvasYAxisDomains = useMemo(() => ({
    y: chartYAxisDomains[PRIMARY_Y_AXIS_ID],
    y2: chartYAxisDomains[SECONDARY_Y_AXIS_ID],
  }), [chartYAxisDomains]);

  const sparkValueMax = useMemo(() => {
    const domain = chartYAxisDomains[PRIMARY_Y_AXIS_ID];
    return domain?.[1];
  }, [chartYAxisDomains]);

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
    if (!statsOpen) return {} as Record<string, Statistics>;
    const stats: Record<string, Statistics> = {};
    for (const item of visibleItems) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      let last: number | string = '';

      for (const row of displayRawVizData) {
        const raw = row.values[item.label];
        if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
        const value = applyItemTransform(raw, item);
        if (value < min) min = value;
        if (value > max) max = value;
        sum += value;
        count += 1;
        last = value;
      }

      if (!Number.isFinite(min) || !Number.isFinite(max) || count === 0) continue;
      stats[item.label] = {
        min,
        max,
        avg: sum / count,
        count,
        last,
      };
    }
    return stats;
  }, [statsOpen, visibleItems, displayRawVizData]);

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
            disabled={false}
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
                  <DateRangePicker
                    start={customStart}
                    end={customEnd}
                    disabled={liveMode}
                    onChange={(s, e) => {
                      setCustomStart(s);
                      setCustomEnd(e);
                      setChartQueryTimeRange(null);
                      setSpectrumSel(null);
                      spectrumSelRef.current = null;
                      setTimeRangePresetId(TIME_PRESET_ALL);
                      setAllRangeGuide(null);
                    }}
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
                  {liveMode && livePollError && (
                    <p className="viz-live-poll-error" role="alert">
                      {livePollError}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {(timeSpectrumCells || spectrumLoading) && (
              <div
                ref={spectrumTrackRef}
                className={`viz-time-spectrum${spectrumLoading ? ' is-loading' : ''}${spectrumSel ? ' has-selection' : ''}`}
                onPointerDown={e => {
                  if (e.button !== 0 || !spectrum) return;
                  const bins = spectrum.present.length;
                  if (bins <= 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const index = Math.min(bins - 1, Math.floor(ratio * bins));
                  spectrumDragRef.current = { pointerId: e.pointerId, startIndex: index };
                  spectrumSelRef.current = { start: index, end: index };
                  setSpectrumSel({ start: index, end: index });
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                title={t('viz.spectrumHint')}
              >
                {timeSpectrumCells ? (
                  timeSpectrumCells.map((present, i) => (
                    <span
                      key={i}
                      className={`viz-time-spectrum-cell${present ? ' is-present' : ''}`}
                    />
                  ))
                ) : (
                  <span className="viz-time-spectrum-loading" />
                )}
                {spectrumSel && spectrum && !spectrumLoading && (
                  <span
                    className="viz-time-spectrum-select"
                    style={{
                      left: `${(spectrumSel.start / spectrum.present.length) * 100}%`,
                      width: `${((spectrumSel.end - spectrumSel.start + 1) / spectrum.present.length) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="viz-config-row viz-config-row-items">
          <div className="viz-items-header">
            <div className="viz-items-header-left">
              <div className="viz-config-row-title">
                {t('viz.items')}
                <span className="tag tag-subtle">{items.length}</span>
              </div>
              <button type="button" className="btn-sm" onClick={addAllFields} disabled={!boardProtocol}>
                {t('viz.addAllFields')}
              </button>
              <div className="viz-add-field-group">
                <select
                  value={addFieldPick}
                  onChange={e => setAddFieldPick(e.target.value)}
                  disabled={!boardProtocol || availableFields.length === 0}
                  aria-label={t('viz.addField')}
                >
                  <option value="">{t('viz.addField')}</option>
                  {availableFields.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => addField(addFieldPick)}
                  disabled={!addFieldPick}
                >
                  +
                </button>
              </div>
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
                <th>{t('viz.yMin')}</th>
                <th>{t('viz.yMax')}</th>
                <th>{t('viz.offset')}</th>
                <th>{t('viz.weight')}</th>
                <th>{t('viz.color')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={12} className="viz-items-empty">
                    {t('viz.noItems')}
                  </td>
                </tr>
              )}
              {items.length > 0 && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={12} className="viz-items-empty">
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
                    <select
                      value={item.y_axis.id === SECONDARY_Y_AXIS_ID ? SECONDARY_Y_AXIS_ID : PRIMARY_Y_AXIS_ID}
                      onChange={e => {
                        const preset = PRESET_Y_AXES.find(a => a.id === e.target.value) ?? PRESET_Y_AXES[0];
                        updateItem(item.id, 'y_axis', {
                          ...item.y_axis,
                          id: preset.id,
                          label: preset.label,
                        } as YAxisConfig);
                      }}
                    >
                      {yAxisOptions.map(yId => (
                        <option key={yId} value={yId}>{yAxisOptionLabel(yId, t)}</option>
                      ))}
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
                    <input
                      type="text"
                      inputMode="decimal"
                      className="viz-item-numeric-input"
                      value={item.y_axis.min ?? ''}
                      placeholder="—"
                      aria-label={t('viz.yMinAria', { label: item.label })}
                      style={{ width: 48 }}
                      onChange={e => updateItem(item.id, 'y_axis', {
                        ...item.y_axis,
                        min: parseOptionalNumber(e.target.value),
                      } as YAxisConfig)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="viz-item-numeric-input"
                      value={item.y_axis.max ?? ''}
                      placeholder="—"
                      aria-label={t('viz.yMaxAria', { label: item.label })}
                      style={{ width: 48 }}
                      onChange={e => updateItem(item.id, 'y_axis', {
                        ...item.y_axis,
                        max: parseOptionalNumber(e.target.value),
                      } as YAxisConfig)}
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
        {queryError && (
          <div className="viz-status-banner viz-status-banner--error" role="alert">
            <div className="viz-status-banner-content">
              <strong className="viz-status-banner-title">{t('viz.queryErrorTitle')}</strong>
              <p className="viz-status-banner-message">{queryError}</p>
            </div>
            <div className="viz-status-banner-actions">
              <button
                type="button"
                className="btn-sm"
                onClick={() => void fetchAll()}
                disabled={loading || !selectedBoard || items.length === 0}
              >
                {t('viz.queryErrorRetry')}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={dismissQueryError}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
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
                disabled={displayChartData.length === 0}
                title={t('viz.zoomIn')}
                aria-label={t('viz.zoomIn')}
              >
                <IconZoomIn />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={() => zoomChartByFactor(1.25)}
                disabled={!chartZoomActive}
                title={t('viz.zoomOut')}
                aria-label={t('viz.zoomOut')}
              >
                <IconZoomOut />
              </button>
              <button
                type="button"
                className="viz-chart-icon-btn"
                onClick={resetChartZoom}
                disabled={!chartZoomActive}
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
                <div className="viz-chart-toolbar-sep" aria-hidden />
                <div
                  className="viz-chart-toolbar-group"
                  role="group"
                  aria-label={t('viz.valuePanel.layoutGroup')}
                >
                  <button
                    type="button"
                    className={`viz-chart-icon-btn${fieldValuesLayout === 'bottom' ? ' active' : ''}`}
                    onClick={() => setFieldValuesLayoutPersisted('bottom')}
                    title={t('viz.valuePanel.layoutBottom')}
                    aria-label={t('viz.valuePanel.layoutBottom')}
                    aria-pressed={fieldValuesLayout === 'bottom'}
                  >
                    <IconPanelBottom />
                  </button>
                  <button
                    type="button"
                    className={`viz-chart-icon-btn${fieldValuesLayout === 'left' ? ' active' : ''}`}
                    onClick={() => setFieldValuesLayoutPersisted('left')}
                    title={t('viz.valuePanel.layoutLeft')}
                    aria-label={t('viz.valuePanel.layoutLeft')}
                    aria-pressed={fieldValuesLayout === 'left'}
                  >
                    <IconPanelLeft />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="viz-chart-panel">
        <div className={`viz-chart-panel-layout${fieldValuesLayout === 'left' ? ' is-left' : ''}`}>
        <div className="viz-chart-main">
        <div
          ref={chartViewportRef}
          className={`viz-chart-viewport${isChartSelecting ? ' selecting' : ''}${isChartPanning ? ' panning' : ''}${isChartMeasuring ? ' measuring' : ''}${chartZoomActive ? ' zoomed' : ''}${liveMode ? ' live' : ''}`}
          role="application"
          tabIndex={0}
          aria-label={t('viz.chartKeyboard.region')}
          onKeyDown={handleChartViewportKeyDown}
          onDoubleClick={resetChartZoom}
        >
          {selectionOverlay.overlayNode}
          {timeMeasureOverlay.overlayNode}
          {canvasChartData.length > 0 && activeChartItems.length > 0 ? (
          <VizCanvasChart
            ref={chartCanvasRef}
            points={canvasChartData}
            sessionBreakTimesSec={sessionBreakTimesSec}
            fullTimeline={inMemoryFull && chartData.length > 0 ? chartData : undefined}
            windowIndices={canvasWindowIndices}
            xWindowTimeKeys={canvasXWindowTimeKeys}
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
          ) : chartEmptyMessage ? (
            <p className="viz-chart-empty muted">{chartEmptyMessage}</p>
          ) : null}
        </div>
        {chartNavigatorWindow && (
          <ChartZoomNavigator
            chartData={chartData}
            chartZoom={chartNavigatorWindow}
            sparkItemIds={activeChartItems.map(i => i.id)}
            sparkValueMax={sparkValueMax}
            formatTime={formatChartAxisTime}
            onWindowChange={applyChartZoomWindow}
            totalMatched={queryMeta?.total_matched}
            returned={queryMeta?.returned ?? chartData.length}
            downsampled={queryMeta?.downsampled}
          />
        )}
        </div>
        {items.length > 0 && canvasChartData.length > 0 && (
          <ChartSeriesGroup
            open={seriesValuesOpen}
            layout={fieldValuesLayout}
            timeKey={hoverTimeKey}
            formatTime={formatChartAxisTime}
            rows={cursorValueRows}
            onToggleVisibility={toggleVisibility}
            onToggleFavorite={toggleItemFavorite}
          />
        )}
        </div>
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
                  <th>{t('common.name')}</th>
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
