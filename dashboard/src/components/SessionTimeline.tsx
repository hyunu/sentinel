import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { api } from '../api';
import type { Session } from '../api';
import { formatDateTime, formatTimeInterval } from '../utils/date';
import { useTranslation } from '../i18n';

interface SessionTimelineProps {
  boardId: string;
  sessions: Session[];
  refreshKey?: number;
  onSelectRange: (start: string, end: string) => void;
}

type BinState = 'assigned' | 'unassigned' | 'empty';

interface TimelineBin {
  state: BinState;
  count: number;
  start: number;
  end: number;
  title: string;
}

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
  const [counts, setCounts] = useState<number[]>([]);
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
        setCounts(res.counts ?? []);
      })
      .catch(e => {
        if (cancelled) return;
        console.error(e);
        setLoadError(t('sessions.timelineLoadFailed'));
        setPresent([]);
        setCounts([]);
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

  // Segments covered by two or more sessions at the same time. `full` marks
  // segments where two sessions have exactly the same start and end.
  const overlapSegments = useMemo(() => {
    if (sessionRanges.length < 2) return [];
    const points: { t: number; d: number }[] = [];
    for (const range of sessionRanges) {
      points.push({ t: range.start, d: 1 });
      points.push({ t: range.end, d: -1 });
    }
    points.sort((a, b) => (a.t - b.t) || (a.d - b.d));
    const out: { start: number; end: number; names: string[]; full: boolean }[] = [];
    let active = 0;
    let prev: number | null = null;
    for (const point of points) {
      if (prev != null && point.t > prev && active >= 2) {
        const segStart = prev;
        const activeRanges = sessionRanges.filter(range => range.start < point.t && range.end > segStart);
        let full = false;
        for (let i = 0; i < activeRanges.length && !full; i += 1) {
          for (let j = i + 1; j < activeRanges.length; j += 1) {
            if (
              activeRanges[i].start === activeRanges[j].start
              && activeRanges[i].end === activeRanges[j].end
            ) {
              full = true;
              break;
            }
          }
        }
        out.push({
          start: segStart,
          end: point.t,
          names: activeRanges.map(range => range.name),
          full,
        });
      }
      active += point.d;
      prev = point.t;
    }
    return out;
  }, [sessionRanges]);

  const fullOverlapCount = overlapSegments.filter(segment => segment.full).length;
  const partialOverlapCount = overlapSegments.length - fullOverlapCount;

  const maxCount = useMemo(() => {
    let max = 0;
    for (let i = 0; i < present.length; i += 1) {
      if (present[i] && counts[i] > max) max = counts[i];
    }
    return max;
  }, [present, counts]);

  const bins = useMemo(() => {
    if (!hasRange || present.length === 0) return [];
    const out: TimelineBin[] = [];
    const binMs = span / present.length;
    for (let i = 0; i < present.length; i += 1) {
      const binStart = startMs + binMs * i;
      const binEnd = binStart + binMs;
      const center = (binStart + binEnd) / 2;
      const startText = formatDateTime(new Date(binStart).toISOString());
      const endText = formatDateTime(new Date(binEnd).toISOString());
      if (!present[i]) {
        out.push({
          state: 'empty',
          count: 0,
          start: binStart,
          end: binEnd,
          title: `${startText} ~ ${endText} · ${t('sessions.timelineEmpty')}`,
        });
        continue;
      }
      const covered = sessionRanges.some(range => center >= range.start && center <= range.end);
      out.push({
        state: covered ? 'assigned' : 'unassigned',
        count: counts[i] ?? 0,
        start: binStart,
        end: binEnd,
        title: t('sessions.timelineBin', {
          start: startText,
          end: endText,
          count: (counts[i] ?? 0).toLocaleString(),
        }),
      });
    }
    return out;
  }, [hasRange, present, counts, sessionRanges, startMs, span, t]);

  // 0..1 logarithmic density so sparse bursts stay visible while dense regions
  // read as saturated.
  const densityOf = (count: number): number => {
    if (maxCount <= 1) return 1;
    const ratio = Math.log10(count + 1) / Math.log10(maxCount + 1);
    return Math.max(0, Math.min(1, ratio));
  };

  const binColor = (bin: TimelineBin): string => {
    const density = densityOf(bin.count);
    if (bin.state === 'assigned') {
      return `rgba(110, 158, 214, ${0.16 + 0.36 * density})`;
    }
    return `rgba(251, 191, 36, ${0.24 + 0.56 * density})`;
  };

  const coverage = useMemo(() => {
    if (!hasRange || present.length === 0) return null;
    const binMs = span / present.length;
    let covered = 0;
    let gapRuns = 0;
    let gapMs = 0;
    for (let i = 0; i < present.length; i += 1) {
      if (present[i]) {
        covered += 1;
        continue;
      }
      gapMs += binMs;
      if (i === 0 || present[i - 1]) gapRuns += 1;
    }
    const percent = (covered / present.length) * 100;
    return { percent, gapRuns, gapMs };
  }, [hasRange, present, span]);

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
              {bins.map((bin, i) => (
                <span
                  key={i}
                  className={`session-timeline-bin is-${bin.state}`}
                  style={bin.state === 'empty' ? undefined : { backgroundColor: binColor(bin) }}
                  title={bin.title}
                />
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
            {overlapSegments.map((segment, i) => {
              const left = ((segment.start - startMs) / span) * 100;
              const width = ((segment.end - segment.start) / span) * 100;
              return (
                <span
                  key={`overlap-${i}`}
                  className={`session-timeline-overlap${segment.full ? ' is-full' : ''}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.15)}%` }}
                  title={`${segment.full ? t('sessions.timelineOverlapFull') : t('sessions.timelineOverlapPartial')} · ${segment.names.join(', ')}`}
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
            {partialOverlapCount > 0 && (
              <span><i className="session-timeline-dot is-overlap" />{t('sessions.timelineOverlapPartial')}</span>
            )}
            {fullOverlapCount > 0 && (
              <span><i className="session-timeline-dot is-overlap-full" />{t('sessions.timelineOverlapFull')}</span>
            )}
            <span className="muted">{t('sessions.timelineHint')}</span>
          </div>
          {(coverage || overlapSegments.length > 0) && (
            <p className="session-timeline-coverage">
              {coverage && (coverage.gapRuns === 0
                ? t('sessions.timelineCoverageFull', {
                  percent: coverage.percent >= 99.95 ? '100' : coverage.percent.toFixed(1),
                })
                : t('sessions.timelineCoverage', {
                  percent: coverage.percent >= 99.95 ? '100' : coverage.percent.toFixed(1),
                  gaps: String(coverage.gapRuns),
                  gapTime: formatTimeInterval(coverage.gapMs),
                }))}
              {partialOverlapCount > 0 && (
                <> · {t('sessions.timelineOverlapCount', { count: String(partialOverlapCount) })}</>
              )}
              {fullOverlapCount > 0 && (
                <> · {t('sessions.timelineOverlapFullCount', { count: String(fullOverlapCount) })}</>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
