import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import type { UartData, Board, UartCursor, Session, ProtocolSpec, DataReparseJob } from '../api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import DataCell from '../components/DataCell';
import { formatDateTime, formatTimeInterval } from '../utils/date';
import { useTranslation } from '../i18n';

type TimeRange = 'all' | '1h' | '24h' | '7d' | 'custom';
type DirectionFilter = '' | 'TX' | 'RX';

const PAGE_SIZES = [50, 100, 200, 500, 1000, 2000, 5000] as const;

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatParsedFields(parsed: Record<string, unknown>): string {
  return Object.entries(parsed)
    .map(([key, value]) => `${key}: ${renderValue(value)}`)
    .join('\n');
}

function sinceForRange(range: TimeRange): string | undefined {
  if (range === 'all' || range === 'custom') return undefined;
  const ms = range === '1h' ? 3_600_000 : range === '24h' ? 86_400_000 : 7 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

/** Format a Date for <input type="datetime-local"> in the browser's local time. */
function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

/** UART 방향 표시 — TX/RX를 색상 + 둥근 보더 pill로 구분한다. */
function DirectionPill({ direction }: { direction: string }) {
  const dir = (direction || '').trim().toUpperCase();
  const kind = dir === 'TX' ? 'is-tx' : dir === 'RX' ? 'is-rx' : 'is-unknown';
  return <span className={`dir-pill ${kind}`}>{dir || '—'}</span>;
}

export default function DataViewerPage() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [protocolNames, setProtocolNames] = useState<Record<string, string>>({});
  const [selectedBoard, setSelectedBoard] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [pageSize, setPageSize] = useState<number>(100);
  const [data, setData] = useState<UartData[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<UartCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCount, setDeleteCount] = useState<number | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reparseOpen, setReparseOpen] = useState(false);
  const [reparseProtocol, setReparseProtocol] = useState('');
  const [reparseMode, setReparseMode] = useState<'missing' | 'all'>('missing');
  const [reparseScope, setReparseScope] = useState<'filter' | 'board'>('filter');
  const [reparseBackup, setReparseBackup] = useState(false);
  const [reparseClearRollups, setReparseClearRollups] = useState(true);
  const [reparseConfirmed, setReparseConfirmed] = useState(false);
  const [reparseJob, setReparseJob] = useState<DataReparseJob | null>(null);
  const [reparseStarting, setReparseStarting] = useState(false);
  const [reparseError, setReparseError] = useState('');

  useEffect(() => {
    api.boards.list().then(setBoards).catch(console.error);
    api.protocols.list().then(list => {
      setProtocols(list);
      const names: Record<string, string> = {};
      for (const p of list) names[p.id] = p.name;
      setProtocolNames(names);
    }).catch(console.error);
  }, []);

  const board = boards.find(b => b.id === selectedBoard);
  const assignedProtocolLabel = board?.protocol_id
    ? (protocolNames[board.protocol_id] ?? board.protocol_id)
    : t('dataViewer.notAssigned');

  const customStartDate = customStart ? new Date(customStart) : null;
  const customEndDate = customEnd ? new Date(customEnd) : null;
  const customStartValid = !!customStartDate && Number.isFinite(customStartDate.getTime());
  const customEndValid = !!customEndDate && Number.isFinite(customEndDate.getTime());
  const customRangeValid = timeRange !== 'custom'
    || (customStartValid && customEndValid && customEndDate!.getTime() > customStartDate!.getTime());
  // Stable strings for the custom range. Preset ranges must be resolved inside
  // fetchPage instead: computing "now - 24h" during render changes the string
  // on every render and would retrigger the fetch effect in a loop.
  const customSince = customStartValid ? customStartDate!.toISOString() : undefined;
  const customUntil = customEndValid ? customEndDate!.toISOString() : undefined;

  const fetchPage = useCallback(async (opts: { append?: boolean; cursor?: UartCursor | null } = {}) => {
    if (!selectedBoard) return;
    if (timeRange === 'custom' && !customRangeValid) return;

    const since = timeRange === 'custom' ? customSince : sinceForRange(timeRange);
    const until = timeRange === 'custom' ? customUntil : undefined;

    const { append = false, cursor = null } = opts;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError('');
    }

    try {
      const result = await api.uart.list({
        board_id: selectedBoard,
        session_id: selectedSession || undefined,
        direction: direction || undefined,
        since,
        until,
        limit: pageSize,
        include_total: !append,
        before_ts: cursor?.timestamp,
        before_id: cursor?.id,
      });

      setData(prev => append ? [...prev, ...result.items] : result.items);
      setHasMore(result.has_more);
      setNextBefore(result.next_before ?? null);
      if (result.total !== undefined) {
        setTotal(result.total);
      }
    } catch (e) {
      console.error(e);
      setError(t('dataViewer.failedToLoad'));
      if (!append) {
        setData([]);
        setTotal(null);
        setHasMore(false);
        setNextBefore(null);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedBoard, selectedSession, direction, pageSize, t, timeRange, customSince, customUntil, customRangeValid]);

  useEffect(() => {
    if (!selectedBoard) return;
    let cancelled = false;
    api.sessions.list(selectedBoard)
      .then(list => {
        if (!cancelled) setSessions(list);
      })
      .catch(error => {
        console.error(error);
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBoard]);

  useEffect(() => {
    if (!selectedBoard) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchPage sets loading state before the async request
    fetchPage();
  }, [selectedBoard, selectedSession, direction, timeRange, pageSize, t, fetchPage]);

  const statLabel = total !== null
    ? t('dataViewer.showingOf', { shown: formatCount(data.length), total: formatCount(total) })
    : data.length > 0
      ? t('dataViewer.showing', { count: formatCount(data.length) })
      : t('dataViewer.noRecords');

  const handleDownload = useCallback(() => {
    if (!selectedBoard || !customRangeValid) return;
    const url = api.data.dumpUrl({
      board_id: selectedBoard,
      session_id: selectedSession || undefined,
      direction: direction || undefined,
      since: timeRange === 'custom' ? customSince : sinceForRange(timeRange),
      until: timeRange === 'custom' ? customUntil : undefined,
      include: 'uart',
      gzip: true,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sentinel-${board?.uid ?? selectedBoard}-uart-${stamp}.ndjson.gz`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [selectedBoard, selectedSession, direction, timeRange, customSince, customUntil, customRangeValid, board?.uid]);

  const openDeleteAll = useCallback(async () => {
    if (!selectedBoard) return;
    setDeleteOpen(true);
    setDeleteConfirmText('');
    setDeleteError('');
    setDeleteCount(null);
    setNotice('');
    try {
      // Count every UART row for the board, not just the filtered page: the
      // delete-all action ignores the current time/session filter.
      const result = await api.uart.list({
        board_id: selectedBoard,
        limit: 1,
        include_total: true,
      });
      setDeleteCount(result.total ?? 0);
    } catch {
      setDeleteCount(null);
    }
  }, [selectedBoard]);

  const deleteConfirmWord = t('dataViewer.deleteConfirmWord');
  const deleteConfirmed = deleteConfirmText.trim().toUpperCase() === deleteConfirmWord;

  const confirmDeleteAll = useCallback(async () => {
    if (!selectedBoard || !deleteConfirmed) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await api.data.delete({
        board_id: selectedBoard,
        confirm: true,
        include: 'uart,rollups',
      });
      setDeleteOpen(false);
      setNotice(t('dataViewer.deleted', { count: formatCount(result.deleted.uart_data) }));
      setData([]);
      setTotal(0);
      setHasMore(false);
      setNextBefore(null);
    } catch (e) {
      console.error(e);
      setDeleteError(t('dataViewer.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }, [selectedBoard, deleteConfirmed, t]);

  const finishedReparseRef = useRef<string | null>(null);

  const openReparse = useCallback(() => {
    if (!selectedBoard) return;
    const boardProtocol = board?.protocol_id;
    const preferred = boardProtocol && protocols.some(p => p.id === boardProtocol)
      ? boardProtocol
      : protocols[0]?.id ?? '';
    setReparseProtocol(preferred);
    setReparseMode('missing');
    setReparseScope('filter');
    setReparseBackup(false);
    setReparseClearRollups(true);
    setReparseConfirmed(false);
    setReparseJob(null);
    setReparseError('');
    setReparseOpen(true);
  }, [selectedBoard, board?.protocol_id, protocols]);

  const startReparse = useCallback(async () => {
    if (!selectedBoard || !reparseProtocol || reparseStarting) return;
    setReparseStarting(true);
    setReparseError('');
    try {
      const scoped = reparseScope === 'filter';
      const since = scoped
        ? (timeRange === 'custom' ? customSince : sinceForRange(timeRange))
        : undefined;
      const until = scoped && timeRange === 'custom' ? customUntil : undefined;
      const result = await api.data.reparseStart({
        board_id: selectedBoard,
        protocol_id: reparseProtocol,
        mode: reparseMode,
        since,
        until,
        session_id: scoped ? (selectedSession || undefined) : undefined,
        direction: scoped ? (direction || undefined) : undefined,
        backup_parsed: reparseBackup,
        clear_rollups: reparseClearRollups,
      });
      try {
        const job = await api.data.reparseStatus(result.job_id);
        setReparseJob(job);
      } catch {
        setReparseJob({
          id: result.job_id,
          board_id: selectedBoard,
          protocol_id: reparseProtocol,
          protocol_version: '',
          mode: reparseMode,
          since: since ?? null,
          until: until ?? null,
          session_id: scoped ? selectedSession : undefined,
          direction: scoped ? direction : undefined,
          backup_parsed: reparseBackup,
          clear_rollups: reparseClearRollups,
          state: 'running',
          phase: 'parse',
          total: result.total,
          processed: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          rollups_cleared: 0,
          cancel_requested: false,
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error(e);
      setReparseError(t('dataViewer.reparseStartFailed'));
    } finally {
      setReparseStarting(false);
    }
  }, [
    selectedBoard, reparseProtocol, reparseStarting, reparseScope, timeRange,
    customSince, customUntil, selectedSession, direction, reparseMode,
    reparseBackup, reparseClearRollups, t,
  ]);

  const cancelReparse = useCallback(async () => {
    if (!reparseJob) return;
    setReparseError('');
    try {
      await api.data.reparseCancel(reparseJob.id);
      setReparseJob(prev => (prev ? { ...prev, state: 'canceling', cancel_requested: true } : prev));
    } catch (e) {
      console.error(e);
      setReparseError(t('dataViewer.reparseCancelFailed'));
    }
  }, [reparseJob, t]);

  const closeReparse = useCallback(() => {
    if (reparseJob && (reparseJob.state === 'running' || reparseJob.state === 'canceling')) {
      return;
    }
    setReparseOpen(false);
  }, [reparseJob]);

  useEffect(() => {
    if (!reparseJob) return;
    if (reparseJob.state !== 'running' && reparseJob.state !== 'canceling') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const job = await api.data.reparseStatus(reparseJob.id);
        if (!cancelled) setReparseJob(job);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setReparseError(t('dataViewer.reparseStatusFailed'));
        }
      }
    };
    const timer = window.setInterval(() => void tick(), 800);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reparseJob?.id, reparseJob?.state, t]);

  useEffect(() => {
    if (!reparseJob) return;
    if (reparseJob.state === 'running' || reparseJob.state === 'canceling') return;
    if (finishedReparseRef.current === reparseJob.id) return;
    finishedReparseRef.current = reparseJob.id;
    if (reparseJob.processed > 0) void fetchPage();
    if (reparseJob.state === 'done') {
      setNotice(t('dataViewer.reparseDoneNotice', {
        count: formatCount(reparseJob.success),
        failed: formatCount(reparseJob.failed),
      }));
    } else if (reparseJob.state === 'canceled') {
      setNotice(t('dataViewer.reparseCanceledNotice', {
        count: formatCount(reparseJob.processed),
      }));
    }
  }, [reparseJob, fetchPage, t]);

  const reparseActive = !!reparseJob
    && (reparseJob.state === 'running' || reparseJob.state === 'canceling');
  const reparseRangeInvalid = reparseScope === 'filter'
    && timeRange === 'custom'
    && !customRangeValid;
  const reparsePercent = reparseJob
    ? (reparseJob.total > 0
      ? Math.min(100, (reparseJob.processed / reparseJob.total) * 100)
      : reparseJob.state === 'done' ? 100 : 0)
    : 0;
  const reparseElapsedSec = reparseJob
    ? Math.max(0, (Date.now() - Date.parse(reparseJob.started_at)) / 1000)
    : 0;
  const reparseEtaSec = reparseJob && reparseJob.processed > 0 && reparseJob.total > reparseJob.processed
    ? (reparseElapsedSec / reparseJob.processed) * (reparseJob.total - reparseJob.processed)
    : null;
  const reparsePhaseLabel = reparseJob?.phase === 'rollups'
    ? t('dataViewer.reparsePhaseRollups')
    : reparseJob?.phase === 'done'
      ? t('dataViewer.reparsePhaseDone')
      : t('dataViewer.reparsePhaseParse');

  return (
    <div className="page">
      <PageHeader
        title={t('dataViewer.title')}
        subtitle={t('dataViewer.subtitle')}
      />

      <div className="card">
        <div className="form-row">
          <div className="form-field">
            <label>{t('common.board')}</label>
            <select
              value={selectedBoard}
              onChange={e => {
                setSelectedBoard(e.target.value);
                setSelectedSession('');
                setSessions([]);
                setData([]);
                setTotal(null);
                setHasMore(false);
                setNextBefore(null);
                setNotice('');
              }}
            >
              <option value="">{t('dataViewer.selectBoard')}</option>
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>{t('dataViewer.assignedProtocol')}</label>
            <input readOnly value={selectedBoard ? assignedProtocolLabel : '—'} />
          </div>
          <div className="form-field">
            <label>{t('dataViewer.timeRange')}</label>
            <select
              value={timeRange}
              onChange={e => {
                const value = e.target.value as TimeRange;
                setTimeRange(value);
                if (value === 'custom' && !customStart && !customEnd) {
                  const end = new Date();
                  const start = new Date(end.getTime() - 86_400_000);
                  setCustomStart(toDateTimeLocalValue(start));
                  setCustomEnd(toDateTimeLocalValue(end));
                }
              }}
            >
              <option value="1h">{t('dataViewer.last1h')}</option>
              <option value="24h">{t('dataViewer.last24h')}</option>
              <option value="7d">{t('dataViewer.last7d')}</option>
              <option value="custom">{t('dataViewer.customRange')}</option>
              <option value="all">{t('dataViewer.allTime')}</option>
            </select>
          </div>
          {timeRange === 'custom' && (
            <>
              <div className="form-field">
                <label>{t('dataViewer.startDateTime')}</label>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>{t('dataViewer.endDateTime')}</label>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="form-field">
            <label>{t('dataViewer.direction')}</label>
            <select value={direction} onChange={e => setDirection(e.target.value as DirectionFilter)}>
              <option value="">{t('common.all')}</option>
              <option value="TX">TX</option>
              <option value="RX">RX</option>
            </select>
          </div>
          <div className="form-field">
            <label>{t('dataViewer.session')}</label>
            <select
              value={selectedSession}
              onChange={e => {
                const value = e.target.value;
                setSelectedSession(value);
                if (value) setTimeRange('all');
              }}
            >
              <option value="">{t('dataViewer.allSessions')}</option>
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.name} · {formatDateTime(session.start_time)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>{t('dataViewer.pageSize')}</label>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        {selectedBoard && !board?.protocol_id && (
          <p className="muted section-hint">
            {t('dataViewer.noProtocolHint')}
          </p>
        )}
        {timeRange === 'custom' && !customRangeValid && (
          <p className="muted section-hint">
            {t('dataViewer.customRangeInvalid')}
          </p>
        )}
      </div>

      <div className="card data-viewer-table-card">
        <div className="toolbar" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span className="toolbar-stat muted">{statLabel}</span>
          {selectedBoard && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || (timeRange === 'custom' && !customRangeValid)}
                onClick={() => fetchPage()}
              >
                {t('common.refresh')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || (timeRange === 'custom' && !customRangeValid)}
                onClick={handleDownload}
              >
                {t('dataViewer.download')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || protocols.length === 0}
                onClick={openReparse}
              >
                {t('dataViewer.reparse')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={loading || deleting}
                onClick={() => void openDeleteAll()}
              >
                {t('dataViewer.deleteAll')}
              </button>
            </>
          )}
        </div>

        {notice && (
          <p className="data-viewer-notice" style={{ padding: '10px 16px' }}>{notice}</p>
        )}

        {error && (
          <p className="muted" style={{ padding: '12px 16px' }}>{error}</p>
        )}

        {loading && data.length === 0 ? (
          <p className="muted" style={{ padding: '24px 16px' }}>{t('common.loading')}</p>
        ) : !loading && data.length === 0 && selectedBoard ? (
          <p className="muted" style={{ padding: '24px 16px' }}>{t('dataViewer.noUartRecords')}</p>
        ) : (
          <div className="data-viewer-table-scroll">
            <table className="data-table data-viewer-table">
              <thead>
                <tr>
                  <th>{t('dataViewer.time')}</th>
                  <th>{t('dataViewer.dir')}</th>
                  <th>{t('dataViewer.raw')}</th>
                  <th>{t('dataViewer.parsed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.id}>
                    <td className="data-viewer-time">{formatDateTime(d.timestamp)}</td>
                    <td className="data-viewer-dir">
                      <DirectionPill direction={d.direction} />
                    </td>
                    <td className="data-viewer-raw-cell">
                      <DataCell
                        text={d.raw_hex}
                        copyText={d.raw_hex}
                        copyLabel={t('dataViewer.copyRaw')}
                        mono
                        clampLines={3}
                        className="is-raw"
                      />
                    </td>
                    <td className="data-viewer-parsed-cell">
                      {d.parsed_fields && Object.keys(d.parsed_fields).length > 0 ? (
                        <DataCell
                          text={formatParsedFields(d.parsed_fields)}
                          copyText={JSON.stringify(d.parsed_fields, null, 2)}
                          copyLabel={t('dataViewer.copyParsed')}
                          mono
                          clampLines={4}
                        />
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && selectedBoard && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadingMore || !nextBefore}
              onClick={() => fetchPage({ append: true, cursor: nextBefore })}
            >
              {loadingMore ? t('common.loading') : t('dataViewer.loadOlder')}
            </button>
          </div>
        )}
      </div>

      <Modal
        open={reparseOpen}
        onClose={closeReparse}
        title={t('dataViewer.reparseTitle')}
        footer={!reparseJob ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={reparseStarting}
              onClick={closeReparse}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                !reparseProtocol
                || reparseStarting
                || reparseRangeInvalid
                || (reparseMode === 'all' && !reparseConfirmed)
              }
              onClick={() => void startReparse()}
            >
              {reparseStarting ? t('common.loading') : t('dataViewer.reparseStart')}
            </button>
          </>
        ) : (
          <>
            {reparseActive && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={reparseJob.state === 'canceling'}
                onClick={() => void cancelReparse()}
              >
                {reparseJob.state === 'canceling'
                  ? t('dataViewer.reparseCanceling')
                  : t('dataViewer.reparseCancel')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={reparseActive}
              onClick={closeReparse}
            >
              {t('common.close')}
            </button>
          </>
        )}
      >
        {!reparseJob ? (
          <div className="data-reparse-form">
            <div className="form-field">
              <label>{t('dataViewer.reparseProtocol')}</label>
              <select
                value={reparseProtocol}
                onChange={e => setReparseProtocol(e.target.value)}
              >
                {protocols.map(protocol => (
                  <option key={protocol.id} value={protocol.id}>
                    {protocol.name} {protocol.version ? `v${protocol.version}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>{t('dataViewer.reparseScope')}</label>
              <div className="data-reparse-options">
                <label className={`data-reparse-option${reparseScope === 'filter' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="reparse-scope"
                    checked={reparseScope === 'filter'}
                    onChange={() => setReparseScope('filter')}
                  />
                  <span>
                    <strong>{t('dataViewer.reparseScopeFilter')}</strong>
                    <small>{t('dataViewer.reparseScopeFilterHint')}</small>
                  </span>
                </label>
                <label className={`data-reparse-option${reparseScope === 'board' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="reparse-scope"
                    checked={reparseScope === 'board'}
                    onChange={() => setReparseScope('board')}
                  />
                  <span>
                    <strong>{t('dataViewer.reparseScopeBoard')}</strong>
                    <small>{t('dataViewer.reparseScopeBoardHint')}</small>
                  </span>
                </label>
              </div>
            </div>

            <div className="form-field">
              <label>{t('dataViewer.reparseMode')}</label>
              <div className="data-reparse-options">
                <label className={`data-reparse-option${reparseMode === 'missing' ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="reparse-mode"
                    checked={reparseMode === 'missing'}
                    onChange={() => setReparseMode('missing')}
                  />
                  <span>
                    <strong>{t('dataViewer.reparseModeMissing')}</strong>
                    <small>{t('dataViewer.reparseModeMissingHint')}</small>
                  </span>
                </label>
                <label className={`data-reparse-option${reparseMode === 'all' ? ' is-active is-danger' : ''}`}>
                  <input
                    type="radio"
                    name="reparse-mode"
                    checked={reparseMode === 'all'}
                    onChange={() => setReparseMode('all')}
                  />
                  <span>
                    <strong>{t('dataViewer.reparseModeAll')}</strong>
                    <small>{t('dataViewer.reparseModeAllHint')}</small>
                  </span>
                </label>
              </div>
            </div>

            <label className="data-reparse-check">
              <input
                type="checkbox"
                checked={reparseBackup}
                onChange={e => setReparseBackup(e.target.checked)}
              />
              {t('dataViewer.reparseBackup')}
            </label>
            <label className="data-reparse-check">
              <input
                type="checkbox"
                checked={reparseClearRollups}
                onChange={e => setReparseClearRollups(e.target.checked)}
              />
              {t('dataViewer.reparseClearRollups')}
            </label>

            {reparseMode === 'all' ? (
              <>
                <div className="data-delete-warning">
                  <strong>⚠ {t('dataViewer.reparseWarningTitle')}</strong>
                  <p>{t('dataViewer.reparseWarningAll')}</p>
                </div>
                <label className="data-reparse-confirm">
                  <input
                    type="checkbox"
                    checked={reparseConfirmed}
                    onChange={e => setReparseConfirmed(e.target.checked)}
                  />
                  {t('dataViewer.reparseConfirm')}
                </label>
              </>
            ) : (
              <p className="muted data-reparse-hint">{t('dataViewer.reparseModeMissingHint')}</p>
            )}

            {reparseRangeInvalid && (
              <p className="data-delete-error">{t('dataViewer.customRangeInvalid')}</p>
            )}

            {reparseError && <p className="data-delete-error">{reparseError}</p>}
          </div>
        ) : (
          <div className="data-reparse-progress">
            <div className="data-reparse-progress-head">
              <strong>{reparsePhaseLabel}</strong>
              <span>{Math.round(reparsePercent)}%</span>
            </div>
            <div className="data-reparse-bar">
              <div style={{ width: `${reparsePercent}%` }} />
            </div>
            <div className="data-reparse-stats">
              <span>{t('dataViewer.reparseProcessed', {
                processed: formatCount(reparseJob.processed),
                total: formatCount(reparseJob.total),
              })}</span>
              <span>{t('dataViewer.reparseSuccess', { count: formatCount(reparseJob.success) })}</span>
              <span>{t('dataViewer.reparseFailed', { count: formatCount(reparseJob.failed) })}</span>
            </div>
            {reparseActive && reparseEtaSec != null && (
              <p className="muted data-reparse-eta">
                {t('dataViewer.reparseEta', { time: formatTimeInterval(reparseEtaSec * 1000) })}
              </p>
            )}
            {reparseJob.rollups_cleared > 0 && (
              <p className="muted">
                {t('dataViewer.reparseRollupsCleared', {
                  count: formatCount(reparseJob.rollups_cleared),
                })}
              </p>
            )}
            {reparseJob.state === 'canceled' && (
              <p className="data-reparse-canceled">{t('dataViewer.reparseCanceled')}</p>
            )}
            {reparseJob.state === 'failed' && (
              <p className="data-delete-error">
                {reparseJob.error || t('dataViewer.reparseJobFailed')}
              </p>
            )}
            {reparseJob.state === 'done' && (
              <p className="data-reparse-done">{t('dataViewer.reparseDone')}</p>
            )}
            {reparseError && <p className="data-delete-error">{reparseError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        title={t('dataViewer.deleteTitle')}
        footer={(
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleting || !deleteConfirmed}
              onClick={() => void confirmDeleteAll()}
            >
              {deleting ? t('dataViewer.deleteRunning') : t('dataViewer.deleteAction')}
            </button>
          </>
        )}
      >
        <div className="data-delete-warning">
          <strong>⚠ {t('dataViewer.deleteWarningHeadline')}</strong>
          <p>
            {t('dataViewer.deleteWarningBody', {
              board: board?.name ?? selectedBoard,
              count: deleteCount != null ? formatCount(deleteCount) : '—',
            })}
          </p>
          <p>{t('dataViewer.deleteWarningBackup')}</p>
        </div>
        <label className="data-delete-confirm" htmlFor="uart-delete-confirm">
          {t('dataViewer.deleteConfirmLabel')}
        </label>
        <input
          id="uart-delete-confirm"
          value={deleteConfirmText}
          onChange={e => setDeleteConfirmText(e.target.value)}
          placeholder={deleteConfirmWord}
          autoComplete="off"
          disabled={deleting}
          autoFocus
        />
        {deleteError && <p className="data-delete-error">{deleteError}</p>}
      </Modal>
    </div>
  );
}
