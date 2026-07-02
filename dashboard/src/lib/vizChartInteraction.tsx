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

export function mergeWheelZoomEvent(
  prev: { deltaY: number; focusRatio: number } | null,
  deltaY: number,
  focusRatio: number,
): { deltaY: number; focusRatio: number } {
  if (!prev) return { deltaY, focusRatio };
  return { deltaY: prev.deltaY + deltaY, focusRatio };
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
