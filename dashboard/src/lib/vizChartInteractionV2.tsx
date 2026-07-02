/**
 * Visualization 차트 인터랙션 2차 성능 개선.
 *
 * 1차(커밋 기준): Shift+드래그 줌, 드래그 pan, 픽셀 선택 오버레이(React state), pointer capture.
 * 2차(본 모듈): RAF 줌 배치, startTransition, DOM 선택 오버레이, 휠 delta 누적,
 *               pan/선택 중 tooltip·pointer-events 차단.
 *
 * 2차를 끄려면 VIZ_CHART_INTERACTION_V2 = false 로 변경하세요.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  startTransition,
  type MutableRefObject,
  type ReactNode,
} from 'react';

export const VIZ_CHART_INTERACTION_V2 = true;

export interface ChartZoomRange {
  start: number;
  end: number;
}

export type ChartZoomSetter = (zoom: ChartZoomRange | null) => void;

export interface ChartZoomRafRefs {
  pendingRef: MutableRefObject<ChartZoomRange | null | undefined>;
  rafRef: MutableRefObject<number | null>;
}

export function chartViewportPerfClass(): string {
  return VIZ_CHART_INTERACTION_V2 ? ' perf-v2' : '';
}

export function shouldHideTooltipDuringInteraction(
  isPanning: boolean,
  isSelecting: boolean,
): boolean {
  return VIZ_CHART_INTERACTION_V2 && (isPanning || isSelecting);
}

export function updateSelectionOverlayEl(
  el: HTMLDivElement | null,
  startX: number,
  currentX: number,
): void {
  if (!el) return;
  el.style.left = `${Math.min(startX, currentX)}px`;
  el.style.width = `${Math.max(Math.abs(currentX - startX), 2)}px`;
}

export function mergeWheelZoomEvent(
  prev: { deltaY: number; focusRatio: number } | null,
  deltaY: number,
  focusRatio: number,
): { deltaY: number; focusRatio: number } {
  if (!VIZ_CHART_INTERACTION_V2 || !prev) {
    return { deltaY, focusRatio };
  }
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
  if (!VIZ_CHART_INTERACTION_V2) {
    return (zoom) => {
      chartZoomRef.current = zoom;
      setChartZoom(zoom);
    };
  }

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
  if (VIZ_CHART_INTERACTION_V2) {
    chartZoomRef.current = zoom;
  }
}

interface SelectionOverlayState {
  startX: number;
  currentX: number;
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
  const [v1Overlay, setV1Overlay] = useState<SelectionOverlayState | null>(null);

  const start = useCallback((startX: number) => {
    if (VIZ_CHART_INTERACTION_V2) {
      startXRef.current = startX;
      const box = overlayRef.current;
      if (box) {
        box.hidden = false;
        updateSelectionOverlayEl(box, startX, startX);
      }
      return;
    }
    setV1Overlay({ startX, currentX: startX });
  }, []);

  const move = useCallback((currentX: number) => {
    if (VIZ_CHART_INTERACTION_V2) {
      updateSelectionOverlayEl(overlayRef.current, startXRef.current, currentX);
      return;
    }
    setV1Overlay(prev => (prev ? { ...prev, currentX } : null));
  }, []);

  const hide = useCallback(() => {
    if (VIZ_CHART_INTERACTION_V2) {
      if (overlayRef.current) overlayRef.current.hidden = true;
      return;
    }
    setV1Overlay(null);
  }, []);

  const overlayNode = useMemo((): ReactNode => {
    if (VIZ_CHART_INTERACTION_V2) {
      return (
        <div
          ref={overlayRef}
          className="viz-chart-selection-box"
          hidden
          aria-hidden
        />
      );
    }
    if (!v1Overlay) return null;
    return (
      <div
        className="viz-chart-selection-box"
        style={{
          left: `${Math.min(v1Overlay.startX, v1Overlay.currentX)}px`,
          width: `${Math.max(Math.abs(v1Overlay.currentX - v1Overlay.startX), 2)}px`,
        }}
        aria-hidden
      />
    );
  }, [v1Overlay]);

  return { start, move, hide, overlayNode };
}
