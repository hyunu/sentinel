import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../i18n';

type ChartPoint = { timeKey: string } & Record<string, string | number>;

export interface ChartZoomRange {
  start: number;
  end: number;
}

interface ChartZoomNavigatorProps {
  chartData: ChartPoint[];
  chartZoom: ChartZoomRange;
  sparkItemIds?: string[];
  formatTime: (iso: string) => string;
  onWindowChange: (start: number, end: number) => void;
  totalMatched?: number;
  returned?: number;
  downsampled?: boolean;
  disabled?: boolean;
}

const DENSITY_BIN_COUNT = 160;
const MIN_SELECT_POINTS = 3;

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

function sparklineMaxValue(point: ChartPoint, itemIds: string[]): number | null {
  let max: number | null = null;
  for (const id of itemIds) {
    const v = sparklineValue(point, id);
    if (v == null) continue;
    if (max == null || v > max) max = v;
  }
  return max;
}

function decimateSparklineMinMax(
  data: ChartPoint[],
  itemIds: string[],
  maxPoints: number,
): ChartPoint[] {
  if (itemIds.length === 0 || data.length <= maxPoints) return data;

  const targetBuckets = Math.max(2, maxPoints - 1);
  const bucketSize = data.length / targetBuckets;
  const chosenIndices = new Set<number>([0, data.length - 1]);

  for (let b = 0; b < targetBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(data.length, Math.floor((b + 1) * bucketSize));
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    const firstVal = sparklineMaxValue(data[start], itemIds);
    if (firstVal == null) continue;
    let minVal = firstVal;
    let maxVal = firstVal;

    for (let i = start + 1; i < end; i++) {
      const v = sparklineMaxValue(data[i], itemIds);
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

function computeRangePercent(
  range: { start: number; end: number },
  chartData: ChartPoint[],
  totalMatched?: number,
  returned?: number,
): { leftPct: number; widthPct: number } {
  const total = chartData.length;
  if (total <= 0) return { leftPct: 0, widthPct: 100 };

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

  const fullStartMs = Date.parse(chartData[0]?.timeKey ?? '');
  const fullEndMs = Date.parse(chartData[total - 1]?.timeKey ?? '');
  const rangeStartMs = Date.parse(chartData[range.start]?.timeKey ?? '');
  const rangeEndMs = Date.parse(chartData[range.end]?.timeKey ?? '');
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

  const span = range.end - range.start + 1;
  return {
    leftPct: (range.start / total) * 100,
    widthPct: (span / total) * 100,
  };
}

function buildSparklinePolyline(
  data: ChartPoint[],
  itemIds: string[],
  width: number,
  height: number,
): string {
  if (itemIds.length === 0 || data.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  const values: number[] = [];
  for (const point of data) {
    const value = sparklineMaxValue(point, itemIds);
    const num = value == null ? NaN : value;
    values.push(num);
    if (Number.isFinite(num)) {
      if (num < min) min = num;
      if (num > max) max = num;
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

function computeDensityBins(data: ChartPoint[], binCount: number): number[] {
  if (data.length === 0) return [];
  const startMs = Date.parse(data[0].timeKey);
  const endMs = Date.parse(data[data.length - 1].timeKey);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const spanMs = endMs - startMs;
  const bins = new Array<number>(binCount).fill(0);
  for (const point of data) {
    const t = Date.parse(point.timeKey);
    if (!Number.isFinite(t)) continue;
    const ratio = Math.max(0, Math.min(1, (t - startMs) / spanMs));
    const idx = Math.min(binCount - 1, Math.floor(ratio * binCount));
    bins[idx] += 1;
  }
  return bins;
}

export default function ChartZoomNavigator({
  chartData,
  chartZoom,
  sparkItemIds,
  formatTime,
  onWindowChange,
  totalMatched,
  returned,
  downsampled,
  disabled = false,
}: ChartZoomNavigatorProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    zoomStart: number;
    zoomEnd: number;
  } | null>(null);
  const selectSessionRef = useRef<{ pointerId: number; startIndex: number } | null>(null);
  const onWindowChangeRef = useRef(onWindowChange);
  useEffect(() => {
    onWindowChangeRef.current = onWindowChange;
  }, [onWindowChange]);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const selectionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const setSelection = useCallback((range: { start: number; end: number } | null) => {
    selectionRangeRef.current = range;
    setSelectionRange(range);
  }, []);

  const total = chartData.length;
  const windowRange = useMemo(
    () => clampWindow(chartZoom.start, chartZoom.end, total),
    [chartZoom.end, chartZoom.start, total],
  );
  const span = windowRange.end - windowRange.start + 1;
  const { leftPct, widthPct } = useMemo(
    () => computeRangePercent(windowRange, chartData, totalMatched, returned),
    [windowRange, chartData, totalMatched, returned],
  );
  const selectPct = useMemo(
    () => (selectionRange ? computeRangePercent(selectionRange, chartData, totalMatched, returned) : null),
    [selectionRange, chartData, totalMatched, returned],
  );

  const sparkData = useMemo(
    () => decimateSparklineMinMax(chartData, sparkItemIds ?? [], 160),
    [chartData, sparkItemIds],
  );
  const sparkline = useMemo(
    () => buildSparklinePolyline(sparkData, sparkItemIds ?? [], 100, 20),
    [sparkData, sparkItemIds],
  );

  const densityBins = useMemo(
    () => computeDensityBins(chartData, DENSITY_BIN_COUNT),
    [chartData],
  );
  const densityMax = useMemo(() => {
    let max = 0;
    for (const count of densityBins) if (count > max) max = count;
    return max || 1;
  }, [densityBins]);

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
      const track = trackRef.current;
      if (!track) return;

      const panSession = dragSessionRef.current;
      if (panSession && panSession.pointerId === e.pointerId) {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0 || total <= 0) return;

        const shift = Math.round(((e.clientX - panSession.startX) / rect.width) * total);
        let newStart = panSession.zoomStart + shift;
        let newEnd = panSession.zoomEnd + shift;
        if (newStart < 0) {
          newEnd -= newStart;
          newStart = 0;
        }
        if (newEnd >= total) {
          newStart -= newEnd - total + 1;
          newEnd = total - 1;
        }
        onWindowChangeRef.current(newStart, newEnd);
        return;
      }

      const selectSession = selectSessionRef.current;
      if (selectSession && selectSession.pointerId === e.pointerId) {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0 || total <= 0) return;
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const index = Math.round(ratio * (total - 1));
        const start = Math.min(selectSession.startIndex, index);
        const end = Math.max(selectSession.startIndex, index);
        setSelection({ start, end });
      }
    };

    const endDrag = (e: PointerEvent) => {
      const track = trackRef.current;

      const panSession = dragSessionRef.current;
      if (panSession && panSession.pointerId === e.pointerId) {
        dragSessionRef.current = null;
        if (track?.hasPointerCapture(e.pointerId)) {
          track.releasePointerCapture(e.pointerId);
        }
        return;
      }

      const selectSession = selectSessionRef.current;
      if (selectSession && selectSession.pointerId === e.pointerId) {
        selectSessionRef.current = null;
        if (track?.hasPointerCapture(e.pointerId)) {
          track.releasePointerCapture(e.pointerId);
        }
        const range = selectionRangeRef.current;
        setSelection(null);
        if (range && total > 0) {
          const rangeSpan = range.end - range.start + 1;
          if (rangeSpan >= MIN_SELECT_POINTS) {
            onWindowChangeRef.current(range.start, range.end);
          } else if (track) {
            const rect = track.getBoundingClientRect();
            if (rect.width > 0) {
              moveWindowToRatio((e.clientX - rect.left) / rect.width);
            }
          }
        }
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
  }, [total, moveWindowToRatio, setSelection]);

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || !trackRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('.viz-chart-navigator-thumb')) return;

    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (total - 1));
    selectSessionRef.current = { pointerId: e.pointerId, startIndex: index };
    setSelection({ start: index, end: index });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
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
      className={`viz-chart-navigator${widthPct >= 99.5 ? ' is-full-range' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-label={t('viz.navigator.position')}
    >
      <div
        ref={trackRef}
        className={`viz-chart-navigator-track${disabled ? ' is-disabled' : ''}`}
        onPointerDown={onTrackPointerDown}
        role="presentation"
        title={t('viz.navigator.select')}
      >
        <svg
          className="viz-chart-navigator-density"
          viewBox={`0 0 ${DENSITY_BIN_COUNT} 10`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {densityBins.map((count, i) => {
            const h = count === 0 ? 0 : Math.max(0.5, (count / densityMax) * 10);
            return (
              <rect
                key={i}
                x={i}
                y={10 - h}
                width={1}
                height={h}
              />
            );
          })}
        </svg>
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
        {selectPct && selectionRange && (
          <div
            className="viz-chart-navigator-select"
            style={{ left: `${selectPct.leftPct}%`, width: `${selectPct.widthPct}%` }}
            aria-hidden
          />
        )}
        <div
          className="viz-chart-navigator-thumb"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={onThumbPointerDown}
          role="slider"
          aria-label={t('viz.navigator.range')}
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
          {disabled && (
            <span className="viz-chart-navigator-disabled-label">
              {t('viz.liveBadge')}
            </span>
          )}
        </span>
        <span>{fullEnd ? formatTime(fullEnd) : '—'}</span>
      </div>
    </div>
  );
}
