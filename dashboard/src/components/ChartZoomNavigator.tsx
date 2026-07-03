import { useCallback, useEffect, useMemo, useRef } from 'react';

type ChartPoint = { timeKey: string } & Record<string, string | number>;

export interface ChartZoomRange {
  start: number;
  end: number;
}

interface ChartZoomNavigatorProps {
  chartData: ChartPoint[];
  chartZoom: ChartZoomRange;
  sparkItemId?: string;
  formatTime: (iso: string) => string;
  onWindowChange: (start: number, end: number) => void;
  totalMatched?: number;
  returned?: number;
  downsampled?: boolean;
}

function clampWindow(start: number, end: number, total: number): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, total - 1));
  const e = Math.max(s, Math.min(end, total - 1));
  return { start: s, end: e };
}

function sparklineValue(point: ChartPoint, itemId: string): number | null {
  const raw = point[itemId];
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  return null;
}

function decimateSparklineMinMax(
  data: ChartPoint[],
  itemId: string,
  maxPoints: number,
): ChartPoint[] {
  if (!itemId || data.length <= maxPoints) return data;

  const targetBuckets = Math.max(2, maxPoints - 1);
  const bucketSize = data.length / targetBuckets;
  const chosenIndices = new Set<number>([0, data.length - 1]);

  for (let b = 0; b < targetBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(data.length, Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    const firstVal = sparklineValue(data[start], itemId);
    if (firstVal == null) continue;
    let minVal = firstVal;
    let maxVal = firstVal;

    for (let i = start + 1; i < end; i++) {
      const v = sparklineValue(data[i], itemId);
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
  return points;
}

function computeThumbPercent(
  windowRange: { start: number; end: number },
  chartData: ChartPoint[],
  totalMatched?: number,
  returned?: number,
): { leftPct: number; widthPct: number } {
  const total = chartData.length;
  if (total <= 0) return { leftPct: 0, widthPct: 100 };

  const span = windowRange.end - windowRange.start + 1;
  const returnedCount = returned ?? total;
  const matchedTotal = totalMatched ?? returnedCount;

  if (matchedTotal > returnedCount && returnedCount > 1) {
    const toRank = (index: number) => (index / (returnedCount - 1)) * (matchedTotal - 1);
    const docStart = toRank(windowRange.start);
    const docEnd = toRank(windowRange.end);
    const denom = Math.max(1, matchedTotal - 1);
    return {
      leftPct: (docStart / denom) * 100,
      widthPct: Math.max(0, ((docEnd - docStart) / denom) * 100),
    };
  }

  const fullStartMs = Date.parse(chartData[0]?.timeKey ?? '');
  const fullEndMs = Date.parse(chartData[total - 1]?.timeKey ?? '');
  const rangeStartMs = Date.parse(chartData[windowRange.start]?.timeKey ?? '');
  const rangeEndMs = Date.parse(chartData[windowRange.end]?.timeKey ?? '');
  if (
    Number.isFinite(fullStartMs)
    && Number.isFinite(fullEndMs)
    && fullEndMs > fullStartMs
    && Number.isFinite(rangeStartMs)
    && Number.isFinite(rangeEndMs)
  ) {
    const spanMs = fullEndMs - fullStartMs;
    return {
      leftPct: ((rangeStartMs - fullStartMs) / spanMs) * 100,
      widthPct: Math.max(0, ((rangeEndMs - rangeStartMs) / spanMs) * 100),
    };
  }

  return {
    leftPct: (windowRange.start / total) * 100,
    widthPct: (span / total) * 100,
  };
}

function buildSparklinePolyline(
  data: ChartPoint[],
  itemId: string | undefined,
  width: number,
  height: number,
): string {
  if (!itemId || data.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  const values: number[] = [];
  for (const point of data) {
    const raw = point[itemId];
    const value = typeof raw === 'number' && !Number.isNaN(raw) ? raw : NaN;
    values.push(value);
    if (Number.isFinite(value)) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '';

  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    const x = i * stepX;
    const y = height - ((value - min) / range) * height;
    parts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

export default function ChartZoomNavigator({
  chartData,
  chartZoom,
  sparkItemId,
  formatTime,
  onWindowChange,
  totalMatched,
  returned,
  downsampled,
}: ChartZoomNavigatorProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    zoomStart: number;
    zoomEnd: number;
  } | null>(null);
  const onWindowChangeRef = useRef(onWindowChange);
  onWindowChangeRef.current = onWindowChange;

  const total = chartData.length;
  const windowRange = useMemo(
    () => clampWindow(chartZoom.start, chartZoom.end, total),
    [chartZoom.end, chartZoom.start, total],
  );
  const span = windowRange.end - windowRange.start + 1;
  const { leftPct, widthPct } = useMemo(
    () => computeThumbPercent(windowRange, chartData, totalMatched, returned),
    [windowRange, chartData, totalMatched, returned],
  );

  const sparkData = useMemo(
    () => decimateSparklineMinMax(chartData, sparkItemId ?? '', 160),
    [chartData, sparkItemId],
  );
  const sparkline = useMemo(
    () => buildSparklinePolyline(sparkData, sparkItemId, 100, 20),
    [sparkData, sparkItemId],
  );

  const moveWindowToRatio = useCallback((focusRatio: number) => {
    if (total <= 0) return;
    const focusIndex = Math.round(Math.max(0, Math.min(1, focusRatio)) * (total - 1));
    let newStart = Math.round(focusIndex - (span - 1) / 2);
    let newEnd = newStart + span - 1;
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd >= total) {
      newStart -= newEnd - total + 1;
      newEnd = total - 1;
    }
    onWindowChangeRef.current(newStart, newEnd);
  }, [span, total]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      const track = trackRef.current;
      if (!session || session.pointerId !== e.pointerId || !track) return;

      const rect = track.getBoundingClientRect();
      if (rect.width <= 0 || total <= 0) return;

      const shift = Math.round(((e.clientX - session.startX) / rect.width) * total);
      let newStart = session.zoomStart + shift;
      let newEnd = session.zoomEnd + shift;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd >= total) {
        newStart -= newEnd - total + 1;
        newEnd = total - 1;
      }
      onWindowChangeRef.current(newStart, newEnd);
    };

    const endDrag = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;
      dragSessionRef.current = null;
      const track = trackRef.current;
      if (track?.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [total]);

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('.viz-chart-navigator-thumb')) return;

    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    moveWindowToRatio((e.clientX - rect.left) / rect.width);
  };

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      zoomStart: windowRange.start,
      zoomEnd: windowRange.end,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const rangeStart = chartData[windowRange.start]?.timeKey;
  const rangeEnd = chartData[windowRange.end]?.timeKey;
  const fullStart = chartData[0]?.timeKey;
  const fullEnd = chartData[total - 1]?.timeKey;

  const returnedCount = returned ?? total;
  const matchedTotal = totalMatched ?? returnedCount;
  const scaleLabel = downsampled && matchedTotal > returnedCount
    ? `${returnedCount.toLocaleString()} / ${matchedTotal.toLocaleString()} records`
    : null;

  return (
    <div
      className={`viz-chart-navigator${widthPct >= 99.5 ? ' is-full-range' : ''}`}
      aria-label="Chart zoom position"
    >
      <div
        ref={trackRef}
        className="viz-chart-navigator-track"
        onPointerDown={onTrackPointerDown}
        role="presentation"
      >
        {sparkline && (
          <svg
            className="viz-chart-navigator-sparkline"
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            aria-hidden
          >
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
              points={sparkline}
            />
          </svg>
        )}
        <div
          className="viz-chart-navigator-thumb"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={onThumbPointerDown}
          role="slider"
          aria-label="Zoomed time range"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, total - 1)}
          aria-valuenow={windowRange.start}
          aria-valuetext={
            rangeStart && rangeEnd
              ? `${formatTime(rangeStart)} to ${formatTime(rangeEnd)}`
              : undefined
          }
        />
      </div>
      <div className="viz-chart-navigator-labels">
        <span>{fullStart ? formatTime(fullStart) : '—'}</span>
        <span className="viz-chart-navigator-range">
          {rangeStart && rangeEnd ? `${formatTime(rangeStart)} – ${formatTime(rangeEnd)}` : '—'}
          {scaleLabel && (
            <span className="viz-chart-navigator-scale">{scaleLabel}</span>
          )}
        </span>
        <span>{fullEnd ? formatTime(fullEnd) : '—'}</span>
      </div>
    </div>
  );
}
