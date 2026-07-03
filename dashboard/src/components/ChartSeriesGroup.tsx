import ChartCursorValues, { type CursorValueRow } from './ChartCursorValues';
import { useTranslation } from '../i18n';

type ChartSeriesGroupProps = {
  open: boolean;
  layout?: 'bottom' | 'left';
  timeKey: string | null;
  formatTime: (iso: string) => string;
  rows: CursorValueRow[];
  onToggleVisibility: (itemId: string) => void;
  onToggleFavorite?: (itemId: string) => void;
};

export default function ChartSeriesGroup({
  open,
  layout = 'bottom',
  timeKey,
  formatTime,
  rows,
  onToggleVisibility,
  onToggleFavorite,
}: ChartSeriesGroupProps) {
  const { t } = useTranslation();

  if (!open || rows.length === 0) return null;

  return (
    <section
      className={`viz-series-group${layout === 'left' ? ' is-layout-left' : ''}`}
      aria-label={t('viz.valuePanel.title')}
    >
      <ChartCursorValues
        embedded
        layout={layout}
        timeKey={timeKey}
        formatTime={formatTime}
        rows={rows}
        onToggleVisibility={onToggleVisibility}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}
