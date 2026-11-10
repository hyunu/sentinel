import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import uPlot, { type AlignedData, type Options, type Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { VizItem, VizCommandEvent } from '../api';
import { formatChartAxisTime } from '../utils/date';
import { readCssVar } from '../lib/themeColors';
import { useTheme } from '../theme';
import { digitalLaneDomain, digitalLaneValue } from '../lib/vizDashboardUtils';

export type VizChartPoint = { timeKey: string } & Record<string, string | number>;

const PRIMARY_SCALE = 'y';
const SECONDARY_SCALE = 'y2';
/** How close (CSS px) the pointer must be to a line to pin its Y-axis label. */
const AXIS_HOVER_MAX_DISTANCE_PX = 36;
export type VizSeriesYScale = 'y' | 'y2' | 'y3';
import { CHART_SERIES_LINE_WIDTH, CHART_X_AXIS_INCRS_SECONDS } from '../lib/vizChartConstants';
import { chartSessionGapThresholdSec, shouldGapLineSegment } from '../lib/vizChartSessionBreaks';
import { filterChartPointsByTimeRange } from '../lib/vizChartZoomTime';
import {
  isYAxisDomainZoomed,
  type YAxisDomain,
  type YAxisScaleKey,
} from '../lib/vizChartYAxis';

export interface VizViewportSyncOptions {
  /** @deprecated Y축은 X 창과 무관하게 고정된다. 호환용으로만 남긴다. */
  syncY?: boolean;
  /** Skip bounds/session-break DOM work — use during pan/wheel frames. */
  lightweight?: boolean;
}

export interface VizYAxisMetrics {
  /** 현재 화면에 적용된 값 구간. */
  current: YAxisDomain;
  /** X 줌과 무관한 기준(전체 데이터) 구간. */
  base: YAxisDomain | null;
  /** 플롯 높이(CSS px) — 세로 팬 거리 환산에 사용. */
  plotHeight: number;
}

export interface VizCanvasChartHandle {
  setWindowByIndex(start: number, end: number, opts?: VizViewportSyncOptions): void;
  setWindowByTimeKeys(startTimeKey: string, endTimeKey: string, opts?: VizViewportSyncOptions): void;
  setWindowByTimeMs(startMs: number, endMs: number, opts?: VizViewportSyncOptions): void;
  getXScaleMs(): { startMs: number; endMs: number } | null;
  syncViewportFinish(): void;
  resetWindow(): void;
  resetYAxes(): void;
  isYAxisZoomed(): boolean;
  /** 포인터가 Y축 거터(왼쪽/오른쪽) 위에 있으면 해당 스케일을 반환. */
  getYAxisAtClient(clientX: number, clientY: number): YAxisScaleKey | null;
  getYAxisMetrics(scale: YAxisScaleKey): VizYAxisMetrics | null;
  getYValueFromClientY(scale: YAxisScaleKey, clientY: number): number | null;
  setYAxisDomain(scale: YAxisScaleKey, domain: YAxisDomain): void;
  refreshPlotBounds(): { left: number; width: number };
  getPlotClientMetrics(): { plotLeft: number; plotWidth: number } | null;
  getWheelFocusMsFromClientX(clientX: number): number | null;
}

function plotBBoxCss(u: uPlot): { left: number; top: number; width: number; height: number } {
  const px = uPlot.pxRatio;
  return {
    left: u.bbox.left / px,
    top: u.bbox.top / px,
    width: u.bbox.width / px,
    height: u.bbox.height / px,
  };
}

type AxisLayout = uPlot.Axis & {
  _show?: boolean;
  _splits?: number[];
  _found?: [number, number];
};

/** Draw x-axis vertical grid in drawClear so it sits behind series and overlays. */
function drawXAxisGridBehind(u: uPlot, fallbackStroke: string): void {
  const axisIdx = 0;
  const axis = u.axes[axisIdx] as AxisLayout | undefined;
  if (!axis?.show || axis._show === false) return;

  const grid = axis.grid ?? {};

  const scaleKey = axis.scale ?? 'x';
  const scale = u.scales[scaleKey];
  if (!scale) return;

  const _splits = axis._splits;
  const _found = axis._found;
  if (!_splits?.length || !_found) return;

  const pxRatio = uPlot.pxRatio;
  const { top: plotTop, height: plotHgt } = u.bbox;
  const [_incr, _space] = _found;
  const data0 = u.data[0] as number[];
  const splits = scale.distr === 2 ? _splits.map(i => data0[i]) : _splits;
  const incr = scale.distr === 2
    ? data0[_splits[1]] - data0[_splits[0]]
    : _incr;

  const canOffs = _splits.map(val => {
    const v = scale.distr === 2 ? data0[val] : val;
    return Math.round(u.valToPos(v, scaleKey, true));
  });

  const splitVisible = grid.filter
    ? grid.filter(u, splits, axisIdx, _space, incr)
    : splits;

  const stroke = typeof grid.stroke === 'function'
    ? grid.stroke(u, axisIdx)
    : (grid.stroke ?? fallbackStroke);
  const lineWidth = Math.max(1, (grid.width ?? 1) * pxRatio);
  const dash = grid.dash ?? [4, 4];
  const dashPx = Array.isArray(dash) ? dash.map(d => d * pxRatio) : [];

  const ctx = u.ctx;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  if (dashPx.length > 0) ctx.setLineDash(dashPx);

  for (let i = 0; i < canOffs.length; i++) {
    if (splitVisible[i] == null) continue;
    const x = canOffs[i];
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotHgt);
    ctx.stroke();
  }
  ctx.restore();
}

export interface VizCanvasChartProps {
  points: VizChartPoint[];
  /** Session boundaries (sec) from full-resolution timestamps — stable while zooming. */
  sessionBreakTimesSec?: readonly number[];
  fullTimeline?: VizChartPoint[];
  windowIndices?: { start: number; end: number } | null;
  xWindowTimeKeys?: { start: string; end: string } | null;
  /** Changes whenever explicit Y min/max (profile or global range) change. */
  yDomainOverrideKey?: string;
  /** When false, uPlot x-scale clips full detail — avoids per-zoom point filtering. */
  filterPointsToXWindow?: boolean;
  chartItems: VizItem[];
  maxVisibleSeries: number;
  yAxisDomains: Record<string, [number, number] | undefined>;
  yAxes: Array<{ id: string; orientation: 'left' | 'right'; unitLabel: string }>;
  /** Visible on/off items mapped to a zero-based lane index. */
  digitalLanes: ReadonlyMap<string, number>;
  digitalLaneCount: number;
  chartLabel: (item: VizItem) => string;
  resolveYScale: (item: VizItem) => VizSeriesYScale;
  height: number;
  tooltipEnabled: boolean;
  /** Control frames to draw as vertical markers (call/result/ack). */
  commandEvents?: VizCommandEvent[];
  showCommands?: boolean;
  hideTooltip: boolean;
  itemById: Map<string, VizItem>;
  rawValuesByTimeKey: Map<string, Record<string, number>>;
  onHoverTimeKey: (timeKey: string | null) => void;
  onPlotBoundsChange?: (bounds: { left: number; width: number }) => void;
  formatYTick: (value: number | string) => string;
  formatTooltipValue: (
    item: VizItem | undefined,
    rawValuesAtTime: Record<string, number> | undefined,
    chartValue: unknown,
  ) => string;
}

function timeSec(timeKey: string): number {
  return Date.parse(timeKey) / 1000;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TOOLTIP_LINE_GAP = 8;
const TOOLTIP_Y_GAP = 12;

function positionTooltipNearCursor(
  el: HTMLDivElement,
  wrap: HTMLElement,
  lineX: number,
  mouseY: number,
): void {
  const maxX = wrap.clientWidth;
  const maxY = wrap.clientHeight;
  const tipW = el.offsetWidth;
  const tipH = el.offsetHeight;

  const rightLeft = lineX + TOOLTIP_LINE_GAP;
  const leftLeft = lineX - TOOLTIP_LINE_GAP - tipW;
  const fitsRight = rightLeft + tipW <= maxX;
  const fitsLeft = leftLeft >= 0;

  let left: number;
  if (fitsRight) {
    left = rightLeft;
  } else if (fitsLeft) {
    left = leftLeft;
  } else {
    const roomRight = maxX - lineX - TOOLTIP_LINE_GAP;
    const roomLeft = lineX - TOOLTIP_LINE_GAP;
    if (roomRight >= roomLeft) {
      left = Math.min(rightLeft, maxX - tipW);
    } else {
      left = Math.max(leftLeft, 0);
    }
  }

  // Prefer below the cursor, but flip above near the bottom edge so the
  // pointer never sits on top of the tooltip (and the card never clips it).
  const belowTop = mouseY + TOOLTIP_Y_GAP;
  const aboveTop = mouseY - TOOLTIP_Y_GAP - tipH;
  const fitsBelow = belowTop + tipH <= maxY;
  const fitsAbove = aboveTop >= 0;

  let top: number;
  if (fitsBelow) {
    top = belowTop;
  } else if (fitsAbove) {
    top = aboveTop;
  } else {
    const roomBelow = maxY - mouseY - TOOLTIP_Y_GAP;
    const roomAbove = mouseY - TOOLTIP_Y_GAP;
    top = roomBelow >= roomAbove
      ? Math.min(belowTop, maxY - tipH)
      : Math.max(aboveTop, 0);
  }
  top = Math.max(0, Math.min(top, Math.max(0, maxY - tipH)));

  el.style.left = `${Math.max(0, Math.min(left, Math.max(0, maxX - tipW)))}px`;
  el.style.top = `${top}px`;
}

function buildAlignedData(
  points: VizChartPoint[],
  chartItems: VizItem[],
  digitalLanes: ReadonlyMap<string, number>,
  digitalLaneCount: number,
): AlignedData {
  const xs = new Array<number>(points.length);
  const seriesValues = chartItems.map(() => new Array<number | null>(points.length));

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    xs[i] = timeSec(point.timeKey);
    for (let s = 0; s < chartItems.length; s++) {
      const item = chartItems[s];
      const value = point[item.id];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        seriesValues[s][i] = null;
        continue;
      }
      const laneIndex = digitalLanes.get(item.id);
      seriesValues[s][i] = laneIndex == null
        ? value
        : digitalLaneValue(value, laneIndex, digitalLaneCount);
    }
  }

  return [xs, ...seriesValues];
}

function buildSeriesConfig(
  chartItems: VizItem[],
  chartLabel: (item: VizItem) => string,
  resolveYScale: (item: VizItem) => VizSeriesYScale,
  maxVisibleSeries: number,
  getSessionBreakTimesSec: () => readonly number[],
  getGapThresholdSec: () => number,
): Series[] {
  let visibleRank = 0;
  // spanGaps must stay false so uPlot invokes this refiner (spanGaps: true skips gaps entirely).
  // nullGaps from uPlot are ignored so missing values stay connected within a session.
  const gapsRefiner: Series['gaps'] = (u, _seriesIdx, idx0, idx1, _nullGaps) => {
    void _nullGaps;
    const gaps: [number, number][] = [];
    const xs = u.data[0];
    if (!xs) return gaps;
    const breakTimes = getSessionBreakTimesSec();
    const gapThresholdSec = getGapThresholdSec();
    const from = Math.min(idx0, idx1);
    const to = Math.max(idx0, idx1);
    for (let i = from; i < to; i++) {
      if (!shouldGapLineSegment(xs[i], xs[i + 1], breakTimes, gapThresholdSec)) continue;
      const fromPx = u.valToPos(xs[i], 'x', true);
      const toPx = u.valToPos(xs[i + 1], 'x', true);
      gaps.push([fromPx, toPx]);
    }
    return gaps;
  };
  return [
    {},
    ...chartItems.map((item): Series => {
      const scale = resolveYScale(item);
      let show = false;
      if (item.visible) {
        show = visibleRank < maxVisibleSeries;
        visibleRank++;
      }
      const base = {
        label: chartLabel(item),
        scale,
        show,
      };
      if (item.chart_type === 'bar') {
        return {
          ...base,
          stroke: item.color,
          fill: item.color,
          paths: uPlot.paths.bars?.({ size: [0.75, 100] }),
          width: 0,
        };
      }
      if (item.chart_type === 'area') {
        return {
          ...base,
          stroke: item.color,
          fill: colorWithAlpha(item.color, 0.28),
          width: CHART_SERIES_LINE_WIDTH,
          spanGaps: false,
          gaps: gapsRefiner,
        };
      }
      return {
        ...base,
        stroke: item.color,
        width: CHART_SERIES_LINE_WIDTH,
        spanGaps: false,
        gaps: gapsRefiner,
      };
    }),
  ];
}

function xScaleFromTimeKeys(startTimeKey: string, endTimeKey: string): { min: number; max: number } | null {
  const min = timeSec(startTimeKey);
  const max = timeSec(endTimeKey);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return min === max ? { min: min - 0.5, max: max + 0.5 } : { min, max };
}

function xScaleFromIndices(
  timeline: VizChartPoint[],
  start: number,
  end: number,
): { min: number; max: number } | null {
  if (timeline.length === 0) return null;
  const s = clampIndex(start, timeline.length);
  const e = clampIndex(end, timeline.length);
  const min = timeSec(timeline[Math.min(s, e)].timeKey);
  const max = timeSec(timeline[Math.max(s, e)].timeKey);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return min === max ? { min: min - 0.5, max: max + 0.5 } : { min, max };
}

const VizCanvasChart = forwardRef<VizCanvasChartHandle, VizCanvasChartProps>(function VizCanvasChart(
  {
    points,
    sessionBreakTimesSec = [],
    fullTimeline,
    windowIndices,
    xWindowTimeKeys,
    yDomainOverrideKey = '',
    filterPointsToXWindow = true,
    chartItems,
    maxVisibleSeries,
    yAxisDomains,
    yAxes,
    digitalLanes,
    digitalLaneCount,
    chartLabel,
    resolveYScale,
    height,
    tooltipEnabled,
    commandEvents = [],
    showCommands = true,
    hideTooltip,
    itemById,
    rawValuesByTimeKey,
    onHoverTimeKey,
    onPlotBoundsChange,
    formatYTick,
    formatTooltipValue,
  },
  ref,
) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const commandEventsRef = useRef(commandEvents);
  commandEventsRef.current = commandEvents;
  const showCommandsRef = useRef(showCommands);
  showCommandsRef.current = showCommands;

  const drawCommandOverlay = useCallback((u: uPlot) => {
    const events = commandEventsRef.current;
    if (!showCommandsRef.current || events.length === 0) return;
    const xMin = u.scales.x.min;
    const xMax = u.scales.x.max;
    if (typeof xMin !== 'number' || typeof xMax !== 'number') return;
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    // uPlot draws in device pixels: bbox, valToPos() and ctx are all scaled by
    // devicePixelRatio. A raw 22px font therefore rendered 22px on Windows
    // (dpr 1) but only 11 CSS px on a Retina Mac (dpr 2), so command labels
    // looked roughly twice as large on Windows. Size every overlay metric in
    // CSS px and multiply by dpr to keep both platforms identical.
    const px = uPlot.pxRatio || 1;
    const css = (value: number) => value * px;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    // Readable label matching the field-value text size, identical on every
    // platform because the size is expressed in CSS px.
    ctx.font = `700 ${Math.max(1, Math.round(css(12)))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const labelBoxHeight = css(18);
    const labelPadX = css(6);
    const labelRowGap = css(3);
    const labelRowHeight = labelBoxHeight + labelRowGap;
    const labelTop = css(4);
    const labelRadius = css(5);
    const labelOffset = css(3);
    const labelGap = css(6);
    // Stack close-together commands on following rows instead of hiding them.
    // When deeply zoomed, allow more rows so bursts can still be read.
    const zoomedRowCap = (xMax - xMin) <= 60 ? 6 : 4;
    const maxLabelRows = Math.max(
      1,
      Math.min(zoomedRowCap, Math.floor((height - css(4)) / labelRowHeight)),
    );
    // Pass 1: marker lines. Dense live streams can produce thousands of events
    // in a small window; collapse lines that land on the same few pixels so the
    // series stay readable underneath.
    let lastLineX = Number.NEGATIVE_INFINITY;
    for (const event of events) {
      const sec = Date.parse(event.timestamp) / 1000;
      if (!Number.isFinite(sec) || sec < xMin || sec > xMax) continue;
      const x = u.valToPos(sec, 'x', true);
      if (!Number.isFinite(x)) continue;
      const color = event.color
        || (event.direction === 'TX'
          ? 'rgba(255, 170, 80, 0.75)'
          : 'rgba(90, 190, 255, 0.75)');
      const isLine = (event.style ?? 'vline') === 'vline';
      if (isLine) {
        if (x - lastLineX < 3) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
        ctx.stroke();
        ctx.setLineDash([]);
        lastLineX = x;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, top + css(1));
      ctx.lineTo(x - css(3), top + css(6));
      ctx.lineTo(x + css(3), top + css(6));
      ctx.closePath();
      ctx.fill();
    }

    // Pass 2: labels, newest first. In Live the most recent commands sit at the
    // right edge, so giving them the rows first keeps the important ones
    // visible instead of letting older labels crowd them out.
    // Track both edges of the boxes on each row so labels never overlap each
    // other, whether they were placed to the left or right of their marker.
    const rowLeft: number[] = new Array(maxLabelRows).fill(Number.POSITIVE_INFINITY);
    const rowRight: number[] = new Array(maxLabelRows).fill(Number.NEGATIVE_INFINITY);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      const sec = Date.parse(event.timestamp) / 1000;
      if (!Number.isFinite(sec) || sec < xMin || sec > xMax) continue;
      const x = u.valToPos(sec, 'x', true);
      if (!Number.isFinite(x)) continue;
      const color = event.color
        || (event.direction === 'TX'
          ? 'rgba(255, 170, 80, 0.75)'
          : 'rgba(90, 190, 255, 0.75)');
      const label = event.summary;
      if (label) {
        const textWidth = ctx.measureText(label).width;
        const boxWidth = textWidth + labelPadX * 2;
        if (boxWidth > width - css(2)) continue;
        const preferRight = x + labelOffset + boxWidth <= left + width;
        let boxX = preferRight ? x + labelOffset : x - labelOffset - boxWidth;
        // Labels for commands near the right edge used to be dropped entirely.
        // Clamp them inside the plot instead so live commands always show.
        if (boxX + boxWidth > left + width - css(1)) {
          boxX = left + width - css(1) - boxWidth;
        }
        if (boxX < left + css(1)) {
          boxX = left + css(1);
        }

        // Use the first row where this box does not collide with a label that
        // is already on that row. Close commands therefore move to row 1,
        // row 2, ... instead of disappearing behind a single row.
        let row = -1;
        for (let r = 0; r < maxLabelRows; r += 1) {
          if (
            boxX + boxWidth + labelGap <= rowLeft[r]
            || boxX >= rowRight[r] + labelGap
          ) {
            row = r;
            break;
          }
        }
        if (row < 0) continue;

        const boxY = top + labelTop + row * labelRowHeight;
        // Fully opaque backing: the dashed command lines and plot grid must not
        // show through the text.
        ctx.fillStyle = 'rgba(8, 10, 16, 1)';
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxWidth, labelBoxHeight, labelRadius);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillRect(boxX, boxY, boxWidth, labelBoxHeight);
        }

        // Keep the command color as a compact accent bar; the text itself is
        // near-white so it stays readable on every series color.
        ctx.fillStyle = color;
        ctx.fillRect(boxX, boxY, Math.max(1, css(1.5)), labelBoxHeight);
        ctx.fillStyle = 'rgba(244, 247, 255, 0.98)';
        ctx.fillText(
          label,
          boxX + labelPadX,
          boxY + labelBoxHeight / 2 + css(0.5),
        );
        rowLeft[row] = Math.min(rowLeft[row], boxX);
        rowRight[row] = Math.max(rowRight[row], boxX + boxWidth);
      }
    }
    ctx.restore();
  }, []);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  /** Hover label pinned to the Y axis of the nearest series. */
  const axisHoverRef = useRef<HTMLDivElement | null>(null);
  const sessionBreaksRef = useRef<HTMLDivElement | null>(null);
  const sessionBreakTimesRef = useRef<number[]>([...sessionBreakTimesSec]);
  sessionBreakTimesRef.current = [...sessionBreakTimesSec];
  const pointsRef = useRef(points);
  const plotPoints = useMemo(() => {
    if (
      filterPointsToXWindow
      && xWindowTimeKeys
      && !fullTimeline
      && points.length > 0
    ) {
      return filterChartPointsByTimeRange(points, xWindowTimeKeys.start, xWindowTimeKeys.end);
    }
    return points;
  }, [points, xWindowTimeKeys, fullTimeline, filterPointsToXWindow]);
  pointsRef.current = plotPoints;
  const gapThresholdSecRef = useRef(30);
  const gapThresholdSec = useMemo(
    () => chartSessionGapThresholdSec(plotPoints.map(point => point.timeKey)),
    [plotPoints],
  );
  gapThresholdSecRef.current = gapThresholdSec;
  const fullTimelineRef = useRef(fullTimeline);
  fullTimelineRef.current = fullTimeline;
  const chartItemsRef = useRef(chartItems);
  chartItemsRef.current = chartItems;
  const maxVisibleSeriesRef = useRef(maxVisibleSeries);
  maxVisibleSeriesRef.current = maxVisibleSeries;
  const yAxesRef = useRef(yAxes);
  yAxesRef.current = yAxes;
  const yAxisDomainsRef = useRef(yAxisDomains);
  yAxisDomainsRef.current = yAxisDomains;
  /** 사용자가 Y축을 직접 줌/팬했는지 — 데이터 갱신이 그 상태를 덮어쓰지 않게 한다. */
  const yUserAdjustedRef = useRef(false);
  const windowIndicesRef = useRef<{ start: number; end: number } | null>(
    windowIndices ? { start: windowIndices.start, end: windowIndices.end } : null,
  );
  /** Preserved x viewport (seconds) — survives setData and plot option rebuilds. */
  const imperativeXRangeRef = useRef<{ min: number; max: number } | null>(null);
  const chartLabelRef = useRef(chartLabel);
  chartLabelRef.current = chartLabel;
  const resolveYScaleRef = useRef(resolveYScale);
  resolveYScaleRef.current = resolveYScale;
  const propsRef = useRef({
    tooltipEnabled,
    hideTooltip,
    itemById,
    rawValuesByTimeKey,
    onHoverTimeKey,
    formatTooltipValue,
  });
  propsRef.current = {
    tooltipEnabled,
    hideTooltip,
    itemById,
    rawValuesByTimeKey,
    onHoverTimeKey,
    formatTooltipValue,
  };

  const syncPlotBounds = useCallback((u: uPlot) => {
    const bb = plotBBoxCss(u);
    const viewport = containerRef.current?.closest('.viz-chart-viewport');
    if (viewport instanceof HTMLElement) {
      const viewportRect = viewport.getBoundingClientRect();
      const rootRect = u.root.getBoundingClientRect();
      onPlotBoundsChange?.({
        left: rootRect.left - viewportRect.left + bb.left,
        width: bb.width,
      });
    } else {
      onPlotBoundsChange?.({ left: bb.left, width: bb.width });
    }
  }, [onPlotBoundsChange]);

  const syncSessionBreaks = useCallback((u: uPlot) => {
    const overlay = sessionBreaksRef.current;
    if (!overlay) return;
    const breaks = sessionBreakTimesRef.current;
    const bb = plotBBoxCss(u);
    overlay.replaceChildren();
    for (const t of breaks) {
      const plotLeft = u.valToPos(t, 'x', false);
      if (!Number.isFinite(plotLeft)) continue;
      const line = document.createElement('div');
      line.className = 'viz-chart-session-break';
      line.style.left = `${bb.left + plotLeft}px`;
      line.style.top = `${bb.top}px`;
      line.style.height = `${bb.height}px`;
      overlay.appendChild(line);
    }
  }, []);

  const syncPlotAndBreaks = useCallback((u: uPlot) => {
    syncPlotBounds(u);
    syncSessionBreaks(u);
  }, [syncPlotBounds, syncSessionBreaks]);

  const getSessionBreakTimesSec = useCallback(
    () => sessionBreakTimesRef.current,
    [],
  );
  const getGapThresholdSec = useCallback(() => gapThresholdSecRef.current, []);

  const applyXRangeToPlot = useCallback((
    u: uPlot,
    range: { min: number; max: number },
    opts?: VizViewportSyncOptions,
  ) => {
    imperativeXRangeRef.current = range;
    const applyScales = () => {
      u.setScale('x', range);
    };
    if (opts?.lightweight) {
      // During pan/wheel uPlot's setScale() schedules one batched draw.
      // Do not force an extra redraw or DOM overlay update on every frame.
      applyScales();
    } else {
      // Commit scales synchronously so the session-break overlay reads the
      // new transform in the same update instead of painting one frame stale.
      u.batch(applyScales);
      syncPlotAndBreaks(u);
    }
  }, [syncPlotAndBreaks]);

  const applyWindowIndices = useCallback((start: number, end: number, opts?: VizViewportSyncOptions) => {
    const u = plotRef.current;
    const timeline = fullTimelineRef.current;
    if (!u || !timeline || timeline.length === 0) return;
    const range = xScaleFromIndices(timeline, start, end);
    if (!range) return;
    applyXRangeToPlot(u, range, opts);
    windowIndicesRef.current = { start, end };
  }, [applyXRangeToPlot]);

  const applyXWindowTimeKeys = useCallback((
    startTimeKey: string,
    endTimeKey: string,
    opts?: VizViewportSyncOptions,
  ) => {
    const u = plotRef.current;
    if (!u) return;
    const range = xScaleFromTimeKeys(startTimeKey, endTimeKey);
    if (!range) return;
    applyXRangeToPlot(u, range, opts);
    windowIndicesRef.current = null;
  }, [applyXRangeToPlot]);

  const applyXWindowTimeMs = useCallback((
    startMs: number,
    endMs: number,
    opts?: VizViewportSyncOptions,
  ) => {
    applyXWindowTimeKeys(
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
      opts,
    );
  }, [applyXWindowTimeKeys]);

  const getXScaleMs = useCallback((): { startMs: number; endMs: number } | null => {
    const u = plotRef.current;
    if (!u) return null;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (typeof min !== 'number' || typeof max !== 'number') return null;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { startMs: min * 1000, endMs: max * 1000 };
  }, []);

  const syncViewportFinish = useCallback(() => {
    const u = plotRef.current;
    if (!u) return;
    syncPlotAndBreaks(u);
  }, [syncPlotAndBreaks]);

  const resetWindow = useCallback(() => {
    const u = plotRef.current;
    const timeline = fullTimelineRef.current ?? pointsRef.current;
    if (!u || timeline.length === 0) return;
    const range = xScaleFromIndices(timeline, 0, timeline.length - 1);
    if (!range) return;
    imperativeXRangeRef.current = range;
    u.batch(() => {
      u.setScale('x', range);
    });
    syncPlotAndBreaks(u);
    windowIndicesRef.current = null;
  }, [syncPlotAndBreaks]);

  const readYScale = useCallback((u: uPlot, scale: YAxisScaleKey): YAxisDomain | null => {
    const s = u.scales[scale];
    if (!s || typeof s.min !== 'number' || typeof s.max !== 'number') return null;
    if (!Number.isFinite(s.min) || !Number.isFinite(s.max) || s.max <= s.min) return null;
    return [s.min, s.max];
  }, []);

  const resetYAxes = useCallback(() => {
    const u = plotRef.current;
    if (!u) return;
    const baseY = yAxisDomainsRef.current[PRIMARY_SCALE];
    const baseY2 = yAxisDomainsRef.current[SECONDARY_SCALE];
    yUserAdjustedRef.current = false;
    u.batch(() => {
      if (u.scales[PRIMARY_SCALE] && baseY) {
        u.setScale(PRIMARY_SCALE, { min: baseY[0], max: baseY[1] });
      }
      if (u.scales[SECONDARY_SCALE] && baseY2) {
        u.setScale(SECONDARY_SCALE, { min: baseY2[0], max: baseY2[1] });
      }
    });
    u.redraw();
  }, []);

  const isYAxisZoomed = useCallback(() => {
    const u = plotRef.current;
    if (!u) return false;
    return ([PRIMARY_SCALE, SECONDARY_SCALE] as const).some(scale => (
      isYAxisDomainZoomed(
        readYScale(u, scale),
        yAxisDomainsRef.current[scale] ?? null,
      )
    ));
  }, [readYScale]);

  const getYAxisAtClient = useCallback((
    clientX: number,
    clientY: number,
  ): YAxisScaleKey | null => {
    const u = plotRef.current;
    if (!u || u.bbox.width <= 0) return null;
    const rootRect = u.root.getBoundingClientRect();
    if (clientX < rootRect.left || clientX > rootRect.right) return null;
    const bb = plotBBoxCss(u);
    const plotTop = rootRect.top + bb.top;
    const plotBottom = plotTop + bb.height;
    if (clientY < plotTop - 4 || clientY > plotBottom + 4) return null;
    const plotLeft = rootRect.left + bb.left;
    const plotRight = plotLeft + bb.width;
    if (clientX < plotLeft - 1) return PRIMARY_SCALE;
    const hasRightAxis = yAxesRef.current.some(axis => axis.id === SECONDARY_SCALE);
    if (hasRightAxis && clientX > plotRight + 1) return SECONDARY_SCALE;
    return null;
  }, []);

  const getYAxisMetrics = useCallback((scale: YAxisScaleKey): VizYAxisMetrics | null => {
    const u = plotRef.current;
    if (!u) return null;
    const current = readYScale(u, scale);
    if (!current) return null;
    return {
      current,
      base: yAxisDomainsRef.current[scale] ?? null,
      plotHeight: plotBBoxCss(u).height,
    };
  }, [readYScale]);

  const getYValueFromClientY = useCallback((
    scale: YAxisScaleKey,
    clientY: number,
  ): number | null => {
    const u = plotRef.current;
    if (!u || u.bbox.height <= 0) return null;
    u.syncRect();
    const rootRect = u.root.getBoundingClientRect();
    const bb = plotBBoxCss(u);
    const plotY = Math.max(0, Math.min(bb.height, clientY - rootRect.top - bb.top));
    const value = u.posToVal(plotY, scale);
    return Number.isFinite(value) ? value : null;
  }, []);

  const setYAxisDomain = useCallback((scale: YAxisScaleKey, domain: YAxisDomain) => {
    const u = plotRef.current;
    if (!u) return;
    if (!Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[1] <= domain[0]) return;
    yUserAdjustedRef.current = true;
    u.setScale(scale, { min: domain[0], max: domain[1] });
  }, []);

  const syncXWindow = useCallback(() => {
    if (xWindowTimeKeys) {
      applyXWindowTimeKeys(xWindowTimeKeys.start, xWindowTimeKeys.end);
      return;
    }
    if (fullTimeline && windowIndices) {
      applyWindowIndices(windowIndices.start, windowIndices.end);
      return;
    }
    // No React window — keep imperative viewport from pan/wheel; reset via resetWindow() only.
  }, [xWindowTimeKeys, windowIndices, fullTimeline, applyXWindowTimeKeys, applyWindowIndices]);

  useImperativeHandle(ref, () => ({
    setWindowByIndex: applyWindowIndices,
    setWindowByTimeKeys: applyXWindowTimeKeys,
    setWindowByTimeMs: applyXWindowTimeMs,
    getXScaleMs,
    syncViewportFinish,
    resetWindow,
    resetYAxes,
    isYAxisZoomed,
    getYAxisAtClient,
    getYAxisMetrics,
    getYValueFromClientY,
    setYAxisDomain,
    refreshPlotBounds: () => {
      const u = plotRef.current;
      if (!u) return { left: 0, width: 0 };
      return plotBBoxCss(u);
    },
    getPlotClientMetrics: () => {
      const u = plotRef.current;
      if (!u || u.bbox.width <= 0) return null;
      const rootRect = u.root.getBoundingClientRect();
      const bb = plotBBoxCss(u);
      return {
        plotLeft: rootRect.left + bb.left,
        plotWidth: bb.width,
      };
    },
    getWheelFocusMsFromClientX: (clientX: number) => {
      const u = plotRef.current;
      if (!u || u.bbox.width <= 0) return null;
      u.syncRect();
      const rootRect = u.root.getBoundingClientRect();
      const bb = plotBBoxCss(u);
      const plotX = clientX - rootRect.left - bb.left;
      const clampedPlotX = Math.max(0, Math.min(bb.width, plotX));
      const focusSec = u.posToVal(clampedPlotX, 'x');
      if (!Number.isFinite(focusSec)) return null;
      return focusSec * 1000;
    },
  }), [
    applyWindowIndices,
    applyXWindowTimeKeys,
    resetWindow,
    resetYAxes,
    isYAxisZoomed,
    getYAxisAtClient,
    getYAxisMetrics,
    getYValueFromClientY,
    setYAxisDomain,
  ]);

  const hideTooltipEl = useCallback(() => {
    const el = tooltipRef.current;
    if (el) el.hidden = true;
    const axisEl = axisHoverRef.current;
    if (axisEl) axisEl.hidden = true;
  }, []);

  const digitalLayoutKey = [
    digitalLaneCount,
    ...[...digitalLanes.entries()].map(([id, lane]) => `${id}:${lane}`),
  ].join(',');
  const seriesLayoutKey = chartItems.map(
    i => `${i.id}:${i.color}:${i.chart_type}:${i.y_axis.id}`,
  ).join('|') + `|digital:${digitalLayoutKey}`;
  const visibilityKey = chartItems.map(i => `${i.id}:${i.visible ? 1 : 0}`).join('|');
  const yAxisLayoutKey = yAxes.map(a => `${a.id}:${a.unitLabel}`).join('|');
  const yDomainKey = [
    yAxisDomains.y?.join(','),
    yAxisDomains.y2?.join(','),
  ].join('|');
  const xWindowKey = xWindowTimeKeys
    ? `${xWindowTimeKeys.start}:${xWindowTimeKeys.end}`
    : 'full';
  const hasPlotData = plotPoints.length > 0 && chartItems.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPlotData) return;

    const usesRight = yAxes.some(axis => axis.id === SECONDARY_SCALE);
    const leftDomain = yAxisDomains[PRIMARY_SCALE];
    const rightDomain = yAxisDomains[SECONDARY_SCALE];
    const leftAxis = yAxes.find(a => a.id === PRIMARY_SCALE);
    const rightAxis = yAxes.find(a => a.id === SECONDARY_SCALE);
    const xRange = xWindowTimeKeys
      ? xScaleFromTimeKeys(xWindowTimeKeys.start, xWindowTimeKeys.end)
      : imperativeXRangeRef.current;
    const digitalDomain = digitalLaneDomain(digitalLaneCount, 1);

    const axisColor = readCssVar('--chart-axis', '#888aa0');
    const gridColor = readCssVar('--chart-grid', '#2e3040');
    const axisBorder = { show: true, stroke: axisColor, width: 1 };

    const makeOptions = (width: number): Options => ({
      width,
      height,
      pxAlign: true,
      focus: { alpha: 1 },
      cursor: {
        show: true,
        x: true,
        y: false,
        points: { show: false },
      },
      legend: { show: false },
      scales: {
        x: {
          time: true,
          auto: false,
          range: (u, dataMin, dataMax) => {
            const saved = imperativeXRangeRef.current;
            if (saved) return [saved.min, saved.max];
            const min = u.scales.x.min;
            const max = u.scales.x.max;
            if (typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max)) {
              return [min, max];
            }
            if (xRange) return [xRange.min, xRange.max];
            return [dataMin, dataMax];
          },
        },
        y: {
          auto: false,
          range: leftDomain
            ? () => leftDomain
            : (_u, dataMin, dataMax) => uPlot.rangeNum(dataMin, dataMax, 0.05, true),
        },
        y2: {
          auto: false,
          range: rightDomain
            ? () => rightDomain
            : (_u, dataMin, dataMax) => uPlot.rangeNum(dataMin, dataMax, 0.05, true),
        },
        y3: {
          auto: false,
          range: () => digitalDomain,
        },
      },
      axes: [
        {
          stroke: axisColor,
          grid: { show: false, stroke: gridColor, width: 1, dash: [4, 4] },
          ticks: { stroke: axisColor },
          border: axisBorder,
          font: '11px system-ui, sans-serif',
          gap: 6,
          space: 80,
          incrs: [...CHART_X_AXIS_INCRS_SECONDS],
          values: (_u, splits) => {
            const showMs = splits.length >= 2 && (splits[1] - splits[0]) < 1;
            return splits.map(v => formatChartAxisTime(
              new Date(v * 1000).toISOString(),
              { showMilliseconds: showMs },
            ));
          },
        },
        {
          scale: PRIMARY_SCALE,
          side: 3,
          show: !!leftAxis,
          stroke: axisColor,
          grid: { show: false },
          ticks: { stroke: axisColor },
          border: axisBorder,
          font: '9px system-ui, sans-serif',
          size: leftAxis?.unitLabel ? 44 : 30,
          values: (_u, splits) => splits.map(v => formatYTick(v)),
          label: leftAxis?.unitLabel || undefined,
          labelSize: 14,
          labelFont: '10px system-ui, sans-serif',
        },
        {
          scale: SECONDARY_SCALE,
          side: 1,
          show: usesRight,
          stroke: axisColor,
          grid: { show: false },
          ticks: { stroke: axisColor },
          border: axisBorder,
          font: '9px system-ui, sans-serif',
          size: rightAxis?.unitLabel ? 44 : 30,
          values: (_u, splits) => splits.map(v => formatYTick(v)),
          label: rightAxis?.unitLabel || undefined,
          labelSize: 14,
          labelFont: '10px system-ui, sans-serif',
        },
        {
          // Digital lanes keep the right axis visible even when the profile
          // has no analog right-axis items.
          scale: 'y3',
          side: 1,
          show: digitalLaneCount > 0 && !usesRight,
          stroke: axisColor,
          grid: { show: false },
          ticks: { stroke: axisColor },
          border: axisBorder,
          font: '9px system-ui, sans-serif',
          size: 30,
          values: (_u, splits) => splits.map(v => formatYTick(v)),
          label: 'DIGITAL',
          labelSize: 14,
          labelFont: '10px system-ui, sans-serif',
        },
      ],
      series: buildSeriesConfig(
        chartItems,
        item => chartLabelRef.current(item),
        item => resolveYScaleRef.current(item),
        maxVisibleSeries,
        getSessionBreakTimesSec,
        getGapThresholdSec,
      ),
      hooks: {
        draw: [drawCommandOverlay],
        drawAxes: [(u) => drawXAxisGridBehind(u, gridColor)],
        ready: [syncPlotAndBreaks],
        setSize: [syncPlotAndBreaks],
        setCursor: [(u) => {
          const idx = u.cursor.idx;
          if (idx == null) {
            hideTooltipEl();
            propsRef.current.onHoverTimeKey(null);
            return;
          }
          const point = pointsRef.current[idx];
          propsRef.current.onHoverTimeKey(point?.timeKey ?? null);

          const {
            tooltipEnabled: enabled,
            hideTooltip: hidden,
            itemById: items,
            rawValuesByTimeKey: rawMap,
            formatTooltipValue: formatValue,
          } = propsRef.current;
          // Pan/select is not hover; hide both overlays. A disabled tooltip is
          // different: the floating panel is off, but the axis line name stays.
          if (hidden || !point) {
            hideTooltipEl();
            return;
          }

          const bb = plotBBoxCss(u);
          const rawValues = rawMap.get(point.timeKey);
          const el = tooltipRef.current;

          if (el && enabled) {
            el.hidden = false;
            const lineX = bb.left + (u.cursor.left ?? 0);
            const mouseY = bb.top + (u.cursor.top ?? 0);
            let html = `<div class="viz-chart-tooltip-label">${formatChartAxisTime(point.timeKey)}</div>`;
            let visibleRank = 0;
            for (let seriesIdx = 0; seriesIdx < chartItemsRef.current.length; seriesIdx++) {
              const item = chartItemsRef.current[seriesIdx];
              if (!item.visible) continue;
              if (visibleRank >= maxVisibleSeries) break;
              visibleRank++;
              const value = u.data[seriesIdx + 1]?.[idx];
              const name = chartLabelRef.current(item);
              const display = formatValue(items.get(item.id), rawValues, value);
              html += `<div class="viz-chart-tooltip-row">`
                + `<span class="viz-chart-tooltip-swatch" style="background-color:${item.color}"></span>`
                + `<span class="viz-chart-tooltip-name">${name}</span>`
                + `<span class="viz-chart-tooltip-value">${display}</span>`
                + `</div>`;
            }
            el.innerHTML = html;

            const wrap = wrapRef.current;
            if (wrap) {
              positionTooltipNearCursor(el, wrap, lineX, mouseY);
            } else {
              el.style.left = `${lineX + TOOLTIP_LINE_GAP}px`;
              el.style.top = `${mouseY + TOOLTIP_Y_GAP}px`;
            }
          } else if (el) {
            el.hidden = true;
          }

          // Pin the nearest series' name/value to its own Y axis. This makes
          // dense charts identifiable without reading the floating tooltip.
          // It intentionally ignores `tooltipEnabled`.
          const axisEl = axisHoverRef.current;
          const cursorTop = u.cursor.top;
          if (!axisEl) return;
          if (cursorTop == null) {
            axisEl.hidden = true;
            return;
          }

          let bestItem: VizItem | null = null;
          let bestValue = 0;
          let bestScale: VizSeriesYScale = PRIMARY_SCALE;
          let bestY = 0;
          let bestDist = AXIS_HOVER_MAX_DISTANCE_PX + 1;
          let axisRank = 0;
          for (let seriesIdx = 0; seriesIdx < chartItemsRef.current.length; seriesIdx++) {
            const item = chartItemsRef.current[seriesIdx];
            if (!item.visible) continue;
            if (axisRank >= maxVisibleSeries) break;
            axisRank++;
            const value = u.data[seriesIdx + 1]?.[idx];
            if (typeof value !== 'number' || Number.isNaN(value)) continue;
            const scaleKey = resolveYScaleRef.current(item);
            if (!u.scales[scaleKey]) continue;
            const yPx = u.valToPos(value, scaleKey, false);
            if (!Number.isFinite(yPx)) continue;
            const dist = Math.abs(yPx - cursorTop);
            if (dist < bestDist) {
              bestDist = dist;
              bestItem = item;
              bestValue = value;
              bestScale = scaleKey;
              bestY = yPx;
            }
          }

          if (!bestItem || bestDist > AXIS_HOVER_MAX_DISTANCE_PX) {
            axisEl.hidden = true;
            return;
          }

          const display = formatValue(items.get(bestItem.id), rawValues, bestValue);
          const dot = document.createElement('span');
          dot.className = 'viz-axis-hover-dot';
          dot.style.backgroundColor = bestItem.color;
          const name = document.createElement('span');
          name.className = 'viz-axis-hover-name';
          name.textContent = chartLabelRef.current(bestItem);
          const valueEl = document.createElement('span');
          valueEl.className = 'viz-axis-hover-value';
          valueEl.textContent = display;
          axisEl.replaceChildren(dot, name, valueEl);

          const rightSide = bestScale !== PRIMARY_SCALE;
          const wrapEl = wrapRef.current;
          const wrapWidth = wrapEl?.clientWidth ?? 0;
          const axisInset = 6;
          axisEl.classList.toggle('is-right', rightSide);
          // Keep the label just inside the plot so it does not cover the
          // numeric tick labels in the axis gutter.
          axisEl.style.left = rightSide ? '' : `${Math.round(bb.left + axisInset)}px`;
          axisEl.style.right = rightSide && wrapWidth > 0
            ? `${Math.max(0, Math.round(wrapWidth - (bb.left + bb.width) + axisInset))}px`
            : rightSide ? '3px' : '';
          const maxTop = (wrapEl?.clientHeight ?? bb.top + bb.height) - 12;
          axisEl.style.top = `${Math.max(12, Math.min(maxTop, bb.top + bestY))}px`;
          axisEl.hidden = false;
        }],
      },
    });

    const ro = new ResizeObserver(entries => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (nextWidth <= 0) return;
      const u = plotRef.current;
      if (u) {
        u.setSize({ width: nextWidth, height });
        syncPlotAndBreaks(u);
      }
    });
    ro.observe(container);

    const initialWidth = Math.floor(container.clientWidth);
    yUserAdjustedRef.current = false;
    const plot = new uPlot(
      makeOptions(initialWidth > 0 ? initialWidth : 640),
      buildAlignedData(plotPoints, chartItems, digitalLanes, digitalLaneCount),
      container,
    );
    plot.root.classList.add('viz-canvas-chart');
    plotRef.current = plot;
    syncPlotAndBreaks(plot);

    if (imperativeXRangeRef.current) {
      plot.setScale('x', imperativeXRangeRef.current);
    } else if (windowIndices) {
      applyWindowIndices(windowIndices.start, windowIndices.end);
    } else if (xWindowTimeKeys) {
      applyXWindowTimeKeys(xWindowTimeKeys.start, xWindowTimeKeys.end);
    } else if (fullTimeline && fullTimeline.length > 0) {
      resetWindow();
    } else if (plotPoints.length > 0) {
      const range = xScaleFromIndices(plotPoints, 0, plotPoints.length - 1);
      if (range) {
        imperativeXRangeRef.current = range;
        plot.setScale('x', range);
      }
    }

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
      container.replaceChildren();
    };
  }, [hasPlotData, seriesLayoutKey, yAxisLayoutKey, height, theme, maxVisibleSeries, digitalLanes, digitalLaneCount, applyWindowIndices, applyXWindowTimeKeys, resetWindow, syncPlotAndBreaks, getSessionBreakTimesSec, getGapThresholdSec, drawCommandOverlay]);

  useEffect(() => {
    plotRef.current?.redraw();
  }, [commandEvents, showCommands]);

  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    let visibleRank = 0;
    chartItems.forEach((item, idx) => {
      let show = false;
      if (item.visible) {
        show = visibleRank < maxVisibleSeries;
        visibleRank++;
      }
      u.setSeries(idx + 1, { show });
    });
  }, [visibilityKey, chartItems, maxVisibleSeries]);

  useEffect(() => {
    const u = plotRef.current;
    if (!u || plotPoints.length === 0) return;
    const savedX = imperativeXRangeRef.current;
    u.setData(buildAlignedData(plotPoints, chartItems, digitalLanes, digitalLaneCount));
    if (savedX) {
      u.setScale('x', savedX);
    } else if (xWindowTimeKeys) {
      const range = xScaleFromTimeKeys(xWindowTimeKeys.start, xWindowTimeKeys.end);
      if (range) {
        imperativeXRangeRef.current = range;
        u.setScale('x', range);
      }
    }
    syncPlotAndBreaks(u);
  }, [plotPoints, chartItems, seriesLayoutKey, digitalLanes, digitalLaneCount, syncPlotAndBreaks, xWindowTimeKeys]);

  // Explicit Y min/max (profile item settings or the global axis range) must win
  // over an earlier manual Y zoom; otherwise the domain effect below keeps
  // returning early and new bounds never reach uPlot.
  useEffect(() => {
    yUserAdjustedRef.current = false;
  }, [yDomainOverrideKey]);

  useEffect(() => {
    const u = plotRef.current;
    if (!u || plotPoints.length === 0) return;
    // 사용자가 Y축을 직접 조정한 뒤에는 데이터 갱신이 그 구간을 덮어쓰지 않는다.
    if (yUserAdjustedRef.current) return;
    const leftDomain = yAxisDomains[PRIMARY_SCALE];
    const rightDomain = yAxisDomains[SECONDARY_SCALE];
    if (leftDomain) u.setScale('y', { min: leftDomain[0], max: leftDomain[1] });
    if (rightDomain) u.setScale('y2', { min: rightDomain[0], max: rightDomain[1] });
    u.redraw();
    syncPlotAndBreaks(u);
  }, [plotPoints.length, yDomainKey, yDomainOverrideKey, syncPlotAndBreaks, yAxisDomains]);

  useEffect(() => {
    const u = plotRef.current;
    if (!u || plotPoints.length === 0) return;
    if (!xWindowTimeKeys && !(fullTimeline && windowIndices)) return;
    // Only react to the committed window changing. Data publishes update
    // plotPoints every ~250ms; re-applying the React window then used the
    // last committed (pre-zoom) range and snapped an in-progress zoom back.
    syncXWindow();
    syncPlotAndBreaks(u);
    // Intentionally not depending on plotPoints.length / xWindowTimeKeys:
    // the data effect above preserves imperativeXRangeRef on row updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xWindowKey, fullTimeline, windowIndices, syncXWindow, syncPlotAndBreaks]);

  const sessionBreakTimesKey = sessionBreakTimesSec.length > 0
    ? `${sessionBreakTimesSec.length}:${sessionBreakTimesSec[0]}:${sessionBreakTimesSec[sessionBreakTimesSec.length - 1]}`
    : '';

  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    syncSessionBreaks(u);
    u.redraw();
  }, [sessionBreakTimesKey, syncSessionBreaks]);

  useEffect(() => {
    if (hideTooltip) hideTooltipEl();
  }, [hideTooltip, hideTooltipEl]);

  if (plotPoints.length === 0 || chartItems.length === 0) {
    return null;
  }
  let visibleRank = 0;
  let hasShownSeries = false;
  for (const item of chartItems) {
    if (!item.visible) continue;
    if (visibleRank < maxVisibleSeries) hasShownSeries = true;
    visibleRank++;
  }
  if (!hasShownSeries) return null;

  return (
    <div ref={wrapRef} className="viz-canvas-chart-wrap">
      <div ref={containerRef} className="viz-canvas-chart-host" />
      <div ref={sessionBreaksRef} className="viz-chart-session-breaks" />
      <div ref={tooltipRef} className="viz-chart-tooltip viz-canvas-chart-tooltip" hidden />
      <div ref={axisHoverRef} className="viz-axis-hover-label" hidden />
    </div>
  );
});

export default VizCanvasChart;
