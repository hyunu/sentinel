import type { ChartTimePoint } from './vizChartInteraction';
import {
  findChartIndexLowerBoundForTimeMs,
  findChartIndexUpperBoundForTimeMs,
} from './vizChartInteraction';
import { MIN_CHART_ZOOM_SPAN_MS } from './vizChartConstants';

export interface ChartZoomTimeRange {
  startMs: number;
  endMs: number;
}

export function parseChartTimeMs(timeKey: string | undefined): number | null {
  if (!timeKey) return null;
  const ms = Date.parse(timeKey);
  return Number.isFinite(ms) ? ms : null;
}

export function chartTimeMsToKey(ms: number): string {
  return new Date(ms).toISOString();
}

export function fullChartTimeSpan(points: ChartTimePoint[]): ChartZoomTimeRange | null {
  if (points.length === 0) return null;
  const startMs = parseChartTimeMs(points[0]?.timeKey);
  const endMs = parseChartTimeMs(points[points.length - 1]?.timeKey);
  if (startMs == null || endMs == null || endMs <= startMs) return null;
  return { startMs, endMs };
}

export function resolveChartZoomTimeRange(
  points: ChartTimePoint[],
  zoom: { start: number; end: number; startTs?: string; endTs?: string } | null | undefined,
  totalLength: number,
): ChartZoomTimeRange | null {
  const span = fullChartTimeSpan(points);
  if (!span) return null;

  if (zoom?.startTs && zoom?.endTs) {
    const startMs = parseChartTimeMs(zoom.startTs);
    const endMs = parseChartTimeMs(zoom.endTs);
    if (startMs != null && endMs != null && endMs > startMs) {
      return { startMs, endMs };
    }
  }

  if (!zoom) return span;

  const len = totalLength;
  const s = Math.max(0, Math.min(zoom.start, len - 1));
  const e = Math.max(s, Math.min(zoom.end, len - 1));
  const startMs = parseChartTimeMs(points[s]?.timeKey);
  const endMs = parseChartTimeMs(points[e]?.timeKey);
  if (startMs == null || endMs == null || endMs <= startMs) return null;
  return { startMs, endMs };
}

export function minChartZoomSpanMs(fullSpanMs: number, pointCount: number, minPoints: number): number {
  if (pointCount <= 0 || fullSpanMs <= 0) return MIN_CHART_ZOOM_SPAN_MS;
  const pointBased = (fullSpanMs * minPoints) / pointCount;
  return Math.min(pointBased, MIN_CHART_ZOOM_SPAN_MS);
}

export function clampTimeRangeToSpan(
  startMs: number,
  endMs: number,
  fullStartMs: number,
  fullEndMs: number,
): ChartZoomTimeRange {
  let nextStart = startMs;
  let nextEnd = endMs;
  if (nextStart < fullStartMs) {
    nextEnd += fullStartMs - nextStart;
    nextStart = fullStartMs;
  }
  if (nextEnd > fullEndMs) {
    nextStart -= nextEnd - fullEndMs;
    nextEnd = fullEndMs;
  }
  nextStart = Math.max(fullStartMs, nextStart);
  nextEnd = Math.min(fullEndMs, nextEnd);
  if (nextEnd <= nextStart) {
    return { startMs: fullStartMs, endMs: fullEndMs };
  }
  return { startMs: nextStart, endMs: nextEnd };
}

/** Wheel zoom on continuous time — focus stays under the cursor, span scales by factor. */
export function computeWheelZoomTimeRange(
  current: ChartZoomTimeRange,
  focusMs: number,
  factor: number,
  fullStartMs: number,
  fullEndMs: number,
  minSpanMs: number,
): ChartZoomTimeRange {
  const currentSpanMs = Math.max(1, current.endMs - current.startMs);
  const spanMs = Math.max(minSpanMs, currentSpanMs * factor);
  const focusRatio = (focusMs - current.startMs) / currentSpanMs;
  let newStartMs = focusMs - focusRatio * spanMs;
  let newEndMs = newStartMs + spanMs;
  return clampTimeRangeToSpan(newStartMs, newEndMs, fullStartMs, fullEndMs);
}

export function computePanTimeRange(
  current: ChartZoomTimeRange,
  deltaX: number,
  plotWidth: number,
  fullStartMs: number,
  fullEndMs: number,
): ChartZoomTimeRange {
  if (plotWidth <= 0) return current;
  const spanMs = current.endMs - current.startMs;
  const deltaMs = -(deltaX / plotWidth) * spanMs;
  return clampTimeRangeToSpan(
    current.startMs + deltaMs,
    current.endMs + deltaMs,
    fullStartMs,
    fullEndMs,
  );
}

export function isFullChartTimeRange(
  range: ChartZoomTimeRange,
  fullStartMs: number,
  fullEndMs: number,
): boolean {
  const fullSpanMs = fullEndMs - fullStartMs;
  if (fullSpanMs <= 0) return true;
  return range.endMs - range.startMs >= fullSpanMs - 1;
}

export function chartZoomRangeFromTimeMs(
  points: ChartTimePoint[],
  startMs: number,
  endMs: number,
  totalLength: number,
): { start: number; end: number; startTs: string; endTs: string } {
  const len = totalLength;
  if (len <= 0) {
    const ts = chartTimeMsToKey(startMs);
    return { start: 0, end: 0, startTs: ts, endTs: chartTimeMsToKey(endMs) };
  }
  let start = findChartIndexLowerBoundForTimeMs(points, startMs);
  let end = findChartIndexUpperBoundForTimeMs(points, endMs);
  if (end < start) end = start;
  return {
    start: Math.max(0, start),
    end: Math.min(len - 1, end),
    startTs: chartTimeMsToKey(startMs),
    endTs: chartTimeMsToKey(endMs),
  };
}

export function shiftChartZoomTimeRange(
  current: ChartZoomTimeRange,
  deltaMs: number,
  fullStartMs: number,
  fullEndMs: number,
): ChartZoomTimeRange {
  return clampTimeRangeToSpan(
    current.startMs + deltaMs,
    current.endMs + deltaMs,
    fullStartMs,
    fullEndMs,
  );
}

export function centerChartZoomTimeRange(
  focusMs: number,
  spanMs: number,
  fullStartMs: number,
  fullEndMs: number,
): ChartZoomTimeRange {
  let startMs = focusMs - spanMs / 2;
  let endMs = startMs + spanMs;
  return clampTimeRangeToSpan(startMs, endMs, fullStartMs, fullEndMs);
}
