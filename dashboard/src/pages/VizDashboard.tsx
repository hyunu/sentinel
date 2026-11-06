/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization -- legacy imperative canvas + data-fetch effects */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec, VizProfile, VizItem, YAxisConfig, VizCommandEvent, VizCommandConfig, Session } from '../api';
import ChartZoomNavigator from '../components/ChartZoomNavigator';
import DateRangePicker from '../components/DateRangePicker';
import ChartHelpManual from '../components/ChartHelpManual';
import Modal from '../components/Modal';
import ChartSeriesGroup from '../components/ChartSeriesGroup';
import VizFieldPicker from '../components/VizFieldPicker';
import { buildCursorValueRows } from '../components/ChartCursorValues';
import VizCanvasChart, { type VizCanvasChartHandle } from '../components/VizCanvasChart';
import PageHeader from '../components/PageHeader';
import {
  IconFullscreen,
  IconFullscreenExit,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconDetailLoading,
  IconSearch,
  IconManual,
  IconTooltip,
  IconFieldValues,
  IconPanelBottom,
  IconPanelLeft,
} from '../components/ChartControlIcons';
import { formatDateOnly, formatChartAxisTime, formatDateTime, formatTimeInterval, parseDateOnly } from '../utils/date';
import { collectParseRuleFieldPaths } from '../lib/protocolFormat';
import {
  cancelChartZoomRaf,
  chartZoomEquals,
  createChartZoomCommitter,
  getChartTimeMsFromClientX,
  findNearestChartIndexForTimeMs,
  getChartPlotBoundsFromViewport,
  getChartPlotMetricsFromViewport,
  normalizeWheelDeltaY,
  syncChartZoomRef,
  wheelDeltaToZoomFactor,
  isWheelHorizontalPan,
  wheelFocusRatioFromClientX,
  findChartIndexLowerBoundForTimeMs,
  findChartIndexUpperBoundForTimeMs,
  useChartSelectionOverlay,
  useChartTimeMeasureOverlay,
  type ChartZoomRange,
} from '../lib/vizChartInteraction';
import {
  chartZoomRangeFromTimeMs,
  chartTimeMsToKey,
  computePanTimeRange,
  computeWheelZoomTimeRange,
  filterChartPointsByTimeRange,
  filterVizRowsByTimeRange,
  fullChartTimeSpan,
  isFullChartTimeRange,
  isEffectivelyFullChartViewport,
  minChartZoomSpanMs,
  resolveChartZoomTimeRange,
} from '../lib/vizChartZoomTime';
import { buildDetailCacheKey, VizDetailCache } from '../lib/vizDetailCache';
import {
  computeYAxisPanDomain,
  computeYAxisZoomDomain,
  isYAxisDomainZoomed,
  yAxisDragZoomFactor,
  type YAxisDomain,
  type YAxisScaleKey,
} from '../lib/vizChartYAxis';
import {
  assessAllTimeRangeLoad,
  estimateVizPayloadBytes,
  formatFullLoadBytes,
  CHART_MEMORY_BUDGET_BYTES,
  FULL_LOAD_BYTE_BUDGET,
  FULL_LOAD_CONCURRENCY,
  FULL_LOAD_MAX_POINTS,
  OVERVIEW_BUCKETS,
  OVERVIEW_SAMPLE_POINTS,
  PROGRESSIVE_MAX_PARTITIONS,
  PROGRESSIVE_PARTITION_ROWS,
  PROGRESSIVE_STRIPE_ROWS,
  shouldChunkedFullLoad,
  shouldFullLoadInMemory,
  type AllRangeLoadAssessment,
} from '../lib/vizFullLoad';
import {
  clampChartZoom,
  computeYAxisDomain,
  parseOptionalNumber,
  vizErrorMessage,
  yAxisOptionLabel,
  usesDigitalLane,
  computeAutoYLayout,
  vizChartValue,
  vizFidKey,
  formatVizActualValue,
  formatVizItemActualValue,
  resolveVizItemRawValue,
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
  resolveChartKeyboardAction,
  resolveVizPageKeyboardAction,
  shouldIgnoreVizKeyboardShortcut,
  type ChartKeyboardAction,
} from '../lib/vizChartKeyboard';
import { spectrumBinRangeToTimeRange } from '../lib/vizChartSpectrum';
import {
  liveFollowWindow,
  liveZoomSpanMs,
  mergeLiveRows,
  shouldFollowLiveTail,
  trimLiveRows,
} from '../lib/vizLiveTail';
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
const DETAIL_MAX_POINTS = 20_000;
const MAX_CHART_SERIES = 24;
const MAX_PROFILES = 20;
const POLL_INTERVAL = 3000;
const MIN_CHART_ZOOM_POINTS = 10;
/** Defer React zoom commit while panning/wheeling — canvas updates imperatively. */
const ZOOM_COMMIT_DEBOUNCE_MS = 64;
const DETAIL_FETCH_DEBOUNCE_MS = 250;
const VIEWPORT_FINISH_DEBOUNCE_MS = 48;
/** A wheel gesture ends after this quiet period when deciding whether a
 *  direction reversal is a new gesture or trackpad residual momentum. */
const WHEEL_GESTURE_QUIET_MS = 180;

type FieldValuesLayout = 'bottom' | 'left';
type AxisRange = { min: number; max: number };
type AxisRangeDraft = { auto: boolean; min: string; max: string };
const AXIS_RANGE_STORAGE_PREFIX = 'sentinel.viz.axis-range.';
const SHOW_COMMANDS_STORAGE_KEY = 'sentinel.viz.show-commands';

function normalizeAxisRange(range?: { min: number; max: number } | null): AxisRange | null {
  if (!range) return null;
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return null;
  if (range.max <= range.min) return null;
  return { min: range.min, max: range.max };
}

function axisRangeStorageKeyFor(id?: string | null): string {
  return `${AXIS_RANGE_STORAGE_PREFIX}${id ?? 'default'}`;
}
type ChartLoadProgress = {
  phase: 'overview' | 'full' | 'detail';
  /** Bytes downloaded in the current request/chunk. */
  loaded: number;
  /** Bytes expected for the current request/chunk. */
  total: number | null;
  /** Bytes accumulated across all completed chunks plus the current one. */
  overallLoaded: number;
  chunkIndex?: number;
  chunkCount?: number;
  /** Unique rows already merged (progressive loading). */
  rowsLoaded?: number;
  /** Total rows in the selected range. */
  rowsTotal?: number;
  /** Final completion signal; forces the bar to 100%. */
  done?: boolean;
};
const FIELD_VALUES_LAYOUT_KEY = 'sentinel-viz-field-values-layout';
const AI_CHART_STORAGE_KEY = 'sentinel.ai.chart';
const CONFIG_OPEN_STORAGE_KEY = 'sentinel.viz.config-open';

interface AIChartLink {
  board_id: string;
  protocol_id?: string;
  fields: string[];
  start: string;
  end: string;
  aggregation?: string;
  bucket_seconds?: number;
  title?: string;
}

function readConfigOpen(): boolean {
  try {
    const stored = localStorage.getItem(CONFIG_OPEN_STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

function readFieldValuesLayout(): FieldValuesLayout {
  try {
    const stored = localStorage.getItem(FIELD_VALUES_LAYOUT_KEY);
    if (stored === 'bottom' || stored === 'left') return stored;
  } catch {
    /* ignore */
  }
  return 'bottom';
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

function newVizItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.randomUUID is unavailable in non-secure contexts (plain HTTP LAN IP).
  return `viz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function makeItem(protoId: string, fieldName: string, idx: number, usedShortLabels: Set<string>): VizItem {
  return {
    id: newVizItemId(),
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
type VizValueDomain = { min: number; max: number };
type VizQueryMeta = {
  total_matched: number;
  returned: number;
  downsampled: boolean;
  /** Exact per-field min/max over the whole range (envelope responses). */
  domain?: Record<string, VizValueDomain>;
};

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

/** The preview only needs the series that can actually be drawn. */
function itemsForOverviewQuery(items: VizItem[]): VizItem[] {
  return itemsForDataQuery(items.filter(i => i.visible).slice(0, MAX_CHART_SERIES));
}

type VizQueryParams = {
  board_id: string;
  items: VizItem[];
  time_range?: { start: string; end: string };
  since?: string;
  aggregation?: 'avg' | 'min' | 'max';
  bucket_seconds?: number;
  sampling?: 'raw-sample' | 'envelope' | 'raw-page';
  buckets?: number;
  skip?: number;
};

type VizLoadProgressHandler = (progress: ChartLoadProgress) => void;
type VizDataHandler = (data: VizDataRow[], meta: VizQueryMeta) => void;

type VizPartition = { startMs: number; endMs: number };

/** Spread time-ordered partitions across the worker slots so each wave covers
 *  the whole range (0,6,12,... then 1,7,13,...) instead of filling the left
 *  side first when there are more partitions than concurrent requests. */
function interleaveVizTasks<T>(tasks: T[], workers: number): T[] {
  if (workers <= 1 || tasks.length <= workers) return tasks;
  const ordered: T[] = [];
  for (let offset = 0; offset < workers; offset += 1) {
    for (let i = offset; i < tasks.length; i += workers) {
      ordered.push(tasks[i]);
    }
  }
  return ordered;
}

/** Equal-row-count time partitions derived from the envelope timestamps. */
function buildVizPartitions(
  startMs: number,
  endMs: number,
  totalRows: number,
  overview: VizDataRow[],
): VizPartition[] {
  const count = Math.max(
    1,
    Math.min(
      PROGRESSIVE_MAX_PARTITIONS,
      Math.ceil(totalRows / PROGRESSIVE_PARTITION_ROWS),
    ),
  );
  if (count <= 1 || endMs <= startMs) return [{ startMs, endMs }];

  const times = Array.from(new Set(
    overview
      .map(row => Date.parse(row.timestamp))
      .filter(ms => Number.isFinite(ms) && ms >= startMs && ms <= endMs),
  )).sort((a, b) => a - b);

  const boundaries: number[] = [startMs];
  for (let i = 1; i < count; i += 1) {
    let candidate = startMs + (endMs - startMs) * i / count;
    if (times.length > 0) {
      const idx = Math.min(times.length - 1, Math.floor(times.length * i / count));
      if (Number.isFinite(times[idx])) candidate = times[idx];
    }
    const previous = boundaries[boundaries.length - 1];
    if (candidate <= previous) {
      candidate = previous + Math.max(1, (endMs - startMs) / (count * 10));
    }
    boundaries.push(Math.min(candidate, endMs));
  }
  boundaries.push(endMs);

  const partitions: VizPartition[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end > start) partitions.push({ startMs: start, endMs: end });
  }
  return partitions.length > 0 ? partitions : [{ startMs, endMs }];
}

/**
 * Loads the whole range in uniform refinement rounds. Every round requests the
 * same relative slice of every partition, so the chart gets denser everywhere
 * at once instead of filling left-to-right. The envelope rows from the preview
 * stay visible until the real rows replace them.
 */
async function queryFullDatasetProgressive(
  params: VizQueryParams,
  overview: VizDataRow[],
  meta: VizQueryMeta,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: VizLoadProgressHandler;
    onPartial?: VizDataHandler;
  },
): Promise<{ data: VizDataRow[]; meta: VizQueryMeta }> {
  const total = meta.total_matched;
  const range = params.time_range ?? (
    overview.length >= 2
      ? { start: overview[0].timestamp, end: overview[overview.length - 1].timestamp }
      : undefined
  );
  const startMs = range ? Date.parse(range.start) : NaN;
  const endMs = range ? Date.parse(range.end) : NaN;
  const requestTimeout = Math.max(options?.timeoutMs ?? 45000, 120000);

  if (!range || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    const full = await api.viz.queryItems({
      ...params,
      limit: Math.max(1, total),
    }, {
      signal: options?.signal,
      timeoutMs: requestTimeout,
      onProgress: (loaded, totalBytes) => options?.onProgress?.({
        phase: 'full',
        loaded,
        total: totalBytes,
        overallLoaded: loaded,
      }),
    });
    return { data: full.data, meta: full.meta ?? meta };
  }

  const partitions = buildVizPartitions(startMs, endMs, total, overview);
  const partitionRows = Math.max(1, Math.ceil(total / partitions.length));
  // Each request is one contiguous raw page. The whole range is transferred
  // exactly once; no bucket rounds and no second completion pass.
  const stripeRows = Math.min(
    PROGRESSIVE_STRIPE_ROWS,
    Math.max(200, Math.ceil(partitionRows / 6)),
  );
  const stripesPerPartition = Math.max(
    1,
    Math.ceil(partitionRows / stripeRows) + 1,
  );

  const realRows = new Map<string, VizDataRow>();
  const displayRows = new Map<string, VizDataRow>();
  for (const row of overview) displayRows.set(row.timestamp, row);
  const envelopeTimestamps = new Set(overview.map(row => row.timestamp));

  let receivedBytes = 0;
  let requestIndex = 0;
  let lastPublishMs = 0;
  let failed = false;

  const sortRows = (rows: VizDataRow[]) => rows.sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  const publish = (force: boolean, final = false) => {
    const now = Date.now();
    if (!force && now - lastPublishMs < 250) return;
    lastPublishMs = now;
    // Refresh the row-based progress with the latest unique-row count.
    reportProgress(0);
    if (options?.onPartial) {
      const rows = sortRows(
        Array.from(displayRows.values())
          .filter(row => !final || realRows.has(row.timestamp)),
      );
      options.onPartial(rows, {
        total_matched: total,
        returned: realRows.size,
        downsampled: realRows.size < total,
      });
    }
    if (final) {
      // Coalescing can leave fewer unique timestamps than total_matched.
      // Mark the run complete so the label/bar finish at 100%, not at 89%.
      options?.onProgress?.({
        phase: 'full',
        loaded: 0,
        total: null,
        overallLoaded: receivedBytes,
        rowsLoaded: total,
        rowsTotal: total,
        chunkIndex: partitions.length,
        chunkCount: partitions.length,
        done: true,
      });
    }
  };

  const reportProgress = (deltaBytes: number) => {
    receivedBytes += Math.max(0, deltaBytes);
    options?.onProgress?.({
      phase: 'full',
      loaded: deltaBytes,
      total: null,
      overallLoaded: receivedBytes,
      rowsLoaded: realRows.size,
      rowsTotal: total,
      chunkIndex: Math.min(requestIndex, partitions.length),
      chunkCount: partitions.length,
    });
  };

  const mergeRows = (rows: VizDataRow[]) => {
    let added = 0;
    for (const row of rows) {
      if (!realRows.has(row.timestamp)) added += 1;
      realRows.set(row.timestamp, row);
      displayRows.set(row.timestamp, row);
      envelopeTimestamps.delete(row.timestamp);
    }
    return added;
  };

  const fetchStripe = async (
    partition: VizPartition,
    skip: number,
    limit: number,
  ) => {
    if (options?.signal?.aborted) throw new Error('Request timeout or cancelled');
    requestIndex += 1;
    let lastLoaded = 0;
    const result = await api.viz.queryItems({
      ...params,
      time_range: {
        start: new Date(partition.startMs).toISOString(),
        end: new Date(partition.endMs).toISOString(),
      },
      limit,
      skip,
      sampling: 'raw-page',
    }, {
      signal: options?.signal,
      timeoutMs: requestTimeout,
      onProgress: loaded => {
        const delta = Math.max(0, loaded - lastLoaded);
        lastLoaded = Math.max(lastLoaded, loaded);
        reportProgress(delta);
      },
    });
    return result;
  };

  const runPool = async <T,>(
    tasks: T[],
    worker: (task: T) => Promise<void>,
  ) => {
    const workerCount = Math.min(FULL_LOAD_CONCURRENCY, tasks.length);
    const ordered = interleaveVizTasks(tasks, workerCount);
    let next = 0;
    const run = async () => {
      for (;;) {
        if (failed || options?.signal?.aborted) {
          throw new Error('Request timeout or cancelled');
        }
        const index = next;
        next += 1;
        if (index >= ordered.length) return;
        await worker(ordered[index]);
      }
    };
    try {
      await Promise.all(Array.from({ length: workerCount }, run));
    } catch (error) {
      failed = true;
      throw error;
    }
  };

  // Stripe-major task order: every wave covers the beginning, middle and end
  // of the range. Each (partition, stripe) page is downloaded exactly once.
  type StripeTask = { partition: VizPartition; partitionIndex: number; skip: number };
  const tasks: StripeTask[] = [];
  for (let stripe = 0; stripe < stripesPerPartition; stripe += 1) {
    for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1) {
      tasks.push({
        partition: partitions[partitionIndex],
        partitionIndex,
        skip: stripe * stripeRows,
      });
    }
  }

  // Fetch every stripe. Pages beyond a partition's end are empty and cheap.
  // Do not infer "partition finished" from one page: workers can finish a
  // later stripe first and would skip the earlier ones, losing rows.
  await runPool(tasks, async task => {
    const result = await fetchStripe(task.partition, task.skip, stripeRows);
    mergeRows(result.data);
    publish(false);
  });

  publish(true, true);

  return {
    data: sortRows(Array.from(realRows.values())),
    meta: {
      total_matched: total,
      returned: realRows.size,
      // The completion pass requested every row in the range. Coalescing may
      // merge a few timestamps, but the chart is no longer a sampled preview.
      downsampled: false,
    },
  };
}

async function queryVizDataset(
  params: VizQueryParams,
  options?: {
    assessAllRange?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: VizLoadProgressHandler;
    onOverview?: (
      data: VizDataRow[],
      meta: VizQueryMeta | null,
      willLoadFull: boolean,
      envelope: boolean,
    ) => void;
    onPartial?: VizDataHandler;
    /** Preview only these series. Defaults to params.items. */
    overviewItems?: VizItem[];
    /** Skip the raw full load even when the row count would allow it. */
    forceSample?: boolean;
  },
): Promise<{
  data: VizDataRow[];
  meta: VizQueryMeta | null;
  inMemoryFull: boolean;
  allRangeAssessment: AllRangeLoadAssessment | null;
}> {
  const overviewParams: VizQueryParams = options?.overviewItems
    ? { ...params, items: options.overviewItems }
    : params;
  const overview = await api.viz.queryItems(
    {
      ...overviewParams,
      limit: OVERVIEW_SAMPLE_POINTS,
      sampling: 'envelope',
      buckets: OVERVIEW_BUCKETS,
    },
    {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      onProgress: (loaded, total) => options?.onProgress?.({
        phase: 'overview',
        loaded,
        total,
        overallLoaded: loaded,
      }),
    },
  );
  const meta = overview.meta ?? null;
  const allRangeAssessment = options?.assessAllRange
    ? assessAllTimeRangeLoad(meta, overview.data)
    : null;
  const willLoadFull = !options?.forceSample
    && !!meta
    && (shouldFullLoadInMemory(meta, overview.data) || shouldChunkedFullLoad(meta));

  if (!willLoadFull) {
    if (meta?.downsampled) {
      // Heavy ranges stay sampled. Envelope rows are synthetic per-field
      // min/max, so fetch actual samples for the final view.
      const real = await api.viz.queryItems(
        { ...params, limit: OVERVIEW_SAMPLE_POINTS, sampling: 'raw-sample' },
        {
          signal: options?.signal,
          timeoutMs: options?.timeoutMs,
        },
      );
      const realMeta = real.meta ?? meta;
      options?.onOverview?.(real.data, realMeta, false, false);
      return {
        data: real.data,
        meta: realMeta,
        inMemoryFull: !!realMeta && !realMeta.downsampled,
        allRangeAssessment,
      };
    }
    options?.onOverview?.(overview.data, meta, false, false);
    return {
      data: overview.data,
      meta,
      inMemoryFull: !!meta && !meta.downsampled,
      allRangeAssessment,
    };
  }

  options?.onOverview?.(overview.data, meta, true, true);
  const full = await queryFullDatasetProgressive(params, overview.data, meta, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    onProgress: options?.onProgress,
    onPartial: options?.onPartial,
  });
  return {
    data: full.data,
    meta: full.meta,
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
        // Digital signals stay 0/1 in lanes; on the Y axis they use
        // offset/weight so profiles can space them out.
        point[item.id] = vizChartValue(raw, item);
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

interface VizOptionalNumberInputProps {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  width?: number;
  ariaLabel: string;
}

// Optional numeric input (Y min/max). Keeps the raw draft while editing so a
// leading '-' survives until commit, and only notifies the parent on blur/Enter.
// Committing per keystroke re-rendered all profile items and rebuilt the chart
// data, which made the whole table feel laggy.
function VizOptionalNumberInput({
  value,
  onCommit,
  width = 48,
  ariaLabel,
}: VizOptionalNumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <input
      type="text"
      inputMode="decimal"
      className="viz-item-numeric-input"
      value={editing ? draft : value ?? ''}
      placeholder="—"
      aria-label={ariaLabel}
      style={{ width }}
      onFocus={() => {
        setDraft(value == null ? '' : String(value));
        setEditing(true);
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => {
        setEditing(false);
        onCommit(parseOptionalNumber(e.target.value));
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
  const [aiChartLink, setAiChartLink] = useState<AIChartLink | null>(null);
  const aiChartLinkConsumedRef = useRef(false);
  const aiChartLinkAppliedRef = useRef(false);
  const [boardProtocol, setBoardProtocol] = useState<ProtocolSpec | null>(null);
  const [items, setItems] = useState<VizItem[]>([]);
  // Data identity for the detail cache. Visibility/offset/weight only affect
  // rendering, so toggling them must not throw away cached detail series.
  const itemDataKey = useMemo(
    () => items
      .map(i => `${i.id}:${i.label}:${i.field_ref.protocol_id}:${i.field_ref.field_name}`)
      .join('|'),
    [items],
  );
  const liveFieldsKey = useMemo(
    () => items
      .map(i => `${i.field_ref.protocol_id}\0${i.field_ref.field_name}`)
      .sort()
      .join('|'),
    [items],
  );
  const itemTransformKey = useMemo(
    () => items.map(i => `${i.id}:${i.label}:${i.visible}:${i.offset}:${i.weight}`).join('|'),
    [items],
  );
  const aiAggregationParams = useMemo<{ aggregation?: 'avg' | 'min' | 'max'; bucket_seconds?: number }>(() => {
    const aggregation = aiChartLink?.aggregation;
    if (aggregation === 'avg' || aggregation === 'min' || aggregation === 'max') {
      return { aggregation, bucket_seconds: aiChartLink?.bucket_seconds };
    }
    return {};
  }, [aiChartLink]);
  const [rawVizData, setRawVizData] = useState<VizDataRow[]>([]);
  /** Bumped only when a new query starts, never on progressive row updates. */
  const [queryResetEpoch, setQueryResetEpoch] = useState(0);
  // The chart layer only needs the visible series that can actually be drawn.
  // Field values still read the full raw rows, including hidden series.
  const chartSeriesItems = useMemo(
    () => items.filter(i => i.visible).slice(0, MAX_CHART_SERIES),
    [items],
  );
  const chartData = useMemo(
    () => toChartPoints(rawVizData, chartSeriesItems),
    [rawVizData, chartSeriesItems],
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
  const [isChartYZooming, setIsChartYZooming] = useState(false);
  /** Y축이 수동으로 줌된 상태 — 커서/리셋 버튼 표시에 사용. */
  const [yAxisZoomed, setYAxisZoomed] = useState(false);
  const [profiles, setProfiles] = useState<VizProfile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [savedProfileId, setSavedProfileId] = useState<string | null>(null);
  const [axisRangeOpen, setAxisRangeOpen] = useState(false);
  const [axisRangeLeft, setAxisRangeLeft] = useState<AxisRange | null>(null);
  const [axisRangeRight, setAxisRangeRight] = useState<AxisRange | null>(null);
  const [axisRangeDraft, setAxisRangeDraft] = useState<{
    left: AxisRangeDraft;
    right: AxisRangeDraft;
  }>({
    left: { auto: true, min: '', max: '' },
    right: { auto: true, min: '', max: '' },
  });
  const [axisRangeError, setAxisRangeError] = useState('');
  const [timeRangePresetId, setTimeRangePresetId] = useState<TimePresetId>(TIME_PRESET_ALL);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  /** Exact chart query range from spectrum drag — preserved separately from date-only custom range. */
  const [chartQueryTimeRange, setChartQueryTimeRange] = useState<{ start: string; end: string } | null>(null);
  const [spectrum, setSpectrum] = useState<{
    present: boolean[];
    counts: number[];
    start: string;
    end: string;
  } | null>(null);
  const [spectrumLoading, setSpectrumLoading] = useState(false);
  const [spectrumSel, setSpectrumSel] = useState<{ start: number; end: number } | null>(null);
  const spectrumSelRef = useRef<{ start: number; end: number } | null>(null);
  const applySpectrumSelectionRef = useRef<((start: number, end: number) => void) | null>(null);
  const spectrumDragRef = useRef<{ pointerId: number; startIndex: number } | null>(null);
  const spectrumTrackRef = useRef<HTMLDivElement | null>(null);
  /** After spectrum-driven query, fit the chart viewport to this time span. */
  const pendingSpectrumViewportRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingRoughData, setAwaitingRoughData] = useState(false);
  const [chartLoadProgress, setChartLoadProgress] = useState<ChartLoadProgress | null>(null);
  const [fullLoadBytesEstimate, setFullLoadBytesEstimate] = useState<number | null>(null);
  /** Keep the 100% bar visible briefly after the final row arrives. */
  const loadCompletedRef = useRef(false);
  const progressClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A full-range query is running; detail fetches must not replace its bar. */
  const globalLoadActiveRef = useRef(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [livePollError, setLivePollError] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [chartTooltipEnabled, setChartTooltipEnabled] = useState(true);
  const [commandEvents, setCommandEvents] = useState<VizCommandEvent[]>([]);
  const [showCommands, setShowCommands] = useState(() => {
    try {
      return localStorage.getItem(SHOW_COMMANDS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_COMMANDS_STORAGE_KEY, showCommands ? '1' : '0');
    } catch {
      /* ignore storage failures */
    }
  }, [showCommands]);
  const [eventConfig, setEventConfig] = useState<VizCommandConfig[]>([]);
  const [eventOverrides, setEventOverrides] = useState<Record<string, { type?: string; visible?: boolean }>>({});
  const [eventSettingsOpen, setEventSettingsOpen] = useState(false);
  const [seriesValuesOpen, setSeriesValuesOpen] = useState(true);
  const [fieldValuesLayout, setFieldValuesLayout] = useState<FieldValuesLayout>(readFieldValuesLayout);
  const [hoverTimeKey, setHoverTimeKey] = useState<string | null>(null);
  const hoverCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoverCommitRef = useRef(0);
  const [queryMeta, setQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailRawVizData, setDetailRawVizData] = useState<VizDataRow[] | null>(null);
  const [detailQueryMeta, setDetailQueryMeta] = useState<VizQueryMeta | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** startTs:endTs for the loaded detail series — must match zoomWindow to render detail. */
  const [detailWindowKey, setDetailWindowKey] = useState<string | null>(null);
  const [sessionPresence, setSessionPresence] = useState<{
    start: string;
    end: string;
    present: boolean[];
  } | null>(null);
  const [inMemoryFull, setInMemoryFull] = useState(false);
  /** Progressive full load is still filling the range in uniform rounds. */
  const [progressiveLoading, setProgressiveLoading] = useState(false);
  /** Y domains captured from the phase-1 envelope; kept fixed while detail loads. */
  const [frozenAxisDomains, setFrozenAxisDomains] = useState<{
    left?: [number, number];
    right?: [number, number];
  } | null>(null);
  const envelopeTimestampsRef = useRef<Set<string>>(new Set());
  globalLoadActiveRef.current = loading || progressiveLoading || awaitingRoughData;
  const [allRangeGuide, setAllRangeGuide] = useState<AllRangeLoadAssessment | null>(null);
  const detailFetchSeqRef = useRef(0);
  const detailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCacheRef = useRef(new VizDetailCache());
  /** Full detail chart points — retained across zoom changes for interim display. */
  const lastDetailCanvasPointsRef = useRef<ChartPoint[]>([]);
  const detailRawVizDataRef = useRef<VizDataRow[] | null>(null);
  detailRawVizDataRef.current = detailRawVizData;
  const overviewAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const [profileError, setProfileError] = useState('');
  const [autoLayoutNote, setAutoLayoutNote] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [fieldTooltip, setFieldTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(readConfigOpen);
  const toggleConfigOpen = useCallback(() => {
    setConfigOpen(open => {
      const next = !open;
      try {
        localStorage.setItem(CONFIG_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const [statsOpen, setStatsOpen] = useState(false);
  const [itemFieldSearch, setItemFieldSearch] = useState('');
  const [itemFieldSearchOpen, setItemFieldSearchOpen] = useState(false);
  const [checkedOnly, setCheckedOnly] = useState(false);
  const itemFieldSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [chartManualOpen, setChartManualOpen] = useState(false);
  const [chartViewportHeight, setChartViewportHeight] = useState(600);
  const lastTimestampRef = useRef<string | null>(null);
  const liveFollowRef = useRef(true);
  const liveSpanMsRef = useRef<number | null>(null);
  const reloadLiveTailRef = useRef<() => Promise<void>>(async () => {});
  const autoQueryRef = useRef<() => void>(() => {});
  const autoQueryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const chartCanvasRef = useRef<VizCanvasChartHandle | null>(null);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const chartZoomRef = useRef<ChartZoomRange | null>(chartZoom);
  // Do not assign chartZoomRef.current on every render. Interaction code updates
  // it imperatively during pan/wheel; an unrelated React render (hover, polling,
  // resize, etc.) must not snap the viewport back to the last committed state.
  useEffect(() => {
    chartZoomRef.current = chartZoom;
  }, [chartZoom]);
  const chartDataLengthRef = useRef(0);
  chartDataLengthRef.current = chartData.length;
  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;
  const panRafRef = useRef<number | null>(null);
  const pendingPanDeltaRef = useRef({ x: 0, y: 0 });
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    startY: number;
    /** Viewport at pointer-down. Pan deltas are applied to this fixed range,
     *  not to the previous animation frame (which double-counted movement). */
    baseStartMs: number;
    baseEndMs: number;
    /** X축이 줌된 상태에서만 좌우 팬. */
    panX: boolean;
    /** Y축이 줌된 상태에서만 상하 팬. 축별 기준 구간. */
    baseY: Partial<Record<YAxisScaleKey, YAxisDomain>>;
    panY: boolean;
  } | null>(null);
  /** Y축 거터 드래그 줌 세션. */
  const yZoomSessionRef = useRef<{
    pointerId: number;
    scale: YAxisScaleKey;
    startY: number;
    base: YAxisDomain;
    anchorValue: number;
  } | null>(null);
  const isChartYZoomingRef = useRef(false);
  isChartYZoomingRef.current = isChartYZooming;
  /** Wheel input is accumulated and applied once per animation frame. */
  const wheelRafRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{
    panDeltaX: number;
    zoomDeltaY: number;
    clientX: number;
  } | null>(null);
  /** Once a wheel gesture reaches full view, ignore its residual reverse
   *  momentum events; otherwise trackpad inertia can snap back to 80–90%. */
  const lastWheelEventAtRef = useRef(0);
  const fullResetDuringWheelGestureRef = useRef(false);
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
  /** Series actually requested for the phase-1 envelope (visible, drawable). */
  const overviewItemsRef = useRef<VizItem[]>([]);
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

  const flushChartZoomCommit = useCallback(() => {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    if (viewportFinishTimerRef.current) {
      clearTimeout(viewportFinishTimerRef.current);
      viewportFinishTimerRef.current = null;
    }
    chartCanvasRef.current?.syncViewportFinish();
    syncReactChartZoomFromRef();
  }, [syncReactChartZoomFromRef]);

  const flushChartZoomCommitRef = useRef(flushChartZoomCommit);
  flushChartZoomCommitRef.current = flushChartZoomCommit;

  const syncYAxisZoomedState = useCallback(() => {
    setYAxisZoomed(chartCanvasRef.current?.isYAxisZoomed() ?? false);
  }, []);

  const scheduleChartZoomCommitRef = useRef<() => void>(() => {});

  const scheduleViewportFinish = useCallback(() => {
    if (viewportFinishTimerRef.current) clearTimeout(viewportFinishTimerRef.current);
    viewportFinishTimerRef.current = setTimeout(() => {
      viewportFinishTimerRef.current = null;
      // Keep Y/overlays stable while the user is actively dragging. The
      // pointer-up path flushes the final viewport explicitly.
      if (panSessionRef.current) return;
      chartCanvasRef.current?.syncViewportFinish();
    }, VIEWPORT_FINISH_DEBOUNCE_MS);
  }, []);

  const scheduleViewportFinishRef = useRef(scheduleViewportFinish);
  scheduleViewportFinishRef.current = scheduleViewportFinish;

  const updateLiveFollowFromZoom = useCallback((range: ChartZoomRange | null) => {
    if (!liveModeRef.current) return;
    const data = chartDataRef.current;
    const full = fullChartTimeSpan(data);
    if (!full) {
      liveFollowRef.current = true;
      return;
    }
    const current = resolveChartZoomTimeRange(data, range, data.length);
    if (!current || isFullChartTimeRange(current, full.startMs, full.endMs)) {
      liveFollowRef.current = true;
      liveSpanMsRef.current = null;
      return;
    }
    liveSpanMsRef.current = liveZoomSpanMs(current);
    liveFollowRef.current = shouldFollowLiveTail(current, full.endMs);
  }, []);

  const resetToFullChartView = useCallback(() => {
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    chartZoomRef.current = null;
    setChartZoom(null);
    chartCanvasRef.current?.resetWindow();
    updateLiveFollowFromZoom(null);
  }, [updateLiveFollowFromZoom]);

  const resetToFullChartViewRef = useRef(resetToFullChartView);
  resetToFullChartViewRef.current = resetToFullChartView;

  const applyViewportTimeMsImmediate = useCallback((startMs: number, endMs: number) => {
    const data = chartDataRef.current;
    const len = chartDataLengthRef.current;
    const fullSpan = fullChartTimeSpan(data);
    if (!fullSpan || len === 0) return;

    if (isFullChartTimeRange({ startMs, endMs }, fullSpan.startMs, fullSpan.endMs)) {
      resetToFullChartView();
      flushChartZoomCommitRef.current();
      return;
    }

    const indexed = chartZoomRangeFromTimeMs(data, startMs, endMs, len);
    const nextRange: ChartZoomRange = {
      ...indexed,
      startTs: chartTimeMsToKey(startMs),
      endTs: chartTimeMsToKey(endMs),
    };
    chartZoomRef.current = nextRange;
    updateLiveFollowFromZoom(nextRange);
    chartCanvasRef.current?.setWindowByTimeMs(startMs, endMs, { syncY: false, lightweight: true });
    scheduleChartZoomCommitRef.current();
    scheduleViewportFinishRef.current();
  }, [updateLiveFollowFromZoom, resetToFullChartView]);

  const applyViewportTimeMsImmediateRef = useRef(applyViewportTimeMsImmediate);
  applyViewportTimeMsImmediateRef.current = applyViewportTimeMsImmediate;

  const fitPendingSpectrumViewport = useCallback(() => {
    const pending = pendingSpectrumViewportRef.current;
    if (!pending) return false;
    pendingSpectrumViewportRef.current = null;
    const canvas = chartCanvasRef.current;
    const len = chartDataLengthRef.current;
    if (!canvas || len === 0) return true;
    const fullSpan = fullChartTimeSpan(chartDataRef.current);
    if (fullSpan && !isFullChartTimeRange(pending, fullSpan.startMs, fullSpan.endMs)) {
      applyViewportTimeMsImmediateRef.current(pending.startMs, pending.endMs);
      return true;
    }
    canvas.resetWindow();
    return true;
  }, []);

  const scheduleSpectrumViewportFit = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitPendingSpectrumViewport());
    });
  }, [fitPendingSpectrumViewport]);

  const applyChartZoomRange = useCallback((range: ChartZoomRange) => {
    const len = chartDataLengthRef.current || chartData.length;
    const data = chartDataRef.current;
    if (len === 0) {
      syncChartZoomRef(chartZoomRef, null);
      setChartZoom(null);
      chartCanvasRef.current?.resetWindow();
      updateLiveFollowFromZoom(null);
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
        updateLiveFollowFromZoom(null);
        return;
      }
    } else {
      const clamped = clampChartZoom(range.start, range.end, len);
      if (clamped.end - clamped.start + 1 >= len) {
        syncChartZoomRef(chartZoomRef, null);
        setChartZoom(null);
        chartCanvasRef.current?.resetWindow();
        updateLiveFollowFromZoom(null);
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
    updateLiveFollowFromZoom(nextRange);

    if (inMemoryFullRef.current) {
      chartCanvasRef.current?.setWindowByIndex(nextRange.start, nextRange.end, { syncY: true });
    } else if (nextRange.startTs && nextRange.endTs) {
      chartCanvasRef.current?.setWindowByTimeKeys(nextRange.startTs, nextRange.endTs, { syncY: true });
    }
  }, [chartData.length, updateLiveFollowFromZoom]);

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
      updateLiveFollowFromZoom(null);
      flushChartZoomCommitRef.current();
      return;
    }

    chartZoomRef.current = nextRange;
    updateLiveFollowFromZoom(nextRange);
    if (inMemoryFullRef.current) {
      // Keep Y-scale computation out of the gesture loop. It is flushed once
      // when the viewport settles, same as the downsampled/detail path.
      chartCanvasRef.current?.setWindowByIndex(
        nextRange.start,
        nextRange.end,
        { syncY: false, lightweight: true },
      );
      scheduleViewportFinishRef.current();
    } else if (nextRange.startTs && nextRange.endTs) {
      const startMs = Date.parse(nextRange.startTs);
      const endMs = Date.parse(nextRange.endTs);
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        chartCanvasRef.current?.setWindowByTimeMs(startMs, endMs, { syncY: false, lightweight: true });
        scheduleViewportFinishRef.current();
      }
    }
    scheduleChartZoomCommitRef.current();
  }, [updateLiveFollowFromZoom]);

  useEffect(() => {
    scheduleChartZoomCommitRef.current = () => {
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = setTimeout(() => {
        zoomCommitTimerRef.current = null;
        // A slow drag must not commit a new React window (and start detail
        // fetches) halfway through the gesture. pointer-up flushes it.
        if (panSessionRef.current) return;
        syncReactChartZoomFromRef();
      }, ZOOM_COMMIT_DEBOUNCE_MS);
    };
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
    yZoomSessionRef.current = null;
    activeChartPointerRef.current = null;
    setIsChartYZooming(false);
    setYAxisZoomed(false);
    cancelChartZoomRaf(chartZoomRafRefs);
    chartCanvasRef.current?.resetYAxes();

    if (pendingSpectrumViewportRef.current) {
      scheduleSpectrumViewportFit();
    } else {
      requestAnimationFrame(() => chartCanvasRef.current?.resetWindow());
    }
    // Reset the viewport for a new query only. Progressive row updates must
    // not touch the zoom the user is analysing.
  }, [queryResetEpoch, selectionOverlay.hide, timeMeasureOverlay.hide, chartZoomRafRefs, scheduleSpectrumViewportFit]);

  useEffect(() => {
    if (hoverCommitTimerRef.current != null) {
      clearTimeout(hoverCommitTimerRef.current);
      hoverCommitTimerRef.current = null;
    }
    setHoverTimeKey(null);
  }, [queryResetEpoch]);

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

    if (document.fullscreenElement === el) {
      try {
        await document.exitFullscreen();
      } catch (e) {
        console.error(e);
        setChartFullscreen(false);
      }
      return;
    }

    if (chartFullscreen) {
      setChartFullscreen(false);
      return;
    }

    try {
      await el.requestFullscreen();
    } catch (e) {
      console.error(e);
      setChartFullscreen(true);
    }
  }, [chartFullscreen]);

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
    if (zoomCommitTimerRef.current) {
      clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
    if (viewportFinishTimerRef.current) {
      clearTimeout(viewportFinishTimerRef.current);
      viewportFinishTimerRef.current = null;
    }
    liveFollowRef.current = true;
    liveSpanMsRef.current = null;
    syncChartZoomRef(chartZoomRef, null);
    setChartZoom(null);
    chartCanvasRef.current?.resetWindow();
    chartCanvasRef.current?.resetYAxes();
    setYAxisZoomed(false);
    setDetailRawVizData(null);
    setDetailQueryMeta(null);
    setDetailLoading(false);
    setDetailWindowKey(null);
    detailFetchSeqRef.current += 1;
    lastDetailCanvasPointsRef.current = [];
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

  const panChartByKeyboard = useCallback((direction: -1 | 1, fast = false) => {
    if (chartData.length === 0) return;
    const zoom = chartZoom;
    const fullSpan = fullChartTimeSpan(chartData);
    if (!zoom || !fullSpan) return;
    const current = resolveChartZoomTimeRange(chartData, zoom, chartData.length);
    if (!current || isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs)) return;

    const plotWidth = chartCanvasRef.current?.getPlotClientMetrics()?.plotWidth
      ?? chartPlotBoundsRef.current.width;
    if (plotWidth <= 0) return;

    const panPx = fast ? CHART_KEYBOARD_PAN_PX * 4 : CHART_KEYBOARD_PAN_PX;
    const next = computePanTimeRange(
      current,
      direction * panPx,
      plotWidth,
      fullSpan.startMs,
      fullSpan.endMs,
    );
    applyChartZoomFromTimeMs(next.startMs, next.endMs);
  }, [applyChartZoomFromTimeMs, chartData, chartZoom]);

  const cancelChartInteraction = useCallback(() => {
    let cancelled = false;
    if (isChartSelectingRef.current || isChartSelecting) {
      isChartSelectingRef.current = false;
      setIsChartSelecting(false);
      selectionOverlay.hide();
      refAreaLeftRef.current = null;
      refAreaRightRef.current = null;
      refAreaLeftClientXRef.current = null;
      refAreaRightClientXRef.current = null;
      cancelled = true;
    }
    if (isChartMeasuringRef.current || isChartMeasuring || measureSessionRef.current) {
      measureSessionRef.current = null;
      isChartMeasuringRef.current = false;
      setIsChartMeasuring(false);
      timeMeasureOverlay.hide();
      cancelled = true;
    }
    return cancelled;
  }, [isChartSelecting, isChartMeasuring, selectionOverlay.hide, timeMeasureOverlay.hide]);

  const executeChartKeyboardAction = useCallback((action: ChartKeyboardAction): boolean => {
    switch (action.type) {
      case 'zoom-in':
        zoomChartByFactor(0.8, 0.5);
        return true;
      case 'zoom-out':
        zoomChartByFactor(1.25, 0.5);
        return true;
      case 'pan-left':
        panChartByKeyboard(-1, action.fast);
        return true;
      case 'pan-right':
        panChartByKeyboard(1, action.fast);
        return true;
      case 'reset-zoom': {
        if (!chartZoom || chartData.length === 0) return false;
        const fullSpan = fullChartTimeSpan(chartData);
        const current = resolveChartZoomTimeRange(chartData, chartZoom, chartData.length);
        if (!fullSpan || !current || isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs)) {
          return false;
        }
        resetChartZoom();
        return true;
      }
      case 'cancel-interaction':
        if (cancelChartInteraction()) return true;
        if (chartZoom && chartData.length > 0) {
          const fullSpan = fullChartTimeSpan(chartData);
          const current = resolveChartZoomTimeRange(chartData, chartZoom, chartData.length);
          if (fullSpan && current && !isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs)) {
            resetChartZoom();
            return true;
          }
        }
        if (chartFullscreen) {
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            setChartFullscreen(false);
          }
          return true;
        }
        return false;
      case 'toggle-fullscreen':
        void toggleChartFullscreen();
        return true;
      case 'toggle-tooltip':
        setChartTooltipEnabled(v => !v);
        return true;
      case 'toggle-field-values':
        setSeriesValuesOpen(v => !v);
        return true;
      case 'toggle-stats':
        setStatsOpen(v => !v);
        return true;
      case 'open-manual':
        setChartManualOpen(true);
        return true;
      default:
        return false;
    }
  }, [
    chartZoom,
    chartData,
    chartFullscreen,
    zoomChartByFactor,
    panChartByKeyboard,
    resetChartZoom,
    cancelChartInteraction,
    toggleChartFullscreen,
  ]);

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

    const schedulePanDelta = (deltaX: number, deltaY: number) => {
      pendingPanDeltaRef.current = { x: deltaX, y: deltaY };
      if (panRafRef.current != null) return;
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        const pending = pendingPanDeltaRef.current;
        applyPanDelta(pending.x, pending.y);
      });
    };

    const applyPanDelta = (deltaX: number, deltaY: number) => {
      const session = panSessionRef.current;
      if (!session) return;

      if (session.panY) {
        const scales: Array<[YAxisScaleKey, YAxisDomain]> = [];
        for (const scale of ['y', 'y2'] as const) {
          const base = session.baseY[scale];
          if (base) scales.push([scale, base]);
        }
        for (const [scale, base] of scales) {
          const metrics = chartCanvasRef.current?.getYAxisMetrics(scale);
          const plotHeight = metrics?.plotHeight ?? 0;
          if (plotHeight <= 0) continue;
          chartCanvasRef.current?.setYAxisDomain(
            scale,
            computeYAxisPanDomain(base, deltaY, plotHeight),
          );
        }
      }

      if (!session.panX) return;

      const len = chartDataLengthRef.current;
      const data = chartDataRef.current;
      const { plotWidth } = getPlotMetrics();
      if (plotWidth <= 0 || len === 0 || data.length === 0) return;

      const fullSpan = fullChartTimeSpan(data);
      if (!fullSpan) return;

      // Always apply the total pointer delta to the viewport captured at
      // pointer-down. Using the previous animation frame here double-counts
      // movement and makes panning accelerate/overshoot.
      const next = computePanTimeRange(
        { startMs: session.baseStartMs, endMs: session.baseEndMs },
        deltaX,
        plotWidth,
        fullSpan.startMs,
        fullSpan.endMs,
      );
      if (isFullChartTimeRange(next, fullSpan.startMs, fullSpan.endMs)) {
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        flushChartZoomCommitRef.current();
      } else if (inMemoryFullRef.current) {
        applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
      } else {
        applyViewportTimeMsImmediateRef.current(next.startMs, next.endMs);
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
      const wasYZooming = yZoomSessionRef.current?.pointerId === pointerId;

      activeChartPointerRef.current = null;
      releasePointerCaptureSafe(pointerId);

      if (wasPanning) {
        panSessionRef.current = null;
        setIsChartPanning(false);
        flushChartZoomCommitRef.current();
      }
      if (wasYZooming) {
        yZoomSessionRef.current = null;
        isChartYZoomingRef.current = false;
        setIsChartYZooming(false);
      }
      if (wasPanning || wasYZooming) {
        syncYAxisZoomedState();
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

    const setYAxisHover = (on: boolean) => {
      // React re-renders rewrite className — compare with the live DOM instead of
      // caching a flag so the hover cursor is restored after any render.
      if (el.classList.contains('y-hover') === on) return;
      el.classList.toggle('y-hover', on);
    };
    const updateYAxisHover = (clientX: number, clientY: number) => {
      const onAxis = chartCanvasRef.current?.getYAxisAtClient(clientX, clientY) != null;
      setYAxisHover(onAxis);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.focus({ preventScroll: true });
      setYAxisHover(false);
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
        const canvas = chartCanvasRef.current;
        const yScale = canvas?.getYAxisAtClient(e.clientX, e.clientY) ?? null;
        if (yScale) {
          const metrics = canvas?.getYAxisMetrics(yScale);
          const anchorValue = canvas?.getYValueFromClientY(yScale, e.clientY);
          if (metrics && anchorValue != null) {
            yZoomSessionRef.current = {
              pointerId: e.pointerId,
              scale: yScale,
              startY: e.clientY,
              base: metrics.current,
              anchorValue,
            };
            isChartYZoomingRef.current = true;
            panSessionRef.current = null;
            isChartSelectingRef.current = false;
            refAreaLeftRef.current = null;
            refAreaRightRef.current = null;
            setIsChartYZooming(true);
            setIsChartPanning(false);
            setIsChartSelecting(false);
            selectionOverlay.hide();
            activeChartPointerRef.current = e.pointerId;
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              activeChartPointerRef.current = null;
              yZoomSessionRef.current = null;
              isChartYZoomingRef.current = false;
              setIsChartYZooming(false);
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        const len = chartDataLengthRef.current;
        const data = chartDataRef.current;
        if (len === 0 || data.length === 0) return;
        const zoom = chartZoomRef.current;
        const fullSpan = fullChartTimeSpan(data);
        const baseRange = chartCanvasRef.current?.getXScaleMs()
          ?? resolveChartZoomTimeRange(data, zoom, len)
          ?? fullSpan;
        if (!baseRange || !fullSpan) return;

        const panX = !isFullChartTimeRange(baseRange, fullSpan.startMs, fullSpan.endMs);
        const baseY: Partial<Record<YAxisScaleKey, YAxisDomain>> = {};
        if (canvas?.isYAxisZoomed()) {
          for (const scale of ['y', 'y2'] as const) {
            const metrics = canvas.getYAxisMetrics(scale);
            if (metrics && isYAxisDomainZoomed(metrics.current, metrics.base)) {
              baseY[scale] = metrics.current;
            }
          }
        }
        const panY = Object.keys(baseY).length > 0;
        if (!panX && !panY) return;

        panSessionRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          baseStartMs: baseRange.startMs,
          baseEndMs: baseRange.endMs,
          panX,
          baseY,
          panY,
        };
        liveFollowRef.current = false;
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
      if (activeChartPointerRef.current !== e.pointerId) {
        updateYAxisHover(e.clientX, e.clientY);
        return;
      }

      // pointerup missed — primary button no longer held
      if (e.buttons === 0) {
        endPointerSession(e.pointerId);
        updateYAxisHover(e.clientX, e.clientY);
        return;
      }

      if (yZoomSessionRef.current?.pointerId === e.pointerId) {
        const session = yZoomSessionRef.current;
        const factor = yAxisDragZoomFactor(e.clientY - session.startY);
        chartCanvasRef.current?.setYAxisDomain(
          session.scale,
          computeYAxisZoomDomain(session.base, session.anchorValue, factor),
        );
        e.preventDefault();
        return;
      }
      if (panSessionRef.current?.pointerId === e.pointerId) {
        schedulePanDelta(
          e.clientX - panSessionRef.current.startX,
          e.clientY - panSessionRef.current.startY,
        );
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
        syncYAxisZoomedState();
      }
      if (yZoomSessionRef.current?.pointerId === e.pointerId) {
        yZoomSessionRef.current = null;
        isChartYZoomingRef.current = false;
        setIsChartYZooming(false);
        syncYAxisZoomedState();
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

    const onPointerLeave = () => {
      if (activeChartPointerRef.current != null) return;
      setYAxisHover(false);
    };

    const pointerOpts: AddEventListenerOptions = { capture: true };
    el.addEventListener('pointerdown', onPointerDown, pointerOpts);
    el.addEventListener('pointermove', onPointerMove, pointerOpts);
    el.addEventListener('pointerup', onPointerUp, pointerOpts);
    el.addEventListener('pointercancel', onPointerUp, pointerOpts);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      el.classList.remove('y-hover');
      el.removeEventListener('pointerdown', onPointerDown, pointerOpts);
      el.removeEventListener('pointermove', onPointerMove, pointerOpts);
      el.removeEventListener('pointerup', onPointerUp, pointerOpts);
      el.removeEventListener('pointercancel', onPointerUp, pointerOpts);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      window.removeEventListener('blur', onWindowBlur);
      if (panRafRef.current != null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
    };
  }, [queryResetEpoch, liveMode, syncReactChartZoomFromRef, syncYAxisZoomedState]);

  useEffect(() => {
    const el = chartViewportRef.current;
    if (!el) return;

    const getWheelPlotWidth = () => {
      const canvasMetrics = chartCanvasRef.current?.getPlotClientMetrics();
      if (canvasMetrics) return canvasMetrics.plotWidth;
      return getChartPlotMetricsFromViewport(el, chartPlotBoundsRef.current).plotWidth;
    };

    const isViewportZoomed = (): boolean => {
      const len = chartDataLengthRef.current;
      const data = chartDataRef.current;
      if (len === 0 || data.length === 0) return false;
      const fullSpan = fullChartTimeSpan(data);
      if (!fullSpan) return false;
      const current = chartCanvasRef.current?.getXScaleMs()
        ?? resolveChartZoomTimeRange(data, chartZoomRef.current, len)
        ?? fullSpan;
      return !isFullChartTimeRange(current, fullSpan.startMs, fullSpan.endMs);
    };

    const applyWheelPan = (deltaX: number) => {
      const len = chartDataLengthRef.current;
      const data = chartDataRef.current;
      if (len === 0 || data.length === 0) return;
      const fullSpan = fullChartTimeSpan(data);
      if (!fullSpan) return;

      const current = inMemoryFullRef.current
        ? (resolveChartZoomTimeRange(data, chartZoomRef.current, len) ?? fullSpan)
        : (chartCanvasRef.current?.getXScaleMs()
          ?? resolveChartZoomTimeRange(data, chartZoomRef.current, len)
          ?? fullSpan);

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
        fullResetDuringWheelGestureRef.current = true;
        chartZoomRef.current = null;
        chartCanvasRef.current?.resetWindow();
        flushChartZoomCommitRef.current();
      } else if (inMemoryFullRef.current) {
        applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
        liveFollowRef.current = false;
      } else {
        applyViewportTimeMsImmediateRef.current(next.startMs, next.endMs);
        liveFollowRef.current = false;
      }
    };

    const applyWheelZoom = (deltaY: number, focusRatio: number, focusMs: number | null) => {
      const len = chartDataLengthRef.current;
      if (len === 0) return;
      const factor = wheelDeltaToZoomFactor(deltaY);
      if (factor == null) return;

      const data = chartDataRef.current;
      const fullSpan = fullChartTimeSpan(data);
      if (!fullSpan) return;

      const current = inMemoryFullRef.current
        ? (resolveChartZoomTimeRange(data, chartZoomRef.current, len) ?? fullSpan)
        : (chartCanvasRef.current?.getXScaleMs()
          ?? resolveChartZoomTimeRange(data, chartZoomRef.current, len)
          ?? fullSpan);

      const atFullViewport = isEffectivelyFullChartViewport(
        current,
        fullSpan.startMs,
        fullSpan.endMs,
      );

      // Trackpad momentum can emit a tiny reverse-delta event after the
      // zoom-out gesture has already landed on the full range. Ignore that
      // reverse event until the wheel stream has gone quiet; otherwise the
      // chart snaps back to the previous 80–90% viewport.
      if (
        factor < 1
        && atFullViewport
        && fullResetDuringWheelGestureRef.current
      ) {
        return;
      }

      // Already showing the full data range — ignore further zoom-out.
      if (factor >= 1 && atFullViewport) {
        return;
      }

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
        if (atFullViewport && chartZoomRef.current == null) {
          return;
        }
        fullResetDuringWheelGestureRef.current = true;
        resetToFullChartViewRef.current();
        chartCanvasRef.current?.syncViewportFinish();
        return;
      }

      if (inMemoryFullRef.current) {
        applyChartZoomFromTimeMsImmediateRef.current(next.startMs, next.endMs);
      } else {
        applyViewportTimeMsImmediateRef.current(next.startMs, next.endMs);
      }
      // Manual wheel zoom always takes over the viewport — prevent the follow
      // effect from re-centering on the live tail on the next poll.
      liveFollowRef.current = false;
    };

    const flushWheelGesture = () => {
      wheelRafRef.current = null;
      const gesture = pendingWheelRef.current;
      pendingWheelRef.current = null;
      if (!gesture) return;

      // Pan first, then compute the zoom anchor against the panned viewport.
      if (gesture.panDeltaX !== 0) {
        applyWheelPan(gesture.panDeltaX);
      }
      if (gesture.zoomDeltaY !== 0 && wheelDeltaToZoomFactor(gesture.zoomDeltaY) != null) {
        const focusMs = chartCanvasRef.current?.getWheelFocusMsFromClientX(gesture.clientX) ?? null;
        const { plotLeft, plotWidth } = getChartPlotMetricsFromViewport(
          el,
          chartPlotBoundsRef.current,
        );
        const focusRatio = focusMs != null
          ? 0.5
          : wheelFocusRatioFromClientX(
            gesture.clientX,
            plotLeft,
            Math.max(plotWidth, el.clientWidth),
          );
        applyWheelZoom(gesture.zoomDeltaY, focusRatio, focusMs);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (chartDataLengthRef.current === 0) return;

      e.preventDefault();
      e.stopPropagation();

      const now = performance.now();
      if (now - lastWheelEventAtRef.current > WHEEL_GESTURE_QUIET_MS) {
        fullResetDuringWheelGestureRef.current = false;
      }
      lastWheelEventAtRef.current = now;

      const pending = pendingWheelRef.current ?? {
        panDeltaX: 0,
        zoomDeltaY: 0,
        clientX: e.clientX,
      };
      pending.clientX = e.clientX;

      if (isWheelHorizontalPan(e)) {
        if (!isViewportZoomed()) return;
        const absX = Math.abs(e.deltaX);
        const absY = Math.abs(e.deltaY);
        pending.panDeltaX += e.shiftKey && absY >= absX
          ? normalizeWheelDeltaY(e)
          : e.deltaX;
      } else {
        const deltaY = normalizeWheelDeltaY(e);
        if (wheelDeltaToZoomFactor(deltaY) == null) return;
        pending.zoomDeltaY += deltaY;
      }

      pendingWheelRef.current = pending;
      if (wheelRafRef.current == null) {
        wheelRafRef.current = requestAnimationFrame(flushWheelGesture);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      pendingWheelRef.current = null;
      if (panRafRef.current != null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (viewportFinishTimerRef.current) {
        clearTimeout(viewportFinishTimerRef.current);
        viewportFinishTimerRef.current = null;
      }
      cancelChartZoomRaf(chartZoomRafRefs);
    };
  }, [queryResetEpoch, liveMode, chartZoomRafRefs]);

  useEffect(() => {
    api.boards.list().then(setBoards);
  }, []);

  useEffect(() => {
    if (aiChartLinkConsumedRef.current) return;
    aiChartLinkConsumedRef.current = true;
    try {
      const raw = sessionStorage.getItem(AI_CHART_STORAGE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(AI_CHART_STORAGE_KEY);
      const parsed = JSON.parse(raw) as AIChartLink;
      if (!parsed?.board_id || !Array.isArray(parsed.fields) || parsed.fields.length === 0) return;
      setAiChartLink(parsed);
      setSelectedBoard(parsed.board_id);
      setChartZoom(null);
      if (parsed.start && parsed.end) {
        setChartQueryTimeRange({ start: parsed.start, end: parsed.end });
      }
    } catch {
      /* ignore malformed handoff */
    }
  }, []);

  useEffect(() => {
    if (selectedBoard || boards.length === 0) return;
    const preferred = boards.find(b => b.name === 'STN-001') ?? boards[0];
    setSelectedBoard(preferred.id);
  }, [boards, selectedBoard]);

  useEffect(() => {
    if (!aiChartLink || aiChartLinkAppliedRef.current) return;
    const protocolID = aiChartLink.protocol_id || boardProtocol?.id;
    if (!protocolID) return;
    aiChartLinkAppliedRef.current = true;
    setItems(prev => {
      const existing = new Set(prev.map(item => item.field_ref.field_name));
      const usedShortLabels = new Set(prev.map(item => chartLabel(item)));
      const additions = aiChartLink.fields
        .filter(field => field && !existing.has(field))
        .map((field, index) => makeItem(protocolID, field, prev.length + index, usedShortLabels));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, [aiChartLink, boardProtocol]);



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
    setDetailWindowKey(null);
    detailFetchSeqRef.current += 1;
    // Keep detailCacheRef. A refresh/time-range change should not discard
    // high-resolution windows that can be reused when zooming back.
    lastDetailCanvasPointsRef.current = [];
  }, []);

  const applyProgressiveData = useCallback((data: VizDataRow[], meta: VizQueryMeta) => {
    setRawVizData(data);
    setQueryMeta(meta);
    // Keep detail-window requests enabled while the background load is still
    // filling the range, so zooming can be prioritized over the global rounds.
    setInMemoryFull(!meta.downsampled);
    setProgressiveLoading(meta.downsampled);
    if (!meta.downsampled) {
      envelopeTimestampsRef.current.clear();
    }
    if (data.length > 0) {
      lastTimestampRef.current = data[data.length - 1].timestamp;
    }
  }, []);

  const handleOverviewData = useCallback((
    data: VizDataRow[],
    meta: VizQueryMeta | null,
    willLoadFull: boolean,
    envelope = false,
  ) => {
    const preview = willLoadFull && envelope;
    applyOverviewResult(data, meta, !!meta && !meta.downsampled);
    setAwaitingRoughData(false);

    const overviewItems = overviewItemsRef.current.length > 0
      ? overviewItemsRef.current
      : itemsRef.current.filter(i => i.visible).slice(0, MAX_CHART_SERIES);
    if (preview) {
      envelopeTimestampsRef.current = new Set(data.map(row => row.timestamp));
      setProgressiveLoading(true);
      // Freeze the Y domain to the envelope's exact min/max. Without this the
      // axis rescales every time a denser round arrives and the whole chart
      // looks different even though the shape is converging.
      const analog = overviewItems.filter(i => !usesDigitalLane(i));
      const leftItems = analog.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
      const rightItems = analog.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
      const points = toChartPoints(data, overviewItems);
      setFrozenAxisDomains({
        left: computeYAxisDomain(points, leftItems),
        right: computeYAxisDomain(points, rightItems),
      });
    } else {
      envelopeTimestampsRef.current.clear();
      setProgressiveLoading(false);
      setFrozenAxisDomains(null);
    }

    if (preview && meta && data.length > 0) {
      const sample = data.length > 500 ? data.slice(0, 500) : data;
      const bytesPerRow = estimateVizPayloadBytes(sample) / sample.length;
      // The preview only requests the chart series; the full load requests all
      // profile items, so scale the byte estimate to the full payload.
      const overviewCount = Math.max(1, overviewItems.length);
      const fullCount = Math.max(overviewCount, itemsRef.current.length);
      setFullLoadBytesEstimate(
        Math.ceil(bytesPerRow * meta.total_matched * fullCount / overviewCount),
      );
    } else {
      setFullLoadBytesEstimate(null);
    }
  }, [applyOverviewResult]);

  // Only a different board/field set invalidates cached detail windows.
  // Refreshes and time-range changes keep reusable high-resolution data.
  useEffect(() => {
    detailCacheRef.current.clear();
    lastDetailCanvasPointsRef.current = [];
  }, [selectedBoard, itemDataKey]);

  const applyQueryResult = useCallback((
    result: Awaited<ReturnType<typeof queryVizDataset>>,
    assessAllRange: boolean,
  ) => {
    setProgressiveLoading(false);
    envelopeTimestampsRef.current.clear();
    setFrozenAxisDomains(null);
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
    setAwaitingRoughData(true);
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    setFullLoadBytesEstimate(null);
    setChartLoadProgress(null);
    loadCompletedRef.current = false;
    if (progressClearTimerRef.current) {
      clearTimeout(progressClearTimerRef.current);
      progressClearTimerRef.current = null;
    }
    setQueryResetEpoch(v => v + 1);
    try {
      const p = await api.viz.getProfile(id);
      overviewItemsRef.current = itemsForOverviewQuery(p.items);
      // The profile owns the fixed Y ranges. Mirror them into localStorage so
      // the existing per-profile storage effect and the toolbar state agree.
      const loadedLeftRange = normalizeAxisRange(p.y_axis_range?.left);
      const loadedRightRange = normalizeAxisRange(p.y_axis_range?.right);
      if (loadedLeftRange || loadedRightRange) {
        // A profile-saved range wins over any browser-local fallback.
        setAxisRangeLeft(loadedLeftRange);
        setAxisRangeRight(loadedRightRange);
        try {
          localStorage.setItem(axisRangeStorageKeyFor(p.id), JSON.stringify({
            left: loadedLeftRange,
            right: loadedRightRange,
          }));
        } catch {
          /* ignore storage failures */
        }
      }
      // With no profile range, leave the per-profile local value in place;
      // the axisRangeStorageKey effect loads it (or clears to Auto).
      setSelectedBoard(p.board_id);
      setItems(normalizeVizItems(p.items));
      setEventOverrides(p.event_overlays ?? {});
      setAiChartLink(null);
      setChartQueryTimeRange(null);
      setSelectedSessionId('');
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
        overviewItems: itemsForOverviewQuery(p.items),
        onProgress: progress => {
          if (progress.done) loadCompletedRef.current = true;
          setChartLoadProgress(progress);
        },
        onOverview: handleOverviewData,
        onPartial: (data, meta) => {
          if (!controller.signal.aborted) applyProgressiveData(data, meta);
        },
      });
      if (controller.signal.aborted) return;
      applyQueryResult(result, isAllRange);
    } catch (e) {
      if (isRequestAborted(e)) return;
      setQueryError(vizErrorMessage(e, t('viz.queryError')));
    } finally {
      if (overviewAbortRef.current === controller) {
        overviewAbortRef.current = null;
        setAwaitingRoughData(false);
        if (loadCompletedRef.current) {
          // Keep the completed 100% state visible for a beat instead of
          // clearing it in the same React batch as the final row merge.
          if (progressClearTimerRef.current) {
            clearTimeout(progressClearTimerRef.current);
          }
          progressClearTimerRef.current = setTimeout(() => {
            progressClearTimerRef.current = null;
            setLoading(false);
            setChartLoadProgress(null);
          }, 350);
        } else {
          setLoading(false);
          setChartLoadProgress(null);
        }
      }
    }
  }, [applyQueryResult, applyProgressiveData, handleOverviewData, t]);

  const dismissQueryError = useCallback(() => {
    setQueryError(null);
  }, []);

  useEffect(() => {
    if (!selectedBoard) { setProfiles([]); return; }
    api.viz.listProfiles(selectedBoard).then(setProfiles);
    setAllRangeGuide(null);
  }, [selectedBoard]);

  useEffect(() => {
    setSelectedSessionId('');
    if (!selectedBoard) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    api.sessions.list(selectedBoard)
      .then(list => { if (!cancelled) setSessions(list); })
      .catch(() => { if (!cancelled) setSessions([]); });
    return () => { cancelled = true; };
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
        setSpectrum({
          present: res.present,
          counts: res.counts ?? res.present.map(present => (present ? 1 : 0)),
          start: res.start,
          end: res.end,
        });
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

  // A truthful budget for the current profile: the 100k point cap, further
  // reduced by the 100 MiB payload budget at the measured bytes-per-row.
  const estimatedVizBytesPerRow = useMemo(() => {
    if (fullLoadBytesEstimate && queryMeta?.total_matched && queryMeta.total_matched > 0) {
      return fullLoadBytesEstimate / queryMeta.total_matched;
    }
    return Math.max(64, items.length * 34);
  }, [fullLoadBytesEstimate, queryMeta?.total_matched, items.length]);

  const spectrumMaxRows = useMemo(
    () => Math.max(1, Math.min(
      FULL_LOAD_MAX_POINTS,
      Math.floor(CHART_MEMORY_BUDGET_BYTES / Math.max(1, estimatedVizBytesPerRow)),
    )),
    [estimatedVizBytesPerRow],
  );

  const spectrumSelectedRows = useMemo(() => {
    if (!spectrum || !spectrumSel) return null;
    const lo = Math.max(0, Math.min(spectrumSel.start, spectrumSel.end));
    const hi = Math.min(
      spectrum.counts.length - 1,
      Math.max(spectrumSel.start, spectrumSel.end),
    );
    let rows = 0;
    for (let i = lo; i <= hi; i += 1) rows += spectrum.counts[i] ?? 0;
    return rows;
  }, [spectrum, spectrumSel]);

  const spectrumSelectedBytes = spectrumSelectedRows != null
    ? spectrumSelectedRows * estimatedVizBytesPerRow
    : null;
  const spectrumOverBudget = spectrumSelectedRows != null
    && (
      spectrumSelectedRows > spectrumMaxRows
      || (spectrumSelectedBytes ?? 0) > CHART_MEMORY_BUDGET_BYTES
    );

  const expandSpectrumToBudget = useCallback(() => {
    if (!spectrum || spectrum.counts.length === 0) return;
    const counts = spectrum.counts;
    const center = spectrumSel
      ? Math.floor((spectrumSel.start + spectrumSel.end) / 2)
      : Math.floor(counts.length / 2);
    let lo = Math.max(0, Math.min(counts.length - 1, center));
    let hi = lo;
    let rows = counts[lo] ?? 0;
    if (rows > spectrumMaxRows) {
      setSpectrumSel({ start: lo, end: hi });
      spectrumSelRef.current = { start: lo, end: hi };
      applySpectrumSelectionRef.current?.(lo, hi);
      return;
    }
    let left = lo - 1;
    let right = hi + 1;
    while (left >= 0 || right < counts.length) {
      const leftCount = left >= 0
        ? counts[left] ?? 0
        : Number.POSITIVE_INFINITY;
      const rightCount = right < counts.length
        ? counts[right] ?? 0
        : Number.POSITIVE_INFINITY;
      if (leftCount <= rightCount && rows + leftCount <= spectrumMaxRows) {
        rows += leftCount;
        lo = left;
        left -= 1;
      } else if (rightCount < leftCount && rows + rightCount <= spectrumMaxRows) {
        rows += rightCount;
        hi = right;
        right += 1;
      } else {
        break;
      }
    }
    setSpectrumSel({ start: lo, end: hi });
    spectrumSelRef.current = { start: lo, end: hi };
    applySpectrumSelectionRef.current?.(lo, hi);
  }, [spectrum, spectrumSel, spectrumMaxRows]);

  const applyTimePresetState = useCallback((id: TimePresetId) => {
    setTimeRangePresetId(id);
    setCustomStart('');
    setCustomEnd('');
    setChartQueryTimeRange(null);
    setSelectedSessionId('');
    setSpectrumSel(null);
    spectrumSelRef.current = null;
    if (id !== TIME_PRESET_ALL) {
      setAllRangeGuide(null);
    }
  }, []);

  const runVizQuery = useCallback(async (
    timeRange: { start: string; end: string } | undefined,
    assessAllRange: boolean,
    options?: { forceSample?: boolean },
  ) => {
    if (!selectedBoard || !itemsRef.current.length) return;
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    setLoading(true);
    setAwaitingRoughData(true);
    setQueryError(null);
    setFullLoadBytesEstimate(null);
    setFrozenAxisDomains(null);
    setProgressiveLoading(false);
    setChartLoadProgress(null);
    loadCompletedRef.current = false;
    if (progressClearTimerRef.current) {
      clearTimeout(progressClearTimerRef.current);
      progressClearTimerRef.current = null;
    }
    setQueryResetEpoch(v => v + 1);
    envelopeTimestampsRef.current.clear();
    try {
      const overviewItems = itemsForOverviewQuery(itemsRef.current);
      overviewItemsRef.current = overviewItems;
      const result = await queryVizDataset({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        time_range: timeRange,
        ...aiAggregationParams,
      }, {
        assessAllRange,
        forceSample: options?.forceSample,
        signal: controller.signal,
        timeoutMs: 45000,
        overviewItems,
        onProgress: progress => {
          if (progress.done) loadCompletedRef.current = true;
          setChartLoadProgress(progress);
        },
        onOverview: handleOverviewData,
        onPartial: (data, meta) => {
          if (!controller.signal.aborted) applyProgressiveData(data, meta);
        },
      });
      if (controller.signal.aborted) return;
      applyQueryResult(result, assessAllRange);
      if (pendingSpectrumViewportRef.current) {
        scheduleSpectrumViewportFit();
      }
    } catch (e) {
      if (isRequestAborted(e)) return;
      setQueryError(vizErrorMessage(e, t('viz.queryError')));
    } finally {
      if (overviewAbortRef.current === controller) {
        overviewAbortRef.current = null;
        setAwaitingRoughData(false);
        if (loadCompletedRef.current) {
          // Keep the completed 100% state visible for a beat instead of
          // clearing it in the same React batch as the final row merge.
          if (progressClearTimerRef.current) {
            clearTimeout(progressClearTimerRef.current);
          }
          progressClearTimerRef.current = setTimeout(() => {
            progressClearTimerRef.current = null;
            setLoading(false);
            setChartLoadProgress(null);
          }, 350);
        } else {
          setLoading(false);
          setChartLoadProgress(null);
        }
      }
    }
  }, [selectedBoard, applyQueryResult, applyProgressiveData, handleOverviewData, t, scheduleSpectrumViewportFit, aiAggregationParams]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const startMs = Date.parse(session.start_time);
    const rawEndMs = session.end_time ? Date.parse(session.end_time) : NaN;
    if (!Number.isFinite(startMs)) return;
    const endMs = Number.isFinite(rawEndMs) && rawEndMs > startMs
      ? rawEndMs
      : Date.now();
    const range = {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    };
    setTimeRangePresetId(TIME_PRESET_ALL);
    setCustomStart('');
    setCustomEnd('');
    setChartQueryTimeRange(range);
    setSpectrumSel(null);
    spectrumSelRef.current = null;
    setAllRangeGuide(null);
    pendingSpectrumViewportRef.current = null;
    void runVizQuery(range, false);
  }, [sessions, runVizQuery]);

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
    setSelectedSessionId('');
    setAllRangeGuide(null);
    pendingSpectrumViewportRef.current = { startMs: range.startMs, endMs: range.endMs };

    if (chartDataLengthRef.current > 0) {
      applyViewportTimeMsImmediateRef.current(range.startMs, range.endMs);
    }

    let selectedRows = 0;
    for (let i = lo; i <= hi; i += 1) selectedRows += spectrum.counts[i] ?? 0;
    const overBudget = selectedRows > spectrumMaxRows
      || selectedRows * estimatedVizBytesPerRow > CHART_MEMORY_BUDGET_BYTES;
    void runVizQuery(queryRange, false, { forceSample: overBudget });
  }, [spectrum, runVizQuery, spectrumMaxRows, estimatedVizBytesPerRow]);
  applySpectrumSelectionRef.current = applySpectrumSelection;

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

  // Control-command overlay: fetch call/result/ack frames for the chart range.
  useEffect(() => {
    if (!selectedBoard) {
      setCommandEvents([]);
      return;
    }
    const range = buildTimeRange();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.viz.commands(
        { board_id: selectedBoard, since: range?.start, until: range?.end },
        { signal: controller.signal },
      )
        .then(res => {
          if (!controller.signal.aborted) {
            setCommandEvents(res.items);
            setEventConfig(res.config ?? []);
          }
        })
        .catch(() => {});
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selectedBoard, buildTimeRange]);

  useEffect(() => {
    autoQueryRef.current = () => {
      if (!liveModeRef.current) void fetchAll();
    };
  }, [fetchAll]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (shouldIgnoreVizKeyboardShortcut(e.target, chartManualOpen)) return;

      const pageAction = resolveVizPageKeyboardAction(e);
      if (pageAction) {
        e.preventDefault();
        e.stopPropagation();
        switch (pageAction.type) {
          case 'refresh':
            if (loading) break;
            if (liveModeRef.current) void reloadLiveTailRef.current();
            else void fetchAll();
            break;
          case 'toggle-live':
            setAiChartLink(null);
            setLiveMode(v => !v);
            break;
          default:
            break;
        }
        return;
      }

      const chartAction = resolveChartKeyboardAction(e);
      if (!chartAction) return;
      if (executeChartKeyboardAction(chartAction)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [chartManualOpen, loading, fetchAll, executeChartKeyboardAction]);

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
    setSelectedSessionId('');
    setSpectrumSel(null);
    spectrumSelRef.current = null;
    setTimeRangePresetId(TIME_PRESET_ALL);
  }, []);

  const reloadLiveTail = useCallback(async (opts?: { keepFollow?: boolean }) => {
    if (!selectedBoard || !itemsRef.current.length) return;
    const existingZoom = resolveChartZoomTimeRange(
      chartDataRef.current,
      chartZoomRef.current,
      chartDataLengthRef.current,
    );
    if (!opts?.keepFollow) {
      liveFollowRef.current = true;
    }
    if (existingZoom) {
      liveSpanMsRef.current = liveZoomSpanMs(existingZoom);
    }
    overviewAbortRef.current?.abort();
    liveAbortRef.current?.abort();
    setQueryError(null);
    setAllRangeGuide(null);
    // Live tail starts fresh from "now" — do not pre-fill the chart with history.
    lastTimestampRef.current = new Date().toISOString();
    setRawVizData([]);
    setQueryMeta(null);
    setInMemoryFull(true);
    setLoading(false);
    setLivePollError(null);
    setQueryResetEpoch(v => v + 1);
  }, [selectedBoard, t]);
  reloadLiveTailRef.current = reloadLiveTail;

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
        mode: 'live',
        since: since || undefined,
        limit: MAX_POINTS,
      }, { signal: controller.signal, timeoutMs: 20000 });
      if (controller.signal.aborted) return;
      if (!result.data.length) return;
      setRawVizData(prev => {
        const merged = trimLiveRows(mergeLiveRows(since ? prev : [], result.data), MAX_POINTS);
        if (merged.length > 0) {
          lastTimestampRef.current = merged[merged.length - 1].timestamp;
        }
        return merged;
      });
      setQueryMeta({
        total_matched: result.meta?.total_matched ?? result.data.length,
        returned: result.data.length,
        downsampled: false,
      });
      setInMemoryFull(true);
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
    await reloadLiveTail();
    pollTimerRef.current = setInterval(() => { appendLive(); }, POLL_INTERVAL);
  }, [reloadLiveTail, appendLive, stopLive]);

  useEffect(() => {
    if (liveMode) {
      startLive();
    } else {
      stopLive();
      setLivePollError(null);
    }
    return stopLive;
  }, [liveMode, startLive, stopLive]);

  const liveFieldsKeyRef = useRef(liveFieldsKey);
  useEffect(() => {
    const prev = liveFieldsKeyRef.current;
    liveFieldsKeyRef.current = liveFieldsKey;
    if (!liveMode || !selectedBoard || !items.length) return;
    if (prev === liveFieldsKey) return;
    void reloadLiveTail({ keepFollow: true });
  }, [liveFieldsKey, liveMode, selectedBoard, items.length, reloadLiveTail]);

  useEffect(() => {
    if (!liveMode || !liveFollowRef.current) return;
    const data = chartDataRef.current;
    if (data.length === 0) return;
    const full = fullChartTimeSpan(data);
    if (!full) return;
    const next = liveFollowWindow(full.startMs, full.endMs, liveSpanMsRef.current);
    if (!next) return;
    if (isFullChartTimeRange(next, full.startMs, full.endMs)) {
      if (chartZoomRef.current != null) {
        resetChartZoom();
      } else {
        chartCanvasRef.current?.resetWindow();
      }
      return;
    }
    applyChartZoomFromTimeMs(next.startMs, next.endMs);
  }, [rawVizDataKey, liveMode, applyChartZoomFromTimeMs, resetChartZoom]);

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
    if (autoQueryTimerRef.current) {
      clearTimeout(autoQueryTimerRef.current);
      autoQueryTimerRef.current = null;
    }
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

  const scheduleAutoQuery = useCallback(() => {
    if (liveModeRef.current) return;
    if (autoQueryTimerRef.current) clearTimeout(autoQueryTimerRef.current);
    autoQueryTimerRef.current = setTimeout(() => {
      autoQueryTimerRef.current = null;
      autoQueryRef.current();
    }, 120);
  }, []);

  const addAllFields = () => {
    if (!boardProtocol) return;
    setItems(prev => {
      const usedShortLabels = new Set(prev.map(i => chartLabel(i)));
      const existing = new Set(prev.map(i => i.label));
      const newItems = protocolFieldPaths
        .filter(name => !existing.has(name))
        .map((name, i) => ({
          ...makeItem(boardProtocol.id, name, prev.length + i, usedShortLabels),
          visible: i < 5,
        }));
      return newItems.length ? [...prev, ...newItems] : prev;
    });
    scheduleAutoQuery();
  };

  const availableFields = useMemo(
    () => protocolFieldPaths.filter(name => !existingFieldLabels.has(name)),
    [protocolFieldPaths, existingFieldLabels],
  );

  const addField = useCallback((fieldName: string) => {
    if (!boardProtocol || !fieldName) return;
    setItems(prev => {
      const usedShortLabels = new Set(prev.map(i => chartLabel(i)));
      return [...prev, makeItem(boardProtocol.id, fieldName, prev.length, usedShortLabels)];
    });
    scheduleAutoQuery();
  }, [boardProtocol, scheduleAutoQuery]);

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

  const saveProfile = async (name: string, profileId?: string) => {
    if (!selectedBoard) {
      setProfileError(t('viz.profileError.noBoard'));
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setProfileError(t('viz.profileError.noName'));
      return false;
    }
    const profileItems = checkedOnly ? items.filter(i => i.visible) : items;
    if (profileItems.length === 0) {
      setProfileError(t('viz.profileError.noItems'));
      return false;
    }

    let latestProfiles = profiles;
    try {
      latestProfiles = await api.viz.listProfiles(selectedBoard);
      setProfiles(latestProfiles);
    } catch {
      // Fall back to the last loaded list if the refresh fails.
    }
    // Prefer the active profile id. Name lookup is only for a new profile;
    // a stale/reordered list must never overwrite a different profile.
    const existing = profileId
      ? latestProfiles.find(p => p.id === profileId)
      : latestProfiles.find(p => p.name === trimmed);
    if (!existing && latestProfiles.length >= MAX_PROFILES) {
      setProfileError(t('viz.profileError.maxProfiles', { max: MAX_PROFILES }));
      return false;
    }

    setProfileSaving(true);
    setProfileError('');
    try {
      const data = {
        name: trimmed,
        board_id: selectedBoard,
        items: profileItems,
        time_range: buildTimeRange(),
        event_overlays: eventOverrides,
        y_axis_range: (axisRangeLeft || axisRangeRight)
          ? {
              left: axisRangeLeft ?? undefined,
              right: axisRangeRight ?? undefined,
            }
          : undefined,
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

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === savedProfileId) ?? null,
    [profiles, savedProfileId],
  );
  const axisRangeStorageKey = useMemo(
    () => axisRangeStorageKeyFor(savedProfileId ?? selectedBoard),
    [savedProfileId, selectedBoard],
  );
  useEffect(() => {
    try {
      const raw = localStorage.getItem(axisRangeStorageKey);
      if (!raw) {
        setAxisRangeLeft(null);
        setAxisRangeRight(null);
        return;
      }
      const parsed = JSON.parse(raw) as { left?: AxisRange; right?: AxisRange };
      setAxisRangeLeft(normalizeAxisRange(parsed.left));
      setAxisRangeRight(normalizeAxisRange(parsed.right));
    } catch {
      setAxisRangeLeft(null);
      setAxisRangeRight(null);
    }
  }, [axisRangeStorageKey]);
  const profileDirty = useMemo(() => {
    if (!activeProfile) return false;
    const current = checkedOnly ? items.filter(i => i.visible) : items;
    const itemsDirty = JSON.stringify(current) !== JSON.stringify(activeProfile.items);
    const normalizeRange = (range?: { left?: AxisRange; right?: AxisRange }) => JSON.stringify({
      left: range?.left ? { min: range.left.min, max: range.left.max } : null,
      right: range?.right ? { min: range.right.min, max: range.right.max } : null,
    });
    const rangeDirty = normalizeRange({
      left: axisRangeLeft ?? undefined,
      right: axisRangeRight ?? undefined,
    }) !== normalizeRange(activeProfile.y_axis_range);
    const overlaysDirty = JSON.stringify(eventOverrides)
      !== JSON.stringify(activeProfile.event_overlays ?? {});
    return itemsDirty || rangeDirty || overlaysDirty;
  }, [items, activeProfile, checkedOnly, axisRangeLeft, axisRangeRight, eventOverrides]);
  useEffect(() => {
    setEventOverrides(activeProfile?.event_overlays ?? {});
  }, [activeProfile?.id, activeProfile?.updated_at]);
  const chartCommandEvents = useMemo(() => {
    if (!showCommands) return [];
    const configByFid = new Map(eventConfig.map(cfg => [vizFidKey(cfg.fid), cfg]));
    return commandEvents.filter(event => {
      const key = vizFidKey(event.fid);
      const config = configByFid.get(key);
      const override = eventOverrides[key] ?? eventOverrides[key.toLowerCase()];
      const type = override?.type ?? config?.type ?? 'event';
      const visible = override?.visible ?? config?.visible ?? true;
      return type !== 'series' && visible;
    });
  }, [commandEvents, eventConfig, eventOverrides, showCommands]);
  const saveCurrentProfile = async () => {
    if (!activeProfile) return;
    await saveProfile(activeProfile.name, activeProfile.id);
  };
  const applyAxisRanges = () => {
    const parseDraft = (draft: AxisRangeDraft): AxisRange | null => {
      if (draft.auto) return null;
      const min = parseOptionalNumber(draft.min);
      const max = parseOptionalNumber(draft.max);
      if (min == null || max == null || max <= min) {
        throw new Error(t('viz.axisRange.invalid'));
      }
      return { min, max };
    };
    try {
      // A profile with no analog series on a side must not store a range for
      // that side; otherwise the toolbar shows a fixed axis that does not exist.
      const left = hasAnalogLeftAxis ? parseDraft(axisRangeDraft.left) : null;
      const right = hasAnalogRightAxis ? parseDraft(axisRangeDraft.right) : null;
      setAxisRangeLeft(left);
      setAxisRangeRight(right);
      setAxisRangeError('');
      setAxisRangeOpen(false);
      try {
        localStorage.setItem(axisRangeStorageKey, JSON.stringify({ left, right }));
      } catch {
        /* ignore storage failures */
      }
      chartCanvasRef.current?.resetYAxes();
    } catch (error) {
      setAxisRangeError(vizErrorMessage(error, t('viz.axisRange.invalid')));
    }
  };

  const applyAutoYLayout = () => {
    const result = computeAutoYLayout(items, chartData);
    if (!result) {
      setAutoLayoutNote(t('viz.autoLayoutNoData'));
      return;
    }
    const byId = new Map(result.updates.map(update => [update.id, update] as const));
    setItems(prev => prev.map(item => {
      const update = byId.get(item.id);
      if (!update) return item;
      return {
        ...item,
        offset: update.offset,
        weight: update.weight,
        y_axis: {
          ...item.y_axis,
          id: update.yAxisId,
          min: update.min,
          max: update.max,
        },
      };
    }));
    if (result.axis) {
      const leftRange = { min: result.axis[0], max: result.axis[1] };
      setAxisRangeLeft(leftRange);
      try {
        localStorage.setItem(axisRangeStorageKey, JSON.stringify({
          left: leftRange,
          right: axisRangeRight,
        }));
      } catch {
        /* ignore storage failures */
      }
    }
    setAutoLayoutNote(t('viz.autoLayoutDone', { count: result.updates.length }));
  };

  const visibleItems = useMemo(
    () => items.filter(i => i.visible),
    [items],
  );
  const filteredItems = useMemo(
    () => items.filter(item =>
      (!checkedOnly || item.visible)
      && itemMatchesFieldSearch(item, itemFieldSearch),
    ),
    [items, itemFieldSearch, checkedOnly],
  );
  const chartItems = useMemo(() => items, [items]);
  const activeChartItems = useMemo(
    () => items.filter(i => i.visible).slice(0, MAX_CHART_SERIES),
    [items],
  );
  const digitalChartItems = useMemo(
    () => activeChartItems.filter(usesDigitalLane),
    [activeChartItems],
  );
  const digitalLanes = useMemo(
    () => new Map(digitalChartItems.map((item, index) => [item.id, index] as const)),
    [digitalChartItems],
  );
  const analogChartItems = useMemo(
    () => activeChartItems.filter(item => !usesDigitalLane(item)),
    [activeChartItems],
  );
  const hasAnalogLeftAxis = useMemo(
    () => analogChartItems.some(item => item.y_axis.id !== SECONDARY_Y_AXIS_ID),
    [analogChartItems],
  );
  const hasAnalogRightAxis = useMemo(
    () => analogChartItems.some(item => item.y_axis.id === SECONDARY_Y_AXIS_ID),
    [analogChartItems],
  );
  const chartSeriesTruncated = visibleItems.length > MAX_CHART_SERIES;

  const zoomWindow = useMemo(() => {
    if (!chartZoom || chartData.length === 0) return null;

    // When the zoom was committed with time keys, re-resolve the indices
    // against the current data. Progressive loading inserts rows, so the
    // original indices would point at a different span as the array grows.
    let start: number;
    let end: number;
    let startTs: string | undefined;
    let endTs: string | undefined;
    const zoomStartMs = chartZoom.startTs ? Date.parse(chartZoom.startTs) : NaN;
    const zoomEndMs = chartZoom.endTs ? Date.parse(chartZoom.endTs) : NaN;
    if (Number.isFinite(zoomStartMs) && Number.isFinite(zoomEndMs) && zoomEndMs > zoomStartMs) {
      start = findChartIndexLowerBoundForTimeMs(chartData, zoomStartMs);
      end = findChartIndexUpperBoundForTimeMs(chartData, zoomEndMs);
      if (end < start) end = start;
      startTs = chartZoom.startTs;
      endTs = chartZoom.endTs;
    } else {
      const clamped = clampChartZoom(chartZoom.start, chartZoom.end, chartData.length);
      start = clamped.start;
      end = clamped.end;
      startTs = chartZoom.startTs ?? chartData[start]?.timeKey;
      endTs = chartZoom.endTs ?? chartData[end]?.timeKey;
    }
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
      setDetailWindowKey(null);
      return;
    }

    const { startTs, endTs } = zoomWindow;
    const windowKey = `${startTs}:${endTs}`;
    const cacheKey = buildDetailCacheKey(selectedBoard, startTs, endTs, itemDataKey);
    const cached = detailCacheRef.current.get(cacheKey);

    // Use the maximum detail budget directly. Deriving it from the full span
    // made this effect depend on chartData, which changes on every progressive
    // publish and kept restarting the debounced detail request.
    const detailLimit = DETAIL_MAX_POINTS;

    const applyDetail = (
      data: VizDataRow[],
      meta: VizQueryMeta | null,
      fromCache: boolean,
    ) => {
      const currentZoom = chartZoomRef.current;
      if (!currentZoom || chartDataLengthRef.current === 0) {
        setDetailRawVizData(null);
        setDetailQueryMeta(null);
        setDetailWindowKey(null);
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
      setDetailWindowKey(windowKey);
      if (!fromCache) {
        detailCacheRef.current.set(cacheKey, data, meta);
      }
    };

    if (cached) {
      applyDetail(cached.data, cached.meta, true);
      if (detailCacheRef.current.isFresh(cached)) {
        setDetailLoading(false);
        if (!globalLoadActiveRef.current) setChartLoadProgress(null);
        return;
      }
    } else {
      const staleRows = detailRawVizDataRef.current;
      const staleOverlaps = staleRows?.length
        ? filterVizRowsByTimeRange(staleRows, startTs, endTs).length > 0
        : false;
      if (!staleOverlaps) {
        const overlapCached = detailCacheRef.current.findBestOverlap(
          selectedBoard,
          startTs,
          endTs,
          itemDataKey,
        );
        if (overlapCached) {
          applyDetail(overlapCached.data, overlapCached.meta, true);
        }
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
            ...aiAggregationParams,
          }, {
            signal: controller.signal,
            timeoutMs: 30000,
            onProgress: (loaded, total) => {
              // While a full-range query is running its row-based bar owns the
              // header. A detail request is short and must not make that bar
              // jump to a different scale.
              if (globalLoadActiveRef.current) return;
              setChartLoadProgress({
                phase: 'detail',
                loaded,
                total,
                overallLoaded: loaded,
              });
            },
          });
          if (controller.signal.aborted) return;
          if (detailFetchSeqRef.current !== seq) return;
          applyDetail(result.data, result.meta ?? null, false);
        } catch (e) {
          if (isRequestAborted(e)) return;
          if (detailFetchSeqRef.current !== seq) return;
          if (!cached && !detailRawVizDataRef.current?.length) {
            setDetailRawVizData(null);
            setDetailQueryMeta(null);
            setDetailWindowKey(null);
          }
        } finally {
          if (detailAbortRef.current === controller) {
            detailAbortRef.current = null;
          }
          if (detailFetchSeqRef.current === seq) {
            setDetailLoading(false);
            if (!globalLoadActiveRef.current) setChartLoadProgress(null);
          }
        }
      })();
    };

    if (cached) {
      runFetch();
      return;
    }

    detailDebounceRef.current = setTimeout(runFetch, DETAIL_FETCH_DEBOUNCE_MS);

    return () => {
      if (detailDebounceRef.current) {
        clearTimeout(detailDebounceRef.current);
        detailDebounceRef.current = null;
      }
      detailAbortRef.current?.abort();
      detailAbortRef.current = null;
    };
    // Deliberately depend on the zoom time keys, not the zoomWindow object:
    // progressive publishes rebuild chartData (and the object) every few
    // hundred ms, which would otherwise keep restarting the debounced fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zoomWindow?.startTs,
    zoomWindow?.endTs,
    liveMode,
    selectedBoard,
    itemDataKey,
    inMemoryFull,
    aiAggregationParams,
  ]);

  // While the full-range overview is downsampled, fetch a higher-resolution
  // copy in the background and keep it in the detail cache. Zooming into it
  // can then render immediately instead of waiting for a fresh request.
  useEffect(() => {
    if (
      liveMode
      || !selectedBoard
      || inMemoryFull
      || progressiveLoading
      || zoomWindow
      || !queryMeta?.downsampled
      || rawVizData.length < 2
    ) return;

    const startTs = rawVizData[0].timestamp;
    const endTs = rawVizData[rawVizData.length - 1].timestamp;
    const cacheKey = buildDetailCacheKey(selectedBoard, startTs, endTs, itemDataKey);
    if (detailCacheRef.current.peek(cacheKey)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api.viz.queryItems({
        board_id: selectedBoard,
        items: itemsForDataQuery(itemsRef.current),
        time_range: { start: startTs, end: endTs },
        limit: Math.min(
          DETAIL_MAX_POINTS,
          Math.max(MAX_POINTS, queryMeta.total_matched ?? MAX_POINTS),
        ),
        ...aiAggregationParams,
      }, { signal: controller.signal, timeoutMs: 30000 }).then(result => {
        if (controller.signal.aborted) return;
        detailCacheRef.current.set(cacheKey, result.data, result.meta ?? null);
      }).catch(() => {
        /* Background prefetch is best-effort. */
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    liveMode,
    selectedBoard,
    inMemoryFull,
    progressiveLoading,
    zoomWindow,
    queryMeta?.downsampled,
    queryMeta?.total_matched,
    rawVizData,
    itemDataKey,
    aiAggregationParams,
  ]);

  const displayChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (!zoomWindow) return chartData;
    if (inMemoryFull) {
      return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
    }
    if (detailChartData && detailChartData.length > 0) return detailChartData;
    return chartData.slice(zoomWindow.start, zoomWindow.end + 1);
  }, [chartData, zoomWindow, detailChartData, inMemoryFull]);

  const detailReady = !!(
    zoomWindow
    && detailWindowKey === `${zoomWindow.startTs}:${zoomWindow.endTs}`
    && detailChartData
    && detailChartData.length > 0
  );

  const displayRawVizData = useMemo(() => {
    if (!rawVizData.length) return [];
    let rows: VizDataRow[];
    if (!zoomWindow) {
      rows = rawVizData;
    } else if (inMemoryFull) {
      rows = filterVizRowsByTimeRange(rawVizData, zoomWindow.startTs, zoomWindow.endTs);
    } else {
      const { startTs, endTs } = zoomWindow;
      if (queryMeta?.downsampled) {
        if (detailRawVizData?.length) {
          rows = filterVizRowsByTimeRange(detailRawVizData, startTs, endTs);
        } else if (detailLoading) {
          return [];
        } else {
          rows = filterVizRowsByTimeRange(rawVizData, startTs, endTs);
        }
      } else {
        rows = filterVizRowsByTimeRange(rawVizData, startTs, endTs);
      }
    }
    return rows;
  }, [
    rawVizData,
    zoomWindow,
    detailRawVizData,
    detailLoading,
    inMemoryFull,
    queryMeta?.downsampled,
  ]);

  const rawValuesSource = useMemo(() => displayRawVizData, [displayRawVizData]);

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

  /**
   * Stable render layer for uPlot — does not change on every zoom frame.
   * Viewport (x/y window) is updated imperatively on the canvas during pan/wheel.
   */
  const canvasChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (inMemoryFull) return chartData;
    if (!queryMeta?.downsampled) {
      if (!zoomWindow) return chartData;
      return filterChartPointsByTimeRange(chartData, zoomWindow.startTs, zoomWindow.endTs);
    }
    if (detailChartData?.length) return detailChartData;
    if (lastDetailCanvasPointsRef.current.length) return lastDetailCanvasPointsRef.current;
    return chartData;
  }, [
    chartData,
    inMemoryFull,
    zoomWindow,
    queryMeta?.downsampled,
    detailChartData,
  ]);

  const canvasClipViewport = !!(queryMeta?.downsampled && !inMemoryFull);

  useEffect(() => {
    if (inMemoryFull || !queryMeta?.downsampled || !detailChartData?.length) return;
    lastDetailCanvasPointsRef.current = detailChartData;
  }, [detailChartData, inMemoryFull, queryMeta?.downsampled]);

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

  /** Full-range time extent only. This stays constant while progressive
   *  rounds insert rows, so it must not churn chart props or effects. */
  const chartSpanKey = chartData.length >= 2
    ? `${chartData[0].timeKey}:${chartData[chartData.length - 1].timeKey}`
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
  }, [selectedBoard, inMemoryFull, queryMeta?.downsampled, chartSpanKey]);

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

  const canvasXWindowTimeKeys = useMemo(() => {
    if (inMemoryFull || !chartZoom?.startTs || !chartZoom?.endTs) return null;
    const fullSpan = fullChartTimeSpan(chartData);
    if (fullSpan) {
      const startMs = Date.parse(chartZoom.startTs);
      const endMs = Date.parse(chartZoom.endTs);
      if (
        Number.isFinite(startMs)
        && Number.isFinite(endMs)
        && isFullChartTimeRange({ startMs, endMs }, fullSpan.startMs, fullSpan.endMs)
      ) {
        return null;
      }
    }
    return { start: chartZoom.startTs, end: chartZoom.endTs };
    // chartData is read for the full span, but only its first/last timestamps
    // matter. Depending on the array itself re-ran this on every progressive
    // publish and rebuilt the chart's window props unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartZoom?.startTs, chartZoom?.endTs, inMemoryFull, chartSpanKey]);

  const resolveCanvasYScale = useCallback((item: VizItem) => (
    usesDigitalLane(item)
      ? 'y3'
      : item.y_axis.id === SECONDARY_Y_AXIS_ID ? 'y2' : 'y'
  ), []);

  const chartInteractionHidden = isChartPanning || isChartSelecting || isChartMeasuring || isChartYZooming;

  const chartZoomActive = zoomWindow != null;

  const chartDataLoading = loading || detailLoading;
  // One ratio drives the percentage, the bar width and the MB counter so they
  // can never disagree (the old code mixed unique rows with network bytes).
  const chartProgressRatio = (() => {
    const progress = chartLoadProgress;
    if (!progress) return null;
    // The rough-sampling request is only a preview. Letting it run to 100%
    // made the bar jump back to 0 when the real full load started.
    if (progress.phase === 'overview') return 0;
    if (progress.done) return 1;
    if (progress.chunkCount && progress.rowsTotal && progress.rowsTotal > 0) {
      return Math.max(
        0,
        Math.min(1, (progress.rowsLoaded ?? 0) / progress.rowsTotal),
      );
    }
    if (progress.chunkCount) {
      if (!fullLoadBytesEstimate || fullLoadBytesEstimate <= 0) return null;
      return Math.max(
        0,
        Math.min(1, progress.overallLoaded / fullLoadBytesEstimate),
      );
    }
    if (!progress.total || progress.total <= 0) return null;
    return Math.max(0, Math.min(1, progress.loaded / progress.total));
  })();
  const chartProgressPercent = chartProgressRatio != null
    ? chartProgressRatio * 100
    : null;
  // Use the displayed integer for both the label and the bar. Previously the
  // label floored (57%) while the bar used 57.96%, so the bar was longer than
  // the number said.
  const chartProgressWholePercent = chartProgressPercent != null
    ? Math.max(0, Math.min(100, Math.floor(chartProgressPercent + 1e-9)))
    : null;
  const chartProgressPercentDisplay = chartProgressWholePercent != null
    ? `${String(chartProgressWholePercent).padStart(2, '0')}%`
    : '';
  const chartProgressSizeText = (() => {
    if (!chartDataLoading || !chartLoadProgress) return '';
    if (chartLoadProgress.phase === 'overview') return '';
    const totalBytes = chartLoadProgress.chunkCount
      ? fullLoadBytesEstimate
      : chartLoadProgress.total;
    if (!totalBytes || totalBytes <= 0) return '';
    const loadedBytes = chartLoadProgress.chunkCount
        && chartProgressWholePercent != null
      ? totalBytes * (chartProgressWholePercent / 100)
      : Math.min(chartLoadProgress.overallLoaded, totalBytes);
    const loadedMB = (loadedBytes / 1024 / 1024).toFixed(1);
    // Match the percent exactly at 100% too: an integer total rounded 242.6
    // up to 243 while the numerator stayed 242.6, which looked like 99.8%.
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    return `${loadedMB}/${totalMB.padStart(5, '0')} MB`;
  })();
  const chartProgressLabel = [
    chartProgressPercentDisplay,
    chartProgressSizeText ? `(${chartProgressSizeText})` : '',
  ].filter(Boolean).join(' ') || t('viz.chartLoading');
  const chartProgressNode = (
    <>
      {chartProgressPercentDisplay && (
        <span className="viz-chart-progress-percent">{chartProgressPercentDisplay}</span>
      )}
      {chartProgressSizeText && (
        <span className="viz-chart-progress-size">({chartProgressSizeText})</span>
      )}
    </>
  );
  const showDetailLoadingIndicator = detailLoading
    && chartZoomActive
    && !inMemoryFull
    && !liveMode;

  const detailLoadingLabel = detailRawVizData?.length
    ? t('viz.detailRefreshing')
    : t('viz.detailLoading');

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
    const pointCount = canvasChartData.length;
    parts.push(t('viz.summary.points', { count: pointCount.toLocaleString() }));
    if (inMemoryFull && rawVizData.length > 0) {
      parts.push(t('viz.summary.inMemory', { size: formatFullLoadBytes(estimateVizPayloadBytes(rawVizData)) }));
    } else if (chartZoomActive && detailReady && detailQueryMeta?.downsampled) {
      parts.push(t('viz.summary.detailRatio', {
        returned: detailQueryMeta.returned.toLocaleString(),
        total: detailQueryMeta.total_matched.toLocaleString(),
      }));
    } else if (chartZoomActive && detailReady && detailQueryMeta) {
      parts.push(t('viz.summary.detailPts', { count: detailQueryMeta.returned.toLocaleString() }));
    } else if (liveMode) {
      parts.push(t('viz.summary.liveRaw'));
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
    if (detailLoading && !detailReady) {
      parts.push(detailRawVizData?.length
        ? t('viz.summary.refreshingDetail')
        : t('viz.summary.loadingDetail'));
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
    detailReady,
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
      checkedOnly ? items.filter(item => item.visible) : items,
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
  }, [items, checkedOnly, hoverTimeKey, hoverPrevTimeKey, rawValuesByTimeKey, chartItemIds]);

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
    if (isChartPanning || isChartSelecting || isChartMeasuring || isChartYZooming) return;
    if (timeKey == null) {
      // Keep the last cursor value when the pointer leaves the chart. The
      // canvas tooltip hides itself, but the field-value panel is a readout of
      // the last inspected sample and should remain visible.
      // A pending throttled commit is allowed to finish so the last sample is
      // still shown even when the pointer leaves immediately after moving.
      return;
    }
    const now = performance.now();
    const elapsed = now - lastHoverCommitRef.current;
    const commit = () => {
      hoverCommitTimerRef.current = null;
      lastHoverCommitRef.current = performance.now();
      setHoverTimeKey(timeKey);
    };
    // The canvas tooltip updates immediately; the side value panel only needs
    // a modest refresh rate. Throttling avoids re-rendering the whole page on
    // every pointer sample while zooming/panning large datasets.
    if (elapsed >= 80) {
      commit();
    } else {
      if (hoverCommitTimerRef.current != null) clearTimeout(hoverCommitTimerRef.current);
      hoverCommitTimerRef.current = setTimeout(commit, 80 - elapsed);
    }
  }, [isChartPanning, isChartSelecting, isChartMeasuring, isChartYZooming]);

  useEffect(() => () => {
    if (hoverCommitTimerRef.current != null) clearTimeout(hoverCommitTimerRef.current);
  }, []);

  const handleChartPlotBoundsChange = useCallback((bounds: { left: number; width: number }) => {
    chartPlotBoundsRef.current = bounds;
  }, []);

  const yAxisOptions = useMemo(() => PRESET_Y_AXES.map(axis => axis.id), []);

  const chartYAxes = useMemo(() => {
    if (analogChartItems.length === 0) return [];
    const usesRight = analogChartItems.some(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    const leftItems = analogChartItems.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
    const rightItems = analogChartItems.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
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
  }, [analogChartItems]);

  const chartYAxisDomains = useMemo(() => {
    const leftItems = analogChartItems.filter(i => i.y_axis.id !== SECONDARY_Y_AXIS_ID);
    const rightItems = analogChartItems.filter(i => i.y_axis.id === SECONDARY_Y_AXIS_ID);
    // X 줌/팬과 무관하게 불러온 전체 구간으로 고정한다. 화면에 보이는 값에
    // 맞춰 축이 재계산되면 같은 변화가 다른 값처럼 읽히기 때문이다.
    return {
      [PRIMARY_Y_AXIS_ID]: axisRangeLeft
        ? [axisRangeLeft.min, axisRangeLeft.max] as [number, number]
        : (frozenAxisDomains?.left ?? computeYAxisDomain(chartData, leftItems)),
      [SECONDARY_Y_AXIS_ID]: axisRangeRight
        ? [axisRangeRight.min, axisRangeRight.max] as [number, number]
        : (frozenAxisDomains?.right ?? computeYAxisDomain(chartData, rightItems)),
    } as Record<string, [number, number] | undefined>;
  }, [chartData, analogChartItems, axisRangeLeft, axisRangeRight, frozenAxisDomains]);

  const canvasYAxisDomains = useMemo(() => ({
    y: chartYAxisDomains[PRIMARY_Y_AXIS_ID],
    y2: chartYAxisDomains[SECONDARY_Y_AXIS_ID],
  }), [chartYAxisDomains]);

  // Bump when the user changes explicit axis bounds so the chart drops any
  // manual Y zoom and applies the new profile settings.
  const yDomainOverrideKey = useMemo(() => JSON.stringify({
    left: axisRangeLeft ?? frozenAxisDomains?.left ?? null,
    right: axisRangeRight ?? frozenAxisDomains?.right ?? null,
    items: analogChartItems.map(i => [i.id, i.y_axis.min ?? null, i.y_axis.max ?? null]),
  }), [analogChartItems, axisRangeLeft, axisRangeRight, frozenAxisDomains]);

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
        const raw = resolveVizItemRawValue(item, row.values);
        if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
        if (raw < min) min = raw;
        if (raw > max) max = raw;
        sum += raw;
        count += 1;
        last = raw;
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
          <div
            className="viz-config-header-main viz-config-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={configOpen}
            aria-controls="viz-config-panel"
            title={configOpen ? t('viz.collapseConfig') : t('viz.expandConfig')}
            onClick={toggleConfigOpen}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleConfigOpen();
              }
            }}
          >
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
              <button type="button" onClick={() => { if (liveMode) void reloadLiveTail(); else void fetchAll(); }} className="btn-primary btn-sm" disabled={loading} title={t('viz.refreshShortcut')}>
                {loading ? t('common.loading') : t('common.refresh')}
              </button>
              {chartData.length > 0 && (
                <button type="button" className="btn-sm" onClick={exportCSV}>{t('viz.exportCsv')}</button>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm viz-config-collapse-btn has-label"
            onClick={toggleConfigOpen}
            aria-expanded={configOpen}
            aria-controls="viz-config-panel"
            aria-label={configOpen ? t('viz.collapseConfig') : t('viz.expandConfig')}
            title={configOpen ? t('viz.collapse') : t('viz.expand')}
          >
            <span className={`viz-collapse-chevron${configOpen ? ' open' : ''}`} aria-hidden>›</span>
            <span className="viz-config-collapse-label">
              {configOpen ? t('viz.collapse') : t('viz.expand')}
            </span>
          </button>
        </div>
        {configOpen && (
        <div id="viz-config-panel" className="viz-config-panel">
        <div className="viz-config-row" aria-labelledby="viz-board-title">
          <div className="viz-config-row-head">
            <div id="viz-board-title" className="viz-config-row-title">{t('common.board')}</div>
          </div>
          <div className="viz-config-row-content viz-source-row">
            <label className="viz-source-field">
              <span className="viz-source-field-label">{t('common.board')}</span>
              <select value={selectedBoard} onChange={e => { setSelectedBoard(e.target.value); setAiChartLink(null); }}>
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
                      setSelectedSessionId('');
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
              <div
                className={`viz-time-custom-group${selectedSessionId ? ' is-active' : ''}`}
                aria-label={t('viz.sessionRange')}
              >
                <span className="viz-time-group-label">{t('viz.sessionRange')}</span>
                <select
                  className="viz-session-select"
                  value={selectedSessionId}
                  onChange={event => selectSession(event.target.value)}
                  disabled={liveMode || sessions.length === 0}
                >
                  <option value="">{t('viz.sessionAll')}</option>
                  {sessions.map(session => {
                    const end = session.end_time
                      && session.end_time !== '0001-01-01T00:00:00Z'
                      ? formatDateTime(session.end_time)
                      : '—';
                    return (
                      <option key={session.id} value={session.id}>
                        {session.name} ({formatDateTime(session.start_time)} ~ {end})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="viz-time-live-group">
                <span className="viz-time-group-label">{t('viz.liveMode')}</span>
                <div className="viz-time-live-bar">
                  <button
                    type="button"
                    className={`viz-time-live-toggle btn-live${liveMode ? ' active' : ''}`}
                    onClick={() => { setAiChartLink(null); setLiveMode(v => !v); }}
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
            {spectrum && (
              <div className={`viz-spectrum-budget${spectrumOverBudget ? ' is-over' : ''}`}>
                <span className="viz-spectrum-budget-max">
                  {t('viz.spectrumBudget.max', {
                    rows: spectrumMaxRows.toLocaleString(),
                    mb: (CHART_MEMORY_BUDGET_BYTES / 1024 / 1024).toFixed(0),
                    fields: items.length,
                  })}
                </span>
                {spectrumSelectedRows != null && (
                  <span className="viz-spectrum-budget-selected">
                    {t('viz.spectrumBudget.selected', {
                      rows: spectrumSelectedRows.toLocaleString(),
                      mb: ((spectrumSelectedBytes ?? 0) / 1024 / 1024).toFixed(1),
                    })}
                  </span>
                )}
                {spectrumSelectedRows != null && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={expandSpectrumToBudget}
                  >
                    {t('viz.spectrumBudget.fitMax')}
                  </button>
                )}
                {spectrumOverBudget && (
                  <strong className="viz-spectrum-budget-over">
                    {t('viz.spectrumBudget.over')}
                  </strong>
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
              <button
                type="button"
                className="btn-sm"
                onClick={applyAutoYLayout}
                disabled={items.length === 0 || chartData.length === 0}
                title={t('viz.autoLayoutHint')}
              >
                {t('viz.autoLayout')}
              </button>
              {autoLayoutNote && <span className="muted">{autoLayoutNote}</span>}
              {autoLayoutNote && savedProfileId && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => void saveCurrentProfile()}
                  disabled={profileSaving || !profileDirty}
                >
                  {t('viz.saveNow')}
                </button>
              )}
              <label className="viz-checked-only-toggle">
                <input
                  type="checkbox"
                  checked={checkedOnly}
                  onChange={e => setCheckedOnly(e.target.checked)}
                />
                <span>{t('viz.checkedOnly')}</span>
              </label>
              <div className="viz-add-field-group">
                <VizFieldPicker
                  fields={availableFields}
                  disabled={!boardProtocol || availableFields.length === 0}
                  placeholder={t('viz.searchFieldPlaceholder')}
                  ariaLabel={t('viz.searchFields')}
                  clearLabel={t('viz.clear')}
                  noResultsLabel={query => t('viz.noFieldMatch', { query })}
                  onAdd={addField}
                />
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
                        {p.name}{savedProfileId === p.id && profileDirty ? ' *' : ''}
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
                  {savedProfileId && (
                    <button
                      type="button"
                      className="btn-primary btn-sm viz-profile-save-btn"
                      onClick={() => void saveCurrentProfile()}
                      disabled={profileSaving || !profileDirty}
                      title={profileDirty ? t('viz.saveProfileChanges') : t('viz.profileSaved')}
                    >
                      {profileSaving ? '…' : t('viz.saveProfileChanges')}
                    </button>
                  )}
                </div>
              ) : (
                <span className="muted viz-items-header-hint">{t('viz.selectBoardForProfiles')}</span>
              )}
              {profileError && (
                <span className="viz-profile-error-inline" role="alert" title={profileError}>
                  {profileError}
                </span>
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
                    <VizOptionalNumberInput
                      value={item.y_axis.min}
                      ariaLabel={t('viz.yMinAria', { label: item.label })}
                      onCommit={min => updateItem(item.id, 'y_axis', {
                        ...item.y_axis,
                        min,
                      } as YAxisConfig)}
                    />
                  </td>
                  <td>
                    <VizOptionalNumberInput
                      value={item.y_axis.max}
                      ariaLabel={t('viz.yMaxAria', { label: item.label })}
                      onCommit={max => updateItem(item.id, 'y_axis', {
                        ...item.y_axis,
                        max,
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
            {aiChartLink?.aggregation && aiChartLink.aggregation !== 'raw' && (
              <span className="viz-ai-aggregation-badge">
                {t('viz.aiAggregation', {
                  aggregation: aiChartLink.aggregation,
                  seconds: aiChartLink.bucket_seconds ?? 60,
                })}
              </span>
            )}
          </div>
          <div className="viz-chart-toolbar">
            <button
              type="button"
              className="viz-chart-icon-btn"
              onClick={() => setChartManualOpen(true)}
              title={t('viz.manualShortcut')}
              aria-label={t('viz.manualShortcut')}
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
                disabled={!chartZoomActive && !yAxisZoomed}
                title={t('viz.resetZoom')}
                aria-label={t('viz.resetZoom')}
              >
                <IconZoomReset />
              </button>
              <button
                type="button"
                className={`viz-chart-icon-btn viz-chart-axis-range-btn${axisRangeLeft || axisRangeRight ? ' active' : ''}`}
                onClick={() => {
                  const left = chartYAxisDomains[PRIMARY_Y_AXIS_ID];
                  const right = chartYAxisDomains[SECONDARY_Y_AXIS_ID];
                  setAxisRangeDraft({
                    left: {
                      auto: !axisRangeLeft,
                      min: (axisRangeLeft?.min ?? left?.[0])?.toFixed(3) ?? '',
                      max: (axisRangeLeft?.max ?? left?.[1])?.toFixed(3) ?? '',
                    },
                    right: {
                      auto: !axisRangeRight,
                      min: (axisRangeRight?.min ?? right?.[0])?.toFixed(3) ?? '',
                      max: (axisRangeRight?.max ?? right?.[1])?.toFixed(3) ?? '',
                    },
                  });
                  setAxisRangeError('');
                  setAxisRangeOpen(true);
                }}
                title={t('viz.axisRange.title')}
                aria-label={t('viz.axisRange.title')}
                aria-pressed={!!(axisRangeLeft || axisRangeRight)}
              >
                <span className="viz-chart-axis-range-glyph">Y</span>
              </button>
              {showDetailLoadingIndicator && (
                <span
                  className="viz-chart-detail-loading-indicator"
                  role="status"
                  aria-live="polite"
                  title={detailLoadingLabel}
                  aria-label={detailLoadingLabel}
                >
                  <IconDetailLoading />
                </span>
              )}
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
                    className={`viz-chart-icon-btn viz-chart-command-btn${showCommands ? ' active' : ''}`}
                    onClick={() => setShowCommands(v => !v)}
                    title={`${t('viz.commandOverlayToggle')} (${commandEvents.length})`}
                    aria-label={t('viz.commandOverlayToggle')}
                    aria-pressed={showCommands}
                  >
                    <span className="viz-chart-axis-range-glyph">C</span>
                    {!showCommands && commandEvents.length > 0 && (
                      <span className="viz-command-badge">
                        {commandEvents.length > 999
                          ? `${(commandEvents.length / 1000).toFixed(1)}k`
                          : commandEvents.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`viz-chart-icon-btn${eventSettingsOpen ? ' active' : ''}`}
                    onClick={() => setEventSettingsOpen(v => !v)}
                    title={t('viz.eventSettings')}
                    aria-label={t('viz.eventSettings')}
                    aria-pressed={eventSettingsOpen}
                    disabled={eventConfig.length === 0}
                  >
                    <span className="viz-chart-axis-range-glyph">E</span>
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
        <div
          className={`viz-chart-progress${chartDataLoading ? ' is-active' : ''}${chartProgressPercent != null ? ' is-determinate' : ''}`}
          role="progressbar"
          aria-label={chartProgressLabel || t('viz.chartLoading')}
          aria-hidden={!chartDataLoading}
          aria-valuemin={chartProgressWholePercent != null ? 0 : undefined}
          aria-valuemax={chartProgressWholePercent != null ? 100 : undefined}
          aria-valuenow={chartProgressWholePercent ?? undefined}
        >
          <span
            className="viz-chart-progress-bar"
            style={chartProgressWholePercent != null
              ? { width: `${chartProgressWholePercent}%` }
              : undefined}
          />
        </div>
        {chartDataLoading && rawVizData.length > 0 && (
          <span className="viz-chart-progress-label">{chartProgressNode}</span>
        )}
        <div className={`viz-chart-panel-layout${fieldValuesLayout === 'left' ? ' is-left' : ''}`}>
        <div className="viz-chart-main">
        <div
          ref={chartViewportRef}
          className={`viz-chart-viewport${isChartSelecting ? ' selecting' : ''}${isChartPanning ? ' panning' : ''}${isChartMeasuring ? ' measuring' : ''}${isChartYZooming ? ' y-zooming' : ''}${chartZoomActive ? ' zoomed' : ''}${yAxisZoomed ? ' y-zoomed' : ''}${liveMode ? ' live' : ''}`}
          role="application"
          tabIndex={0}
          aria-label={t('viz.chartKeyboard.region')}
          onDoubleClick={resetChartZoom}
        >
          {selectionOverlay.overlayNode}
          {timeMeasureOverlay.overlayNode}
          {awaitingRoughData ? (
            <div className="viz-chart-empty muted viz-chart-loading-state">
              <span>{t('viz.roughSampling')}</span>
              {chartDataLoading && chartProgressLabel && (
                <span className="viz-chart-loading-detail">{chartProgressNode}</span>
              )}
            </div>
          ) : canvasChartData.length > 0 && activeChartItems.length > 0 ? (
          <VizCanvasChart
            ref={chartCanvasRef}
            points={canvasChartData}
            sessionBreakTimesSec={sessionBreakTimesSec}
            fullTimeline={inMemoryFull && chartData.length > 0 ? chartData : undefined}
            windowIndices={canvasWindowIndices}
            xWindowTimeKeys={canvasXWindowTimeKeys}
            yDomainOverrideKey={yDomainOverrideKey}
            filterPointsToXWindow={!canvasClipViewport}
            chartItems={chartItems}
            maxVisibleSeries={MAX_CHART_SERIES}
            yAxisDomains={canvasYAxisDomains}
            yAxes={canvasYAxes}
            digitalLanes={digitalLanes}
            digitalLaneCount={digitalChartItems.length}
            chartLabel={chartLabel}
            resolveYScale={resolveCanvasYScale}
            height={chartViewportHeight}
            tooltipEnabled={chartTooltipEnabled}
            commandEvents={chartCommandEvents}
            showCommands={showCommands}
            hideTooltip={chartInteractionHidden}
            itemById={tooltipItemById}
            rawValuesByTimeKey={rawValuesByTimeKey}
            onHoverTimeKey={handleChartHoverTimeKey}
            onPlotBoundsChange={handleChartPlotBoundsChange}
            formatYTick={formatYAxisTick}
            formatTooltipValue={formatVizItemActualValue}
          />
          ) : showDetailLoadingIndicator && chartZoomActive && chartData.length > 0 ? (
            <p className="viz-chart-empty muted">{detailLoadingLabel}</p>
          ) : canvasChartData.length > 0 && items.length > 0 ? (
            <p className="viz-chart-empty muted">{t('viz.noVisibleItems')}</p>
          ) : chartEmptyMessage ? (
            <div className="viz-chart-empty muted viz-chart-loading-state">
              <span>{chartEmptyMessage}</span>
              {chartDataLoading && chartProgressLabel && (
                <span className="viz-chart-loading-detail">{chartProgressNode}</span>
              )}
            </div>
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
            panelHeight={chartViewportHeight}
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
                  const fmt = (v: number) => formatVizActualValue(v, unit);
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
      <Modal
        open={axisRangeOpen}
        onClose={() => setAxisRangeOpen(false)}
        title={t('viz.axisRange.title')}
        footer={(
          <>
            <button type="button" className="btn-ghost" onClick={() => setAxisRangeOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={applyAxisRanges}>
              {t('viz.axisRange.apply')}
            </button>
          </>
        )}
      >
        <p className="muted viz-axis-range-hint">{t('viz.axisRange.hint')}</p>
        {axisRangeError && <p className="viz-axis-range-error">{axisRangeError}</p>}
        <div className="viz-axis-range-grid">
          {([
            ['left', t('viz.yAxisSide.left'), axisRangeDraft.left, hasAnalogLeftAxis, false],
            ['right', t('viz.yAxisSide.right'), axisRangeDraft.right, hasAnalogRightAxis, digitalChartItems.length > 0],
          ] as const).map(([side, label, draft, available, hasDigital]) => {
            const digitalOnly = side === 'right' && hasDigital && !available;
            return (
              <div className={`viz-axis-range-card${available ? '' : ' is-unavailable'}`} key={side}>
                <div className="viz-axis-range-card-head">
                  <strong>
                    {label}
                    {digitalOnly ? ` · ${t('viz.axisRange.digitalCard')}` : ''}
                  </strong>
                  <label className="viz-axis-range-auto">
                    <input
                      type="checkbox"
                      checked={draft.auto}
                      disabled={!available}
                      onChange={e => setAxisRangeDraft(prev => ({
                        ...prev,
                        [side]: { ...prev[side], auto: e.target.checked },
                      }))}
                    />
                    {t('viz.axisRange.auto')}
                  </label>
                </div>
                <div className="viz-axis-range-inputs">
                  <label className="settings-field">
                    <span>{t('viz.yMin')}</span>
                    <input
                      type="number"
                      value={draft.min}
                      disabled={!available || draft.auto}
                      onChange={e => setAxisRangeDraft(prev => ({
                        ...prev,
                        [side]: { ...prev[side], min: e.target.value, auto: false },
                      }))}
                    />
                  </label>
                  <label className="settings-field">
                    <span>{t('viz.yMax')}</span>
                    <input
                      type="number"
                      value={draft.max}
                      disabled={!available || draft.auto}
                      onChange={e => setAxisRangeDraft(prev => ({
                        ...prev,
                        [side]: { ...prev[side], max: e.target.value, auto: false },
                      }))}
                    />
                  </label>
                </div>
                {!available && (
                  <p className="muted viz-axis-range-card-note">
                    {digitalOnly
                      ? t('viz.axisRange.digitalOnlyNote')
                      : t('viz.axisRange.noAnalogNote')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="muted viz-axis-range-hint">{t('viz.axisRange.digitalHint')}</p>
      </Modal>
      <Modal
        open={eventSettingsOpen}
        onClose={() => setEventSettingsOpen(false)}
        title={t('viz.eventSettings')}
        footer={(
          <button type="button" className="btn-primary" onClick={() => setEventSettingsOpen(false)}>
            {t('common.close')}
          </button>
        )}
      >
        <p className="muted">{t('viz.eventSettingsHint')}</p>
        <div className="viz-event-settings-list">
          {eventConfig.map(cfg => {
            const key = vizFidKey(cfg.fid);
            const override = eventOverrides[key] ?? {};
            const type = override.type ?? cfg.type ?? 'event';
            const visible = override.visible ?? cfg.visible;
            return (
              <div className="viz-event-settings-row" key={cfg.fid}>
                <label>
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={e => setEventOverrides(prev => ({
                      ...prev,
                      [key]: { ...prev[key], visible: e.target.checked },
                    }))}
                  />
                  <span>{cfg.kind} <code>{cfg.fid}</code></span>
                </label>
                <select
                  value={type}
                  onChange={e => setEventOverrides(prev => ({
                    ...prev,
                    [key]: { ...prev[key], type: e.target.value },
                  }))}
                >
                  <option value="event">{t('viz.eventTypeEvent')}</option>
                  <option value="series">{t('viz.eventTypeSeries')}</option>
                </select>
              </div>
            );
          })}
        </div>
        <p className="muted">{t('viz.eventSettingsSaveHint')}</p>
      </Modal>
      <ChartHelpManual open={chartManualOpen} onClose={() => setChartManualOpen(false)} />
    </div>
  );
}
