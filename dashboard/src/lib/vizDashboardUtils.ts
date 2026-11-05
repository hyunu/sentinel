import type { VizItem } from '../api';

export const PRIMARY_Y_AXIS_ID = 'y-left';
export const SECONDARY_Y_AXIS_ID = 'y-right';

export type VizChartPoint = { timeKey: string } & Record<string, string | number>;

export function vizFidKey(fid: number | string): string {
  if (typeof fid === 'number') {
    return `0x${fid.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  const hex = fid.replace(/^0x/i, '').toUpperCase();
  return `0x${hex.padStart(2, '0')}`;
}

export function clampChartZoom(start: number, end: number, length: number): { start: number; end: number } {
  if (length <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, length - 1));
  const e = Math.max(s, Math.min(end, length - 1));
  return { start: s, end: e };
}

export function vizErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function yAxisOptionLabel(axisId: string, tr: (key: string) => string): string {
  if (axisId === PRIMARY_Y_AXIS_ID) return tr('viz.yAxisSide.left');
  if (axisId === SECONDARY_Y_AXIS_ID) return tr('viz.yAxisSide.right');
  return axisId;
}

/**
 * On/off fields are detected by their protocol field name. LCP exposes them as
 * `*_ison`, `*_isopen`, `*_isempty`, `*_iscomplete...`, etc. These are rendered
 * as stacked digital lanes so they never share a scale with RPM/analog values.
 */
export function isDigitalVizItem(item: VizItem): boolean {
  const field = item.field_ref.field_name.toLowerCase();
  return /(?:^|_)(?:is[a-z0-9]+|on|off|enabled|disabled)$/.test(field);
}

/** True when the profile pins this item's Y range explicitly. */
export function hasExplicitYBounds(item: VizItem): boolean {
  return item.y_axis.min != null || item.y_axis.max != null;
}

/**
 * On/off items normally use a stacked digital lane. Setting an explicit Y
 * min/max is an opt-out: the item is then drawn as a 0/1 line on its Y axis,
 * so the configured range is actually visible.
 */
export function usesDigitalLane(item: VizItem): boolean {
  return isDigitalVizItem(item) && !hasExplicitYBounds(item);
}

export const DIGITAL_LANE_STEP = 1.2;
export const DIGITAL_LANE_HEIGHT = 0.8;

/** Fixed digital-lane value for an on/off raw value (0/1). */
export function digitalLaneValue(
  raw: number,
  laneIndex: number,
  laneCount: number,
): number {
  const count = Math.max(1, laneCount);
  const max = count * DIGITAL_LANE_STEP;
  const base = max - (laneIndex + 1) * DIGITAL_LANE_STEP;
  return base + (raw > 0.5 ? DIGITAL_LANE_HEIGHT : 0);
}

export function digitalLaneDomain(laneCount: number, reservedRatio: number): [number, number] {
  const count = Math.max(1, laneCount);
  const max = count * DIGITAL_LANE_STEP;
  const ratio = Math.max(0.05, Math.min(1, reservedRatio));
  return [-max * (1 / ratio - 1), max];
}

/** Raw field value from a timestamp row (before offset/weight). */
export function resolveVizItemRawValue(
  item: VizItem,
  valuesAtTime?: Record<string, number>,
): number | undefined {
  if (!valuesAtTime) return undefined;
  for (const key of [item.label, item.field_ref.field_name]) {
    const v = valuesAtTime[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  return undefined;
}

export function applyVizItemTransform(raw: number, item: VizItem): number {
  return raw * item.weight + item.offset;
}

/**
 * Chart-space value for a raw sample. On/off items are binarized; when they are
 * drawn on a Y axis (explicit bounds) they also honor offset/weight so the
 * auto-layout can stack them below analog series.
 */
export function vizChartValue(raw: number, item: VizItem): number {
  if (!isDigitalVizItem(item)) return applyVizItemTransform(raw, item);
  const binary = raw > 0.5 ? 1 : 0;
  if (usesDigitalLane(item)) return binary;
  return applyVizItemTransform(binary, item);
}

export function formatVizActualValue(value: number, unit?: string): string {
  const text = value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const u = unit?.trim();
  return u ? `${text} ${u}` : text;
}

/** Tooltip / field panel: always show stored raw value, not chart transform. */
export function formatVizItemActualValue(
  item: VizItem | undefined,
  rawValuesAtTime: Record<string, number> | undefined,
  chartValue: unknown,
): string {
  if (!item) return chartValue != null ? String(chartValue) : '';
  const unit = item.y_axis.unit?.trim();
  const raw = resolveVizItemRawValue(item, rawValuesAtTime);
  if (typeof raw === 'number') {
    return formatVizActualValue(raw, unit);
  }
  if (typeof chartValue === 'number' && !Number.isNaN(chartValue) && item.weight !== 0) {
    const inferred = (chartValue - item.offset) / item.weight;
    if (Number.isFinite(inferred)) {
      return formatVizActualValue(inferred, unit);
    }
  }
  if (typeof chartValue === 'number' && !Number.isNaN(chartValue)) {
    return formatVizActualValue(chartValue, unit);
  }
  const base = chartValue != null ? String(chartValue) : '';
  return unit && base ? `${base} ${unit}` : base;
}

export function computeYAxisDomain(data: VizChartPoint[], axisItems: VizItem[]): [number, number] | undefined {
  if (axisItems.length === 0 || data.length === 0) return undefined;
  const itemIds = axisItems.map(i => i.id);
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const point of data) {
    for (const id of itemIds) {
      const v = point[id];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
  }

  const fixedMins = axisItems
    .map(i => i.y_axis.min)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const fixedMaxs = axisItems
    .map(i => i.y_axis.max)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));

  let min: number;
  let max: number;
  if (fixedMins.length) {
    min = Math.min(...fixedMins);
  } else if (Number.isFinite(dataMin)) {
    min = dataMin;
  } else {
    return undefined;
  }

  if (fixedMaxs.length) {
    max = Math.max(...fixedMaxs);
  } else if (Number.isFinite(dataMax)) {
    max = dataMax;
  } else {
    return undefined;
  }

  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return [min - pad, max + pad];
  }
  const bothFixed = fixedMins.length > 0 && fixedMaxs.length > 0;
  if (bothFixed) {
    // Both ends are explicit. Keep them ordered: an inverted pair would make
    // uPlot draw an empty axis (e.g. min=10, max=-10).
    return min < max ? [min, max] : [max, min];
  }
  if (max < min) {
    // A one-sided bound can sit outside the data (only max=-5 with positive
    // data). Widen the other end instead of returning an inverted range.
    const span = Math.max(Math.abs(min), Math.abs(max), 1) * 0.05;
    if (fixedMins.length > 0) {
      max = min + span;
    } else {
      min = max - span;
    }
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

export interface AutoYLayoutUpdate {
  id: string;
  offset: number;
  weight: number;
  yAxisId: string;
  min: number;
  max: number;
}

export interface AutoYLayoutResult {
  updates: AutoYLayoutUpdate[];
  axis: [number, number];
}

/**
 * Build a deterministic Y layout: visible on/off items are stacked below the
 * visible analog series with a fixed band height and spacing, and their
 * min/max are pinned so the axis stops re-deriving bounds from data.
 *
 * Returns undefined when there is no analog data or no visible on/off item.
 */
export function computeAutoYLayout(
  items: VizItem[],
  data: VizChartPoint[],
  primaryAxisId: string = PRIMARY_Y_AXIS_ID,
): AutoYLayoutResult | undefined {
  if (data.length === 0) return undefined;
  const digital = items.filter(i => i.visible && isDigitalVizItem(i));
  if (digital.length === 0) return undefined;

  const primaryAnalog = items.filter(i =>
    i.visible && !isDigitalVizItem(i) && i.y_axis.id === primaryAxisId);
  const analog = primaryAnalog.length > 0
    ? primaryAnalog
    : items.filter(i => i.visible && !isDigitalVizItem(i));

  let analogMin = Infinity;
  let analogMax = -Infinity;
  for (const point of data) {
    for (const item of analog) {
      const v = point[item.id];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        if (v < analogMin) analogMin = v;
        if (v > analogMax) analogMax = v;
      }
    }
  }
  if (!Number.isFinite(analogMin) || !Number.isFinite(analogMax)) return undefined;

  const span = analogMax - analogMin > 0 ? analogMax - analogMin : Math.abs(analogMax) || 1;
  const band = span * 0.02;
  const gap = band * 1.6;
  const pad = span * 0.05;
  const axisMin = analogMin - gap * digital.length - band - pad;
  const axisMax = analogMax + pad;

  const updates = digital.map((item, index) => ({
    id: item.id,
    offset: analogMin - gap * (index + 1) - band,
    weight: band,
    yAxisId: primaryAxisId,
    min: axisMin,
    max: axisMax,
  }));

  return { updates, axis: [axisMin, axisMax] };
}
