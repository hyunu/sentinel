import { useCallback, useEffect, useRef, useState } from 'react';
import ChartCursorValues, { type CursorValueRow } from './ChartCursorValues';
import { useTranslation } from '../i18n';

type ChartSeriesGroupProps = {
  open: boolean;
  layout?: 'bottom' | 'left';
  timeKey: string | null;
  formatTime: (iso: string) => string;
  rows: CursorValueRow[];
  /** Items whose values are being fetched after being turned back on. */
  loadingItemIds?: readonly string[];
  /** When docked left, match the chart viewport height so the grid scrolls
   *  internally instead of stretching the page. */
  panelHeight?: number;
  onToggleVisibility: (itemId: string) => void;
  onToggleFavorite?: (itemId: string) => void;
};

const FIELD_VALUES_HEIGHT_KEY = 'sentinel-viz-field-values-height';
const MIN_FIELD_VALUES_HEIGHT = 140;
const DEFAULT_FIELD_VALUES_HEIGHT = 220;

function readFieldValuesHeight(): number {
  try {
    const raw = localStorage.getItem(FIELD_VALUES_HEIGHT_KEY);
    if (raw != null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return Math.max(MIN_FIELD_VALUES_HEIGHT, Math.min(720, value));
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_FIELD_VALUES_HEIGHT;
}

function maxFieldValuesHeight(): number {
  if (typeof window === 'undefined') return 720;
  return Math.max(MIN_FIELD_VALUES_HEIGHT, Math.min(720, window.innerHeight - 160));
}

export default function ChartSeriesGroup({
  open,
  layout = 'bottom',
  timeKey,
  formatTime,
  rows,
  loadingItemIds,
  panelHeight,
  onToggleVisibility,
  onToggleFavorite,
}: ChartSeriesGroupProps) {
  const { t } = useTranslation();
  const [height, setHeight] = useState(readFieldValuesHeight);
  const heightRef = useRef(height);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const persistHeight = useCallback((value: number) => {
    try {
      localStorage.setItem(FIELD_VALUES_HEIGHT_KEY, String(value));
    } catch {
      /* ignore */
    }
  }, []);

  const applyHeight = useCallback((value: number, persist: boolean) => {
    const next = Math.max(
      MIN_FIELD_VALUES_HEIGHT,
      Math.min(maxFieldValuesHeight(), value),
    );
    heightRef.current = next;
    setHeight(next);
    if (persist) persistHeight(next);
  }, [persistHeight]);

  const endResize = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    setResizing(false);
    persistHeight(heightRef.current);
  }, [persistHeight]);

  useEffect(() => {
    if (!resizing) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      applyHeight(drag.startHeight + event.clientY - drag.startY, false);
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      endResize(event.pointerId);
    };
    const onResize = () => applyHeight(height, false);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('resize', onResize);
    };
  }, [applyHeight, endResize, height, resizing]);

  if (!open || rows.length === 0) return null;

  const resizable = layout === 'bottom';
  const resolvedHeight = Math.min(height, maxFieldValuesHeight());
  const dockedHeight = layout === 'left' && panelHeight ? panelHeight : undefined;

  return (
    <section
      className={`viz-series-group${layout === 'left' ? ' is-layout-left' : ''}${resizing ? ' is-resizing' : ''}`}
      aria-label={t('viz.valuePanel.title')}
      style={dockedHeight
        ? { height: `${dockedHeight}px`, maxHeight: `${dockedHeight}px` }
        : resizable ? { height: `${resolvedHeight}px` } : undefined}
    >
      <ChartCursorValues
        embedded
        layout={layout}
        timeKey={timeKey}
        formatTime={formatTime}
        rows={rows}
        loadingItemIds={loadingItemIds}
        onToggleVisibility={onToggleVisibility}
        onToggleFavorite={onToggleFavorite}
      />
      {resizable && (
        <div
          className="viz-series-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('viz.valuePanel.resize')}
          aria-valuemin={MIN_FIELD_VALUES_HEIGHT}
          aria-valuemax={maxFieldValuesHeight()}
          aria-valuenow={Math.round(resolvedHeight)}
          tabIndex={0}
          title={t('viz.valuePanel.resize')}
          onPointerDown={event => {
            if (event.button !== 0) return;
            dragRef.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startHeight: resolvedHeight,
            };
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const delta = event.key === 'ArrowUp' ? -16 : 16;
            applyHeight(resolvedHeight + delta, true);
          }}
        />
      )}
    </section>
  );
}
