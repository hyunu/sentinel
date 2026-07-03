import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';
import uPlot, { type AlignedData, type Options, type Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { VizItem } from '../api';
import { formatChartAxisTime } from '../utils/date';
import { readCssVar } from '../lib/themeColors';
import { useTheme } from '../theme';

export type VizChartPoint = { timeKey: string } & Record<string, string | number>;

const PRIMARY_SCALE = 'y';
const SECONDARY_SCALE = 'y2';

export interface VizCanvasChartHandle {
  setWindowByIndex(start: number, end: number): void;
  resetWindow(): void;
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

export interface VizCanvasChartProps {
  points: VizChartPoint[];
  fullTimeline?: VizChartPoint[];
  windowIndices?: { start: number; end: number } | null;
  chartItems: VizItem[];
  maxVisibleSeries: number;
  yAxisDomains: Record<string, [number, number] | undefined>;
  yAxes: Array<{ id: string; orientation: 'left' | 'right'; unitLabel: string }>;
  chartLabel: (item: VizItem) => string;
  resolveYScale: (item: VizItem) => typeof PRIMARY_SCALE | typeof SECONDARY_SCALE;
  height: number;
  tooltipEnabled: boolean;
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
  const tipW = el.offsetWidth;

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

  el.style.left = `${left}px`;
  el.style.top = `${mouseY + TOOLTIP_Y_GAP}px`;
}

function buildAlignedData(
  points: VizChartPoint[],
  chartItems: VizItem[],
): AlignedData {
  const xs = new Array<number>(points.length);
  const seriesValues = chartItems.map(() => new Array<number | null>(points.length));

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    xs[i] = timeSec(point.timeKey);
    for (let s = 0; s < chartItems.length; s++) {
      const value = point[chartItems[s].id];
      seriesValues[s][i] = typeof value === 'number' && !Number.isNaN(value) ? value : null;
    }
  }

  return [xs, ...seriesValues];
}

function buildSeriesConfig(
  chartItems: VizItem[],
  chartLabel: (item: VizItem) => string,
  resolveYScale: (item: VizItem) => typeof PRIMARY_SCALE | typeof SECONDARY_SCALE,
  maxVisibleSeries: number,
): Series[] {
  let visibleRank = 0;
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
          width: 1,
        };
      }
      return {
        ...base,
        stroke: item.color,
        width: 1,
      };
    }),
  ];
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
    fullTimeline,
    windowIndices,
    chartItems,
    maxVisibleSeries,
    yAxisDomains,
    yAxes,
    chartLabel,
    resolveYScale,
    height,
    tooltipEnabled,
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const fullTimelineRef = useRef(fullTimeline);
  fullTimelineRef.current = fullTimeline;
  const chartItemsRef = useRef(chartItems);
  chartItemsRef.current = chartItems;
  const windowIndicesRef = useRef<{ start: number; end: number } | null>(
    windowIndices ? { start: windowIndices.start, end: windowIndices.end } : null,
  );
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
      return;
    }
    onPlotBoundsChange?.({ left: bb.left, width: bb.width });
  }, [onPlotBoundsChange]);

  const applyWindowIndices = useCallback((start: number, end: number) => {
    const u = plotRef.current;
    const timeline = fullTimelineRef.current ?? pointsRef.current;
    if (!u || timeline.length === 0) return;
    const range = xScaleFromIndices(timeline, start, end);
    if (range) u.setScale('x', range);
    windowIndicesRef.current = { start, end };
  }, []);

  const resetWindow = useCallback(() => {
    const u = plotRef.current;
    const timeline = fullTimelineRef.current ?? pointsRef.current;
    if (!u || timeline.length === 0) return;
    const range = xScaleFromIndices(timeline, 0, timeline.length - 1);
    if (range) u.setScale('x', range);
    windowIndicesRef.current = null;
  }, []);

  useImperativeHandle(ref, () => ({
    setWindowByIndex: applyWindowIndices,
    resetWindow,
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
      const rootRect = u.root.getBoundingClientRect();
      const bb = plotBBoxCss(u);
      const plotX = clientX - rootRect.left - bb.left;
      const clampedPlotX = Math.max(0, Math.min(bb.width, plotX));
      const focusSec = u.posToVal(clampedPlotX, 'x');
      if (!Number.isFinite(focusSec)) return null;
      return focusSec * 1000;
    },
  }), [applyWindowIndices, resetWindow]);

  const hideTooltipEl = useCallback(() => {
    const el = tooltipRef.current;
    if (el) el.hidden = true;
  }, []);

  const seriesLayoutKey = chartItems.map(
    i => `${i.id}:${i.color}:${i.chart_type}:${i.y_axis.id}`,
  ).join('|');
  const visibilityKey = chartItems.map(i => `${i.id}:${i.visible ? 1 : 0}`).join('|');
  const yAxisLayoutKey = yAxes.map(a => `${a.id}:${a.unitLabel}`).join('|');
  const yDomainKey = [
    yAxisDomains.y?.join(','),
    yAxisDomains.y2?.join(','),
  ].join('|');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length === 0 || chartItems.length === 0) return;

    const usesRight = yAxes.some(axis => axis.id === SECONDARY_SCALE);
    const leftDomain = yAxisDomains[PRIMARY_SCALE];
    const rightDomain = yAxisDomains[SECONDARY_SCALE];
    const leftAxis = yAxes.find(a => a.id === PRIMARY_SCALE);
    const rightAxis = yAxes.find(a => a.id === SECONDARY_SCALE);

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
        x: { time: true },
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
      },
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: axisColor },
          font: '11px system-ui, sans-serif',
          gap: 6,
          values: (_u, splits) => splits.map(v => formatChartAxisTime(new Date(v * 1000).toISOString())),
        },
        {
          scale: PRIMARY_SCALE,
          side: 3,
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
      ],
      series: buildSeriesConfig(
        chartItems,
        item => chartLabelRef.current(item),
        item => resolveYScaleRef.current(item),
        maxVisibleSeries,
      ),
      hooks: {
        ready: [syncPlotBounds],
        setSize: [syncPlotBounds],
        setScale: [syncPlotBounds],
        setCursor: [(u) => {
          const idx = u.cursor.idx;
          if (idx == null) {
            hideTooltipEl();
            propsRef.current.onHoverTimeKey(null);
            return;
          }
          const point = pointsRef.current[idx];
          propsRef.current.onHoverTimeKey(point?.timeKey ?? null);

          const el = tooltipRef.current;
          if (!el) return;
          const {
            tooltipEnabled: enabled,
            hideTooltip: hidden,
            itemById: items,
            rawValuesByTimeKey: rawMap,
            formatTooltipValue: formatValue,
          } = propsRef.current;
          if (!enabled || hidden || !point) {
            el.hidden = true;
            return;
          }

          el.hidden = false;
          const bb = plotBBoxCss(u);
          const lineX = bb.left + (u.cursor.left ?? 0);
          const mouseY = bb.top + (u.cursor.top ?? 0);

          const rawValues = rawMap.get(point.timeKey);
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
        }],
      },
    });

    const ro = new ResizeObserver(entries => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (nextWidth <= 0) return;
      const u = plotRef.current;
      if (u) {
        u.setSize({ width: nextWidth, height });
        syncPlotBounds(u);
      }
    });
    ro.observe(container);

    const initialWidth = Math.floor(container.clientWidth);
    const plot = new uPlot(
      makeOptions(initialWidth > 0 ? initialWidth : 640),
      buildAlignedData(points, chartItems),
      container,
    );
    plot.root.classList.add('viz-canvas-chart');
    plotRef.current = plot;
    syncPlotBounds(plot);

    if (windowIndices) {
      applyWindowIndices(windowIndices.start, windowIndices.end);
    } else if (fullTimeline && fullTimeline.length > 0) {
      resetWindow();
    }

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
      container.replaceChildren();
    };
  }, [seriesLayoutKey, yAxisLayoutKey, yDomainKey, height, theme, maxVisibleSeries, applyWindowIndices, resetWindow]);

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

  const windowIndicesKey = windowIndices
    ? `${windowIndices.start}:${windowIndices.end}`
    : 'full';

  useEffect(() => {
    const u = plotRef.current;
    if (!u || points.length === 0) return;
    u.setData(buildAlignedData(points, chartItems));
    const win = windowIndicesRef.current;
    if (win) {
      applyWindowIndices(win.start, win.end);
    } else {
      resetWindow();
    }
    syncPlotBounds(u);
  }, [points, chartItems, seriesLayoutKey, syncPlotBounds, applyWindowIndices, resetWindow]);

  useEffect(() => {
    const u = plotRef.current;
    if (!u || !windowIndices) return;

    const current = windowIndicesRef.current;
    if (
      !current
      || current.start !== windowIndices.start
      || current.end !== windowIndices.end
    ) {
      applyWindowIndices(windowIndices.start, windowIndices.end);
    }
  }, [windowIndicesKey, windowIndices, applyWindowIndices]);

  useEffect(() => {
    if (hideTooltip) hideTooltipEl();
  }, [hideTooltip, hideTooltipEl]);

  if (points.length === 0 || chartItems.length === 0) {
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
      <div ref={tooltipRef} className="viz-chart-tooltip viz-canvas-chart-tooltip" hidden />
    </div>
  );
});

export default VizCanvasChart;
