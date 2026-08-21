import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../i18n';
import {
  computeSparklineValueBins,
  sparklineValueScaleMax,
} from '../lib/vizChartSparkline';
import {
  centerNavigatorWindowAtRatio,
  computeNavigatorRangePercent,
  shiftNavigatorWindowByTrackDelta,
} from '../lib/vizChartNavigator';

type ChartPoint = { timeKey: string } & Record<string, string | number>;

export interface ChartZoomRange {
  start: number;
  end: number;
  startTs?: string;
  endTs?: string;
}

interface ChartZoomNavigatorProps {
  chartData: ChartPoint[];
  chartZoom: ChartZoomRange;
  sparkItemIds?: string[];
  sparkValueMax?: number;
  spectrum?: { present: boolean[]; start: string; end: string } | null;
  formatTime: (iso: string) => string;
  onWindowChange: (range: ChartZoomRange) => void;
  totalMatched?: number;
  returned?: number;
  downsampled?: boolean;
  disabled?: boolean;
}

const SPARKLINE_BIN_COUNT = 160;
const SPARKLINE_VIEW_HEIGHT = 24;

function clampWindow(start: number, end: number, total: number): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(start, total - 1));
  const e = Math.max(s, Math.min(end, total - 1));
  return { start: s, end: e };
}

export default function ChartZoomNavigator({
  chartData,
  chartZoom,
  sparkItemIds,
  sparkValueMax,
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
    startTs?: string;
    endTs?: string;
  } | null>(null);
  const onWindowChangeRef = useRef(onWindowChange);
  useEffect(() => {
    onWindowChangeRef.current = onWindowChange;
  }, [onWindowChange]);

  const total = chartData.length;
  const windowRange = useMemo(
    () => clampWindow(chartZoom.start, chartZoom.end, total),
    [chartZoom.end, chartZoom.start, total],
  );
  const span = windowRange.end - windowRange.start + 1;
  const { leftPct, widthPct } = useMemo(
    () => computeNavigatorRangePercent(
      { ...windowRange, startTs: chartZoom.startTs, endTs: chartZoom.endTs },
      chartData,
      totalMatched,
      returned,
    ),
    [windowRange, chartData, totalMatched, returned, chartZoom.startTs, chartZoom.endTs],
  );

  const sparkBins = useMemo(
    () => computeSparklineValueBins(chartData, sparkItemIds ?? [], SPARKLINE_BIN_COUNT),
    [chartData, sparkItemIds],
  );
  const sparkScaleMax = useMemo(
    () => sparklineValueScaleMax(sparkBins, sparkValueMax),
    [sparkBins, sparkValueMax],
  );

  const windowTimeKeys = useMemo(
    () => (chartZoom.startTs && chartZoom.endTs
      ? { startTs: chartZoom.startTs, endTs: chartZoom.endTs }
      : undefined),
    [chartZoom.endTs, chartZoom.startTs],
  );

  const moveWindowToRatio = useCallback((focusRatio: number) => {
    if (total <= 0) return;
    const next = centerNavigatorWindowAtRatio(chartData, focusRatio, span, windowTimeKeys);
    onWindowChangeRef.current(next);
  }, [span, total, chartData, windowTimeKeys]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track) return;

      const panSession = dragSessionRef.current;
      if (!panSession || panSession.pointerId !== e.pointerId) return;

      const rect = track.getBoundingClientRect();
      if (rect.width <= 0 || total <= 0) return;

      const shift = e.clientX - panSession.startX;
      const { start: newStart, end: newEnd, startTs, endTs } = shiftNavigatorWindowByTrackDelta(
        chartData,
        panSession.zoomStart,
        panSession.zoomEnd,
        shift,
        rect.width,
        panSession.startTs && panSession.endTs
          ? { startTs: panSession.startTs, endTs: panSession.endTs }
          : windowTimeKeys,
      );
      onWindowChangeRef.current({ start: newStart, end: newEnd, startTs, endTs });
    };

    const endDrag = (e: PointerEvent) => {
      const track = trackRef.current;
      const panSession = dragSessionRef.current;
      if (!panSession || panSession.pointerId !== e.pointerId) return;

      dragSessionRef.current = null;
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
  }, [total, chartData, windowTimeKeys]);

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || !trackRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('.viz-chart-navigator-thumb')) return;

    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    moveWindowToRatio(ratio);
  };

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      zoomStart: windowRange.start,
      zoomEnd: windowRange.end,
      startTs: chartZoom.startTs,
      endTs: chartZoom.endTs,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const rangeStart = chartZoom.startTs ?? chartData[windowRange.start]?.timeKey;
  const rangeEnd = chartZoom.endTs ?? chartData[windowRange.end]?.timeKey;
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
        title={t('viz.navigator.move')}
      >
        {sparkBins.length > 0 && (
          <svg
            className="viz-chart-navigator-sparkline"
            viewBox={`0 0 ${SPARKLINE_BIN_COUNT} ${SPARKLINE_VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {sparkBins.map((value, i) => {
              if (value <= 0) return null;
              const h = Math.max(0.5, (value / sparkScaleMax) * SPARKLINE_VIEW_HEIGHT);
              return (
                <rect
                  key={i}
                  x={i}
                  y={SPARKLINE_VIEW_HEIGHT - h}
                  width={1}
                  height={h}
                />
              );
            })}
          </svg>
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
