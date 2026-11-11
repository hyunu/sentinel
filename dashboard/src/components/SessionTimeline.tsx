import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import type { Session } from '../api';
import { formatDateTime } from '../utils/date';
import { useTranslation } from '../i18n';

interface SessionTimelineProps {
  boardId: string;
  sessions: Session[];
  refreshKey?: number;
  onSelectRange: (start: string, end: string) => void;
}

type BinState = 'assigned' | 'unassigned' | 'empty';

const BIN_COUNT = 600;

export default function SessionTimeline({
  boardId,
  sessions,
  refreshKey = 0,
  onSelectRange,
}: SessionTimelineProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [startIso, setStartIso] = useState('');
  const [endIso, setEndIso] = useState('');
  const [present, setPresent] = useState<boolean[]>([]);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const [dragStartMs, setDragStartMs] = useState<number | null>(null);
  const [dragEndMs, setDragEndMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api.viz.spectrum({ board_id: boardId, bins: BIN_COUNT }, { timeoutMs: 30000 })
      .then(res => {
        if (cancelled) return;
        setStartIso(res.start);
        setEndIso(res.end);
        setPresent(res.present ?? []);
      })
      .catch(e => {
        if (cancelled) return;
        console.error(e);
        setLoadError(t('sessions.timelineLoadFailed'));
        setPresent([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, refreshKey, t]);

  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  const span = endMs - startMs;
  const hasRange = Number.isFinite(startMs) && Number.isFinite(endMs) && span > 0;

  const sessionRanges = useMemo(() => {
    if (!hasRange) return [];
    return sessions
      .map(session => {
        const a = Date.parse(session.start_time);
        const b = session.end_time ? Date.parse(session.end_time) : endMs;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return {
          id: session.id,
          name: session.name,
          start: Math.max(startMs, a),
          end: Math.min(endMs, b),
        };
      })
      .filter((item): item is { id: string; name: string; start: number; end: number } => {
        return !!item && item.end > item.start;
      });
  }, [sessions, hasRange, startMs, endMs]);

  const bins = useMemo(() => {
    if (!hasRange || present.length === 0) return [];
    const out: BinState[] = [];
    for (let i = 0; i < present.length; i += 1) {
      const binStart = startMs + (span * i) / present.length;
      const binEnd = startMs + (span * (i + 1)) / present.length;
      const center = (binStart + binEnd) / 2;
      if (!present[i]) {
        out.push('empty');
        continue;
      }
      const covered = sessionRanges.some(range => center >= range.start && center <= range.end);
      out.push(covered ? 'assigned' : 'unassigned');
    }
    return out;
  }, [hasRange, present, sessionRanges, startMs, span]);

  const ratioToMs = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return startMs + ratio * span;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasRange) return;
    const ms = ratioToMs(event.clientX);
    if (ms == null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStartMs(ms);
    setDragEndMs(ms);
    setCursorMs(ms);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!hasRange) return;
    const ms = ratioToMs(event.clientX);
    if (ms == null) return;
    setCursorMs(ms);
    if (dragStartMs != null) setDragEndMs(ms);
  };

  const finishDrag = () => {
    if (dragStartMs == null || dragEndMs == null) return;
    const from = Math.min(dragStartMs, dragEndMs);
    const to = Math.max(dragStartMs, dragEndMs);
    setDragStartMs(null);
    setDragEndMs(null);
    if (to - from < Math.max(1000, span * 0.005)) return;
    onSelectRange(new Date(from).toISOString(), new Date(to).toISOString());
  };

  const cursorRatio = cursorMs != null && hasRange
    ? Math.max(0, Math.min(1, (cursorMs - startMs) / span))
    : null;
  const selectionStart = dragStartMs != null && dragEndMs != null
    ? (Math.min(dragStartMs, dragEndMs) - startMs) / span
    : null;
  const selectionEnd = dragStartMs != null && dragEndMs != null
    ? (Math.max(dragStartMs, dragEndMs) - startMs) / span
    : null;

  return (
    <div className="session-timeline">
      <div className="session-timeline-head">
        <div className="session-timeline-range">
          <span className="session-timeline-range-label">{t('sessions.timelineStart')}</span>
          <span className="mono">{startIso ? formatDateTime(startIso) : '—'}</span>
        </div>
        <div className="session-timeline-range session-timeline-range--end">
          <span className="session-timeline-range-label">{t('sessions.timelineEnd')}</span>
          <span className="mono">{endIso ? formatDateTime(endIso) : '—'}</span>
        </div>
      </div>

      {loading ? (
        <p className="muted session-timeline-empty">{t('common.loading')}</p>
      ) : loadError ? (
        <p className="muted session-timeline-empty">{loadError}</p>
      ) : !hasRange || bins.length === 0 ? (
        <p className="muted session-timeline-empty">{t('sessions.timelineNoData')}</p>
      ) : (
        <>
          <div
            className="session-timeline-track"
            ref={trackRef}
            role="slider"
            aria-label={t('sessions.timelineAria')}
            aria-valuemin={startMs}
            aria-valuemax={endMs}
            aria-valuenow={cursorMs ?? startMs}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onPointerLeave={() => {
              if (dragStartMs == null) setCursorMs(null);
            }}
          >
            <div className="session-timeline-bins">
              {bins.map((state, i) => (
                <span key={i} className={`session-timeline-bin is-${state}`} />
              ))}
            </div>
            {sessionRanges.map(range => {
              const left = ((range.start - startMs) / span) * 100;
              const width = ((range.end - range.start) / span) * 100;
              return (
                <span
                  key={range.id}
                  className="session-timeline-session"
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.15)}%` }}
                  title={`${range.name} · ${formatDateTime(new Date(range.start).toISOString())} ~ ${formatDateTime(new Date(range.end).toISOString())}`}
                />
              );
            })}
            {selectionStart != null && selectionEnd != null && (
              <span
                className="session-timeline-selection"
                style={{
                  left: `${Math.min(selectionStart, selectionEnd) * 100}%`,
                  width: `${Math.abs(selectionEnd - selectionStart) * 100}%`,
                }}
              />
            )}
            {cursorRatio != null && (
              <span
                className="session-timeline-cursor-line"
                style={{ left: `${cursorRatio * 100}%` }}
              />
            )}
            {cursorRatio != null && cursorMs != null && (
              <span
                className={`session-timeline-cursor-tag${cursorRatio < 0.14 ? ' is-start' : cursorRatio > 0.86 ? ' is-end' : ''}`}
                style={{ left: `${cursorRatio * 100}%` }}
              >
                {formatDateTime(new Date(cursorMs).toISOString())}
              </span>
            )}
          </div>
          <div className="session-timeline-legend">
            <span><i className="session-timeline-dot is-assigned" />{t('sessions.timelineAssigned')}</span>
            <span><i className="session-timeline-dot is-unassigned" />{t('sessions.timelineUnassigned')}</span>
            <span><i className="session-timeline-dot is-empty" />{t('sessions.timelineEmpty')}</span>
            <span className="muted">{t('sessions.timelineHint')}</span>
          </div>
        </>
      )}
    </div>
  );
}
