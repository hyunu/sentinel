import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { formatDateOnly, parseDateOnly } from '../utils/date';

interface DateRangePickerProps {
  start: string;
  end: string;
  disabled?: boolean;
  onChange: (start: string, end: string) => void;
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function buildMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Date[] = [];
  for (let i = lead - 1; i >= 0; i--) cells.push(addDays(first, -i));
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  const remaining = cells.length % 7;
  if (remaining !== 0) {
    const last = cells[cells.length - 1];
    for (let i = 1; i <= 7 - remaining; i++) cells.push(addDays(last, i));
  }
  return cells;
}

export default function DateRangePicker({ start, end, disabled, onChange }: DateRangePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => {
    const base = parseDateOnly(start || end) ?? new Date();
    return startOfDay(base);
  });
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const startDate = useMemo(() => (start ? parseDateOnly(start) : null), [start]);
  const endDate = useMemo(() => (end ? parseDateOnly(end) : null), [end]);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen(o => {
      if (!o) {
        const base = parseDateOnly(start || end) ?? new Date();
        setView(startOfDay(base));
        setPendingStart(null);
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
          setPopoverPos({ top: rect.bottom + 6, left: rect.left });
        }
      }
      return !o;
    });
  }, [disabled, start, end]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPopoverPos({ top: rect.bottom + 6, left: rect.left });
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const pickDay = useCallback((d: Date) => {
    const key = formatDateOnly(d);
    if (!pendingStart) {
      setPendingStart(key);
      onChange(key, '');
      return;
    }
    const pend = parseDateOnly(pendingStart)!;
    if (d.getTime() < pend.getTime()) {
      setPendingStart(key);
      onChange(key, '');
      return;
    }
    onChange(pendingStart, key);
    setPendingStart(null);
    setOpen(false);
  }, [pendingStart, onChange]);

  const prevMonth = useCallback(() => {
    setView(v => new Date(v.getFullYear(), v.getMonth() - 1, 1));
  }, []);
  const nextMonth = useCallback(() => {
    setView(v => new Date(v.getFullYear(), v.getMonth() + 1, 1));
  }, []);

  const cells = useMemo(
    () => buildMonthDays(view.getFullYear(), view.getMonth()),
    [view],
  );

  const rangeStart = pendingStart ? parseDateOnly(pendingStart) : startDate;
  const rangeEnd = pendingStart ? null : endDate;

  const inRange = useCallback((d: Date) => {
    if (!rangeStart) return false;
    const end = rangeEnd ?? rangeStart;
    const lo = rangeStart.getTime() < end.getTime() ? rangeStart : end;
    const hi = rangeStart.getTime() > end.getTime() ? rangeStart : end;
    return d.getTime() > lo.getTime() && d.getTime() < hi.getTime();
  }, [rangeStart, rangeEnd]);

  const isEndpoint = useCallback((d: Date) => {
    const t = d.getTime();
    const a = rangeStart ? rangeStart.getTime() : NaN;
    const b = (rangeEnd ?? rangeStart) ? (rangeEnd ?? rangeStart)!.getTime() : NaN;
    return t === a || t === b;
  }, [rangeStart, rangeEnd]);

  const monthLabel = `${view.getFullYear()}.${String(view.getMonth() + 1).padStart(2, '0')}`;
  const rangeLabel = start && end
    ? `${start} ~ ${end}`
    : start
      ? `${start} ~ …`
      : t('viz.selectDateRange');

  return (
    <div ref={rootRef} className="viz-date-range-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`viz-date-range-trigger${start && end ? ' has-range' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="viz-date-range-text">{rangeLabel}</span>
        <span className={`viz-date-range-caret${open ? ' open' : ''}`} aria-hidden>▾</span>
      </button>
      {open && popoverPos && (
        <div
          className="viz-date-range-popover"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          role="dialog"
          aria-label={t('viz.selectDateRange')}
        >
          <div className="viz-date-range-head">
            <button type="button" className="viz-date-range-nav" onClick={prevMonth} aria-label={t('viz.prevMonth')}>‹</button>
            <span className="viz-date-range-month">{monthLabel}</span>
            <button type="button" className="viz-date-range-nav" onClick={nextMonth} aria-label={t('viz.nextMonth')}>›</button>
          </div>
          <div className="viz-date-range-grid viz-date-range-weekdays">
            {WEEKDAY_LABELS.map((l, i) => (
              <span key={i} className="viz-date-range-weekday">{l}</span>
            ))}
          </div>
          <div className="viz-date-range-grid">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === view.getMonth();
              const r = inRange(d);
              const e = isEndpoint(d);
              return (
                <button
                  key={i}
                  type="button"
                  className={`viz-date-range-day${inMonth ? '' : ' out'}`}
                  onClick={() => pickDay(d)}
                  data-in-range={r || undefined}
                  data-endpoint={e || undefined}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="viz-date-range-hint">{t('viz.dateRangeHint')}</div>
        </div>
      )}
    </div>
  );
}
