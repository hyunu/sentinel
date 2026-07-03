import ChartCursorValues, { type CursorValueRow } from './ChartCursorValues';
import { useTranslation } from '../i18n';

type ChartSeriesGroupProps = {
  open: boolean;
  timeKey: string | null;
  formatTime: (iso: string) => string;
  rows: CursorValueRow[];
  onToggleVisibility: (itemId: string) => void;
  onToggleFavorite?: (itemId: string) => void;
};

export default function ChartSeriesGroup({
  open,
  timeKey,
  formatTime,
  rows,
  onToggleVisibility,
  onToggleFavorite,
}: ChartSeriesGroupProps) {
  const { t } = useTranslation();

  if (!open || rows.length === 0) return null;

  return (
    <section className="viz-series-group" aria-label={t('viz.valuePanel.title')}>
      <ChartCursorValues
        embedded
        timeKey={timeKey}
        formatTime={formatTime}
        rows={rows}
        onToggleVisibility={onToggleVisibility}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}
