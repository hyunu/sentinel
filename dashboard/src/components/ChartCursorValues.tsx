import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { VizItem } from '../api';
import { IconEye, IconEyeOff } from './ChartControlIcons';
import { useTranslation } from '../i18n';

export interface CursorValueRow {
  item: VizItem;
  raw?: number;
  prevRaw?: number;
  onChart: boolean;
}

interface ChartCursorValuesProps {
  timeKey: string | null;
  formatTime: (iso: string) => string;
  rows: CursorValueRow[];
  onToggleVisibility?: (itemId: string) => void;
  onToggleFavorite?: (itemId: string) => void;
  embedded?: boolean;
  layout?: 'bottom' | 'left';
}

function applyTransform(raw: number, item: VizItem): number {
  return raw * item.weight + item.offset;
}

function formatValue(raw: number, item: VizItem): string {
  const unit = item.y_axis.unit?.trim();
  const v = applyTransform(raw, item);
  const text = v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit ? `${text} ${unit}` : text;
}

function formatDelta(curr: number, prev: number | undefined, item: VizItem): {
  text: string;
  trend: 'up' | 'down' | 'flat' | 'none';
} {
  if (prev === undefined || !Number.isFinite(prev)) {
    return { text: '', trend: 'none' };
  }
  const c = applyTransform(curr, item);
  const p = applyTransform(prev, item);
  const d = c - p;
  if (Math.abs(d) < 1e-9) return { text: '', trend: 'none' };
  const unit = item.y_axis.unit?.trim();
  const abs = Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const suffix = unit ? ` ${unit}` : '';
  return d > 0
    ? { text: `▲ ${abs}${suffix}`, trend: 'up' }
    : { text: `▼ ${abs}${suffix}`, trend: 'down' };
}

function chartLabel(item: VizItem): string {
  const dot = item.field_ref.field_name?.lastIndexOf('.') ?? -1;
  const fromField = dot >= 0 ? item.field_ref.field_name.slice(dot + 1) : item.field_ref.field_name;
  return item.short_label?.trim() || fromField || item.label;
}

export default function ChartCursorValues({
  timeKey,
  formatTime,
  rows,
  onToggleVisibility,
  onToggleFavorite,
  embedded = false,
  layout = 'bottom',
}: ChartCursorValuesProps) {
  const { t } = useTranslation();
  const withValue = rows.filter(r => typeof r.raw === 'number');
  const empty = rows.length === 0;
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingScrollTopRef.current == null || !gridRef.current) return;
    gridRef.current.scrollTop = pendingScrollTopRef.current;
    pendingScrollTopRef.current = null;
  }, [rows]);

  const preserveScroll = useCallback(() => {
    if (gridRef.current) {
      pendingScrollTopRef.current = gridRef.current.scrollTop;
    }
  }, []);

  const handleToggleFavorite = useCallback((event: MouseEvent<HTMLDivElement>, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onToggleFavorite) return;
    preserveScroll();
    onToggleFavorite(itemId);
  }, [onToggleFavorite, preserveScroll]);

  const handleToggleVisibility = useCallback((event: MouseEvent<HTMLButtonElement>, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!onToggleVisibility) return;
    preserveScroll();
    onToggleVisibility(itemId);
  }, [onToggleVisibility, preserveScroll]);

  const suppressDoubleClickSelect = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.detail > 1) event.preventDefault();
  }, []);

  return (
    <section
      className={`viz-cursor-values${embedded ? ' is-embedded' : ''}${layout === 'left' ? ' is-layout-left' : ''}`}
      aria-label={t('viz.valuePanel.title')}
    >
      <div className="viz-cursor-values-head">
        <span className="viz-cursor-values-title">{t('viz.valuePanel.title')}</span>
        <time className="viz-cursor-values-time" dateTime={timeKey ?? undefined}>
          {timeKey ? formatTime(timeKey) : '—'}
        </time>
        {timeKey && (
          <span className="viz-cursor-values-meta muted">
            {t('viz.valuePanel.fieldsMeta', { withValue: withValue.length, total: rows.length })}
          </span>
        )}
      </div>
      <div className="viz-cursor-values-body">
        {!timeKey ? (
          <p className="viz-cursor-values-placeholder muted">{t('viz.valuePanel.placeholder')}</p>
        ) : empty ? (
          <p className="viz-cursor-values-placeholder muted">{t('viz.valuePanel.noItems')}</p>
        ) : (
          <div className="viz-cursor-values-grid" role="list" ref={gridRef}>
            {rows.map(({ item, raw, prevRaw, onChart }) => {
              const name = chartLabel(item);
              const hasValue = typeof raw === 'number';
              const isFavorite = !!item.favorite;
              const isVisible = item.visible;
              const delta = hasValue ? formatDelta(raw, prevRaw, item) : { text: '', trend: 'none' as const };
              const titleParts = [item.field_ref.field_name || item.label];
              if (onToggleFavorite) {
                titleParts.push(isFavorite ? t('viz.valuePanel.unpinFavorite') : t('viz.valuePanel.toggleFavorite'));
              }
              return (
                <div
                  key={item.id}
                  role="listitem"
                  className={`viz-cursor-value-cell${onChart ? ' on-chart' : ''}${isFavorite ? ' is-favorite' : ''}${!isVisible ? ' is-item-hidden' : ''}${!hasValue ? ' no-value' : ''}${onToggleFavorite ? ' is-toggleable' : ''}`}
                  title={titleParts.join(' · ')}
                  onMouseDown={onToggleFavorite ? suppressDoubleClickSelect : undefined}
                  onDoubleClick={onToggleFavorite ? e => handleToggleFavorite(e, item.id) : undefined}
                >
                  {onToggleVisibility && (
                    <button
                      type="button"
                      className={`viz-cursor-value-vis-btn${isVisible ? ' is-visible' : ''}`}
                      onClick={e => handleToggleVisibility(e, item.id)}
                      title={isVisible ? t('viz.valuePanel.hideItem', { name }) : t('viz.valuePanel.showItem', { name })}
                      aria-label={isVisible ? t('viz.valuePanel.hideItem', { name }) : t('viz.valuePanel.showItem', { name })}
                      aria-pressed={isVisible}
                    >
                      {isVisible ? <IconEye /> : <IconEyeOff />}
                    </button>
                  )}
                  <span
                    className="viz-cursor-value-swatch"
                    style={{ backgroundColor: item.color }}
                    aria-hidden
                  />
                  <span className="viz-cursor-value-name">{name}</span>
                  <div className="viz-cursor-value-line">
                    <span className="viz-cursor-value-main">
                      {hasValue ? formatValue(raw, item) : '—'}
                    </span>
                    {delta.text ? (
                      <span
                        className={`viz-cursor-value-delta trend-${delta.trend}`}
                        title="직전 포인트 대비 변화량"
                      >
                        {delta.text}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function buildCursorValueRows(
  items: VizItem[],
  valuesAtTime: Record<string, number> | undefined,
  prevValuesAtTime: Record<string, number> | undefined,
  chartItemIds: Set<string>,
): CursorValueRow[] {
  return items.map(item => ({
    item,
    raw: valuesAtTime?.[item.label],
    prevRaw: prevValuesAtTime?.[item.label],
    onChart: chartItemIds.has(item.id),
  }));
}
