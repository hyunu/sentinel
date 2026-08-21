import {
  findNearestChartIndexForTimeMs,
  type ChartTimePoint,
} from './vizChartInteraction';
import {
  centerChartZoomTimeRange,
  chartZoomRangeFromTimeMs,
  shiftChartZoomTimeRange,
} from './vizChartZoomTime';

export interface NavigatorWindow {
  start: number;
  end: number;
  startTs?: string;
  endTs?: string;
}

function parseTimeMs(timeKey: string | undefined): number | null {
  if (!timeKey) return null;
  const ms = Date.parse(timeKey);
  return Number.isFinite(ms) ? ms : null;
}

function fullTimeSpanMs(points: ChartTimePoint[]): { startMs: number; endMs: number } | null {
  if (points.length === 0) return null;
  const startMs = parseTimeMs(points[0]?.timeKey);
  const endMs = parseTimeMs(points[points.length - 1]?.timeKey);
  if (startMs == null || endMs == null || endMs <= startMs) return null;
  return { startMs, endMs };
}

/** Thumb position on the minimap track — time-based when timestamps are available. */
export function computeNavigatorRangePercent(
  range: NavigatorWindow,
  chartData: ChartTimePoint[],
  totalMatched?: number,
  returned?: number,
): { leftPct: number; widthPct: number } {
  const total = chartData.length;
  if (total <= 0) return { leftPct: 0, widthPct: 100 };

  const span = fullTimeSpanMs(chartData);
  const rangeStartMs = range.startTs
    ? parseTimeMs(range.startTs)
    : parseTimeMs(chartData[range.start]?.timeKey);
  const rangeEndMs = range.endTs
    ? parseTimeMs(range.endTs)
    : parseTimeMs(chartData[range.end]?.timeKey);
  if (
    span
    && rangeStartMs != null
    && rangeEndMs != null
  ) {
    const spanMs = span.endMs - span.startMs;
    return {
      leftPct: ((rangeStartMs - span.startMs) / spanMs) * 100,
      widthPct: Math.max(0, ((rangeEndMs - rangeStartMs) / spanMs) * 100),
    };
  }

  const returnedCount = returned ?? total;
  const matchedTotal = totalMatched ?? returnedCount;
  if (matchedTotal > returnedCount && returnedCount > 1) {
    const toRank = (index: number) => (index / (returnedCount - 1)) * (matchedTotal - 1);
    const docStart = toRank(range.start);
    const docEnd = toRank(range.end);
    const denom = Math.max(1, matchedTotal - 1);
    return {
      leftPct: (docStart / denom) * 100,
      widthPct: Math.max(0, ((docEnd - docStart) / denom) * 100),
    };
  }

  const indexSpan = range.end - range.start + 1;
  return {
    leftPct: (range.start / total) * 100,
    widthPct: (indexSpan / total) * 100,
  };
}

export function navigatorIndexFromTrackRatio(
  ratio: number,
  chartData: ChartTimePoint[],
): number {
  const total = chartData.length;
  if (total <= 0) return 0;
  if (total === 1) return 0;

  const clamped = Math.max(0, Math.min(1, ratio));
  const span = fullTimeSpanMs(chartData);
  if (span) {
    const targetMs = span.startMs + clamped * (span.endMs - span.startMs);
    return findNearestChartIndexForTimeMs(chartData, targetMs, total);
  }
  return Math.round(clamped * (total - 1));
}

export function shiftNavigatorWindowByTrackDelta(
  chartData: ChartTimePoint[],
  zoomStart: number,
  zoomEnd: number,
  deltaPx: number,
  trackWidthPx: number,
  windowTimeKeys?: { startTs: string; endTs: string },
): NavigatorWindow {
  const total = chartData.length;
  if (total <= 0 || trackWidthPx <= 0) return { start: 0, end: 0 };

  const span = fullTimeSpanMs(chartData);
  const explicitStartMs = parseTimeMs(windowTimeKeys?.startTs);
  const explicitEndMs = parseTimeMs(windowTimeKeys?.endTs);
  const s = Math.max(0, Math.min(zoomStart, total - 1));
  const e = Math.max(s, Math.min(zoomEnd, total - 1));
  const startMs = explicitStartMs ?? parseTimeMs(chartData[s]?.timeKey);
  const endMs = explicitEndMs ?? parseTimeMs(chartData[e]?.timeKey);

  if (span && startMs != null && endMs != null && endMs > startMs) {
    const fullSpanMs = span.endMs - span.startMs;
    const deltaMs = (deltaPx / trackWidthPx) * fullSpanMs;
    const shifted = shiftChartZoomTimeRange(
      { startMs, endMs },
      deltaMs,
      span.startMs,
      span.endMs,
    );
    const next = chartZoomRangeFromTimeMs(
      chartData,
      shifted.startMs,
      shifted.endMs,
      total,
    );
    return next;
  }

  const shift = Math.round((deltaPx / trackWidthPx) * total);
  let newStart = s + shift;
  let newEnd = e + shift;
  if (newStart < 0) {
    newEnd -= newStart;
    newStart = 0;
  }
  if (newEnd >= total) {
    newStart -= newEnd - total + 1;
    newEnd = total - 1;
  }
  return { start: newStart, end: newEnd };
}

export function centerNavigatorWindowAtRatio(
  chartData: ChartTimePoint[],
  focusRatio: number,
  spanPoints: number,
  windowTimeKeys?: { startTs: string; endTs: string },
): NavigatorWindow {
  const total = chartData.length;
  if (total <= 0) return { start: 0, end: 0 };

  const span = fullTimeSpanMs(chartData);
  const explicitStartMs = parseTimeMs(windowTimeKeys?.startTs);
  const explicitEndMs = parseTimeMs(windowTimeKeys?.endTs);
  if (
    span
    && explicitStartMs != null
    && explicitEndMs != null
    && explicitEndMs > explicitStartMs
  ) {
    const focusMs = span.startMs + Math.max(0, Math.min(1, focusRatio)) * (span.endMs - span.startMs);
    const centered = centerChartZoomTimeRange(
      focusMs,
      explicitEndMs - explicitStartMs,
      span.startMs,
      span.endMs,
    );
    return chartZoomRangeFromTimeMs(
      chartData,
      centered.startMs,
      centered.endMs,
      total,
    );
  }

  const focusIndex = navigatorIndexFromTrackRatio(focusRatio, chartData);
  const pointSpan = Math.max(1, Math.min(total, spanPoints));
  let newStart = Math.round(focusIndex - (pointSpan - 1) / 2);
  let newEnd = newStart + pointSpan - 1;
  if (newStart < 0) {
    newEnd -= newStart;
    newStart = 0;
  }
  if (newEnd >= total) {
    newStart -= newEnd - total + 1;
    newEnd = total - 1;
  }
  return { start: newStart, end: newEnd };
}
