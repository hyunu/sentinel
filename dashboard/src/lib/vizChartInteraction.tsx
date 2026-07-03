/**
 * Visualization 차트 줌/팬/선택 인터랙션.
 * RAF 줌 배치, startTransition, DOM 선택 오버레이, 휠 delta 누적,
 * pan/선택 중 tooltip·pointer-events 차단.
 */
import {
  useCallback,
  useMemo,
  useRef,
  startTransition,
  type MutableRefObject,
  type ReactNode,
} from 'react';

export interface ChartZoomRange {
  start: number;
  end: number;
}

export function chartZoomEquals(
  a: ChartZoomRange | null | undefined,
  b: ChartZoomRange | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.start === b.start && a.end === b.end;
}

export type ChartZoomSetter = (zoom: ChartZoomRange | null) => void;

export interface ChartZoomRafRefs {
  pendingRef: MutableRefObject<ChartZoomRange | null | undefined>;
  rafRef: MutableRefObject<number | null>;
}

export function shouldHideTooltipDuringInteraction(
  isPanning: boolean,
  isSelecting: boolean,
  isMeasuring = false,
): boolean {
  return isPanning || isSelecting || isMeasuring;
}

function updateHorizontalOverlayEl(
  el: HTMLDivElement | null,
  startX: number,
  currentX: number,
): void {
  if (!el) return;
  el.style.left = `${Math.min(startX, currentX)}px`;
  el.style.width = `${Math.max(Math.abs(currentX - startX), 2)}px`;
}

function updateSelectionOverlayEl(
  el: HTMLDivElement | null,
  startX: number,
  currentX: number,
): void {
  updateHorizontalOverlayEl(el, startX, currentX);
}

export interface ChartTimePoint {
  timeKey: string;
}

export function getChartTimeMsFromClientX(
  clientX: number,
  viewportLeft: number,
  viewportWidth: number,
  points: ChartTimePoint[],
): number | null {
  if (points.length === 0 || viewportWidth <= 0) return null;
  const ratio = Math.max(0, Math.min(1, (clientX - viewportLeft) / viewportWidth));
  if (points.length === 1) {
    const t = new Date(points[0].timeKey).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t0 = new Date(points[0].timeKey).getTime();
  const t1 = new Date(points[points.length - 1].timeKey).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return t0 + ratio * (t1 - t0);
}

export function findChartIndexForTime(
  points: ChartTimePoint[],
  timeKey: string,
): number {
  if (points.length === 0) return 0;
  const exact = points.findIndex(p => p.timeKey === timeKey);
  if (exact >= 0) return exact;

  const target = Date.parse(timeKey);
  if (!Number.isFinite(target)) return 0;

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midT = Date.parse(points[mid].timeKey);
    if (midT < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const loT = Date.parse(points[lo].timeKey);
    const prevT = Date.parse(points[lo - 1].timeKey);
    if (Math.abs(prevT - target) < Math.abs(loT - target)) return lo - 1;
  }
  return lo;
}

export function findChartIndexLowerBoundForTimeMs(
  points: ChartTimePoint[],
  timeMs: number,
): number {
  if (points.length === 0) return 0;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midT = Date.parse(points[mid].timeKey);
    if (midT < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, points.length - 1);
}

export function findChartIndexUpperBoundForTimeMs(
  points: ChartTimePoint[],
  timeMs: number,
): number {
  if (points.length === 0) return 0;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midT = Date.parse(points[mid].timeKey);
    if (midT <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

export function findNearestChartIndexForTimeMs(
  points: ChartTimePoint[],
  timeMs: number,
  totalLength?: number,
): number {
  if (points.length === 0) return 0;
  const limit = totalLength != null
    ? Math.min(points.length, totalLength)
    : points.length;
  if (limit <= 1) return 0;

  let lo = 0;
  let hi = limit - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const midT = Date.parse(points[mid].timeKey);
    if (midT > timeMs) hi = mid - 1;
    else lo = mid;
  }
  if (lo > 0) {
    const loT = Date.parse(points[lo].timeKey);
    const prevT = Date.parse(points[lo - 1].timeKey);
    if (Math.abs(prevT - timeMs) < Math.abs(loT - timeMs)) return lo - 1;
  }
  return lo;
}

export function getChartPlotBoundsFromViewport(
  viewportEl: HTMLElement,
): { left: number; width: number } {
  const plotRoot = viewportEl.querySelector('.viz-canvas-chart');
  if (plotRoot instanceof HTMLElement) {
    const under = plotRoot.querySelector('canvas.u-under');
    if (under instanceof HTMLCanvasElement) {
      const viewportRect = viewportEl.getBoundingClientRect();
      const plotRect = under.getBoundingClientRect();
      if (plotRect.width > 0) {
        return {
          left: plotRect.left - viewportRect.left,
          width: plotRect.width,
        };
      }
    }
  }

  const hostRect = viewportEl.querySelector('.viz-canvas-chart-host');
  if (hostRect instanceof HTMLElement && plotRoot instanceof HTMLElement) {
    const viewportRect = viewportEl.getBoundingClientRect();
    const rootRect = plotRoot.getBoundingClientRect();
    if (rootRect.width > 0) {
      return {
        left: rootRect.left - viewportRect.left,
        width: rootRect.width,
      };
    }
  }

  const gridRect = viewportEl.querySelector('.recharts-cartesian-grid rect');
  if (gridRect instanceof SVGGraphicsElement) {
    const viewportRect = viewportEl.getBoundingClientRect();
    const plotRect = gridRect.getBoundingClientRect();
    if (plotRect.width > 0) {
      return {
        left: plotRect.left - viewportRect.left,
        width: plotRect.width,
      };
    }
  }
  return { left: 0, width: 0 };
}

export function getChartPlotMetricsFromViewport(
  viewportEl: HTMLElement,
  plotBounds: { left: number; width: number },
): { plotLeft: number; plotWidth: number; viewportWidth: number } {
  const rect = viewportEl.getBoundingClientRect();
  const plotWidth = plotBounds.width > 0 ? plotBounds.width : rect.width;
  const plotLeft = rect.left + (plotBounds.width > 0 ? plotBounds.left : 0);
  return { plotLeft, plotWidth, viewportWidth: rect.width };
}

export function wheelFocusRatioFromClientX(
  clientX: number,
  plotLeft: number,
  plotWidth: number,
): number {
  if (plotWidth <= 0) return 0.5;
  return Math.max(0, Math.min(1, (clientX - plotLeft) / plotWidth));
}

export function computePanWindow(
  points: ChartTimePoint[],
  zoomStart: number,
  zoomEnd: number,
  deltaX: number,
  plotWidth: number,
  totalLength: number,
): { start: number; end: number } {
  const len = totalLength;
  if (len <= 0 || plotWidth <= 0) return { start: 0, end: 0 };

  const s = Math.max(0, Math.min(zoomStart, len - 1));
  const e = Math.max(s, Math.min(zoomEnd, len - 1));
  const startMs = Date.parse(points[s]?.timeKey ?? '');
  const endMs = Date.parse(points[e]?.timeKey ?? '');

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    const span = e - s + 1;
    const shift = Math.round(-(deltaX / plotWidth) * span);
    let newStart = s + shift;
    let newEnd = e + shift;
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd >= len) {
      newStart -= newEnd - len + 1;
      newEnd = len - 1;
    }
    return {
      start: Math.max(0, newStart),
      end: Math.min(len - 1, newEnd),
    };
  }

  const timeSpanMs = endMs - startMs;
  const deltaTimeMs = -(deltaX / plotWidth) * timeSpanMs;
  let newStartMs = startMs + deltaTimeMs;
  let newEndMs = endMs + deltaTimeMs;

  const fullStartMs = Date.parse(points[0]?.timeKey ?? '');
  const fullEndMs = Date.parse(points[len - 1]?.timeKey ?? '');
  if (Number.isFinite(fullStartMs) && newStartMs < fullStartMs) {
    const overflow = fullStartMs - newStartMs;
    newStartMs = fullStartMs;
    newEndMs += overflow;
  }
  if (Number.isFinite(fullEndMs) && newEndMs > fullEndMs) {
    const overflow = newEndMs - fullEndMs;
    newEndMs = fullEndMs;
    newStartMs -= overflow;
  }

  let newStart = findChartIndexLowerBoundForTimeMs(points, newStartMs);
  let newEnd = findChartIndexUpperBoundForTimeMs(points, newEndMs);
  if (newEnd < newStart) newEnd = newStart;

  return {
    start: Math.max(0, newStart),
    end: Math.min(len - 1, newEnd),
  };
}

export function computeWheelZoomWindow(
  points: ChartTimePoint[],
  currentStart: number,
  currentEnd: number,
  focusRatio: number,
  newSpan: number,
  totalLength: number,
  focusMsOverride?: number | null,
): { start: number; end: number } {
  const len = totalLength;
  if (len <= 0) return { start: 0, end: 0 };

  const s = Math.max(0, Math.min(currentStart, len - 1));
  const e = Math.max(s, Math.min(currentEnd, len - 1));
  const startMs = Date.parse(points[s]?.timeKey ?? '');
  const endMs = Date.parse(points[e]?.timeKey ?? '');

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    const focusIndex = Math.round(s + focusRatio * (e - s));
    let newStart = Math.round(focusIndex - focusRatio * (newSpan - 1));
    let newEnd = newStart + newSpan - 1;
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd >= len) {
      newStart -= newEnd - len + 1;
      newEnd = len - 1;
    }
    return {
      start: Math.max(0, newStart),
      end: Math.min(len - 1, newEnd),
    };
  }

  const focusMs = focusMsOverride != null && Number.isFinite(focusMsOverride)
    ? focusMsOverride
    : startMs + focusRatio * (endMs - startMs);
  const focusRatioInWindow = Math.max(0, Math.min(1, (focusMs - startMs) / (endMs - startMs)));
  const currentSpanMs = endMs - startMs;
  const newSpanMs = currentSpanMs * (newSpan / Math.max(1, e - s + 1));
  const newStartMs = focusMs - focusRatioInWindow * newSpanMs;
  const newEndMs = newStartMs + newSpanMs;

  let newStart = findChartIndexLowerBoundForTimeMs(points, newStartMs);
  let newEnd = findChartIndexUpperBoundForTimeMs(points, newEndMs);
  if (newEnd < newStart) newEnd = newStart;

  if (newEnd - newStart + 1 > newSpan) {
    newEnd = Math.min(len - 1, newStart + newSpan - 1);
  } else if (newEnd - newStart + 1 < newSpan) {
    newStart = Math.max(0, newEnd - newSpan + 1);
  }

  if (newStart < 0) {
    newEnd -= newStart;
    newStart = 0;
  }
  if (newEnd >= len) {
    newStart -= newEnd - len + 1;
    newEnd = len - 1;
  }

  return {
    start: Math.max(0, newStart),
    end: Math.min(len - 1, newEnd),
  };
}

export function normalizeWheelDeltaY(e: WheelEvent): number {
  let delta = e.deltaY;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
  else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= 400;
  return delta;
}

const WHEEL_ZOOM_SENSITIVITY = 0.002;
const WHEEL_DELTA_DEAD_ZONE = 0.5;
const WHEEL_DELTA_CLAMP = 120;
const WHEEL_REVERSAL_IGNORE = 8;

export function wheelDeltaToZoomFactor(deltaY: number): number | null {
  if (Math.abs(deltaY) < WHEEL_DELTA_DEAD_ZONE) return null;
  const clamped = Math.max(-WHEEL_DELTA_CLAMP, Math.min(WHEEL_DELTA_CLAMP, deltaY));
  return Math.exp(clamped * WHEEL_ZOOM_SENSITIVITY);
}

export interface WheelZoomEvent {
  deltaY: number;
  focusRatio: number;
  focusMs: number | null;
}

export function mergeWheelZoomEvent(
  prev: WheelZoomEvent | null,
  deltaY: number,
  focus: { focusRatio: number; focusMs: number | null },
): WheelZoomEvent | null {
  if (Math.abs(deltaY) < WHEEL_DELTA_DEAD_ZONE) return prev;
  if (!prev) return { deltaY, focusRatio: focus.focusRatio, focusMs: focus.focusMs };
  if (Math.sign(prev.deltaY) !== Math.sign(deltaY) && Math.abs(deltaY) < WHEEL_REVERSAL_IGNORE) {
    return prev;
  }
  return {
    deltaY: prev.deltaY + deltaY,
    focusRatio: focus.focusRatio,
    focusMs: focus.focusMs,
  };
}

export function cancelChartZoomRaf(refs: ChartZoomRafRefs): void {
  if (refs.rafRef.current != null) {
    cancelAnimationFrame(refs.rafRef.current);
    refs.rafRef.current = null;
  }
  refs.pendingRef.current = undefined;
}

export function createChartZoomCommitter(
  chartZoomRef: MutableRefObject<ChartZoomRange | null>,
  setChartZoom: ChartZoomSetter,
  rafRefs: ChartZoomRafRefs,
): ChartZoomSetter {
  return (zoom) => {
    chartZoomRef.current = zoom;
    rafRefs.pendingRef.current = zoom;
    if (rafRefs.rafRef.current != null) return;
    rafRefs.rafRef.current = requestAnimationFrame(() => {
      rafRefs.rafRef.current = null;
      const pending = rafRefs.pendingRef.current;
      rafRefs.pendingRef.current = undefined;
      if (pending === undefined) return;
      startTransition(() => setChartZoom(pending));
    });
  };
}

export function syncChartZoomRef(
  chartZoomRef: MutableRefObject<ChartZoomRange | null>,
  zoom: ChartZoomRange | null,
): void {
  chartZoomRef.current = zoom;
}

export interface ChartSelectionOverlayApi {
  start: (startX: number) => void;
  move: (currentX: number) => void;
  hide: () => void;
  overlayNode: ReactNode;
}

export function useChartSelectionOverlay(): ChartSelectionOverlayApi {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef(0);

  const start = useCallback((startX: number) => {
    startXRef.current = startX;
    const box = overlayRef.current;
    if (box) {
      box.hidden = false;
      updateSelectionOverlayEl(box, startX, startX);
    }
  }, []);

  const move = useCallback((currentX: number) => {
    updateSelectionOverlayEl(overlayRef.current, startXRef.current, currentX);
  }, []);

  const hide = useCallback(() => {
    if (overlayRef.current) overlayRef.current.hidden = true;
  }, []);

  const overlayNode = useMemo((): ReactNode => (
    <div
      ref={overlayRef}
      className="viz-chart-selection-box"
      hidden
      aria-hidden
    />
  ), []);

  return { start, move, hide, overlayNode };
}

export interface ChartTimeMeasureOverlayApi {
  start: (startX: number) => void;
  move: (currentX: number, label: string) => void;
  hide: () => void;
  overlayNode: ReactNode;
}

export function useChartTimeMeasureOverlay(): ChartTimeMeasureOverlayApi {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const startXRef = useRef(0);

  const start = useCallback((startX: number) => {
    startXRef.current = startX;
    const box = overlayRef.current;
    if (box) {
      box.hidden = false;
      updateHorizontalOverlayEl(box, startX, startX);
      if (labelRef.current) labelRef.current.textContent = '0ms';
    }
  }, []);

  const move = useCallback((currentX: number, label: string) => {
    updateHorizontalOverlayEl(overlayRef.current, startXRef.current, currentX);
    if (labelRef.current) labelRef.current.textContent = label;
  }, []);

  const hide = useCallback(() => {
    if (overlayRef.current) overlayRef.current.hidden = true;
  }, []);

  const overlayNode = useMemo((): ReactNode => (
    <div
      ref={overlayRef}
      className="viz-chart-measure-box"
      hidden
      aria-hidden
    >
      <span ref={labelRef} className="viz-chart-measure-label" />
    </div>
  ), []);

  return { start, move, hide, overlayNode };
}
