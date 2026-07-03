import type { VizItem } from '../api';

export const PRIMARY_Y_AXIS_ID = 'y-left';
export const SECONDARY_Y_AXIS_ID = 'y-right';

export type VizChartPoint = { timeKey: string } & Record<string, string | number>;

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
  if (bothFixed) return [min, max];
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}
