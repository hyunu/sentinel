import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { UartData, Board, UartCursor, Session } from '../api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { formatDateTime } from '../utils/date';
import { useTranslation } from '../i18n';

type TimeRange = 'all' | '1h' | '24h' | '7d' | 'custom';
type DirectionFilter = '' | 'TX' | 'RX';

const PAGE_SIZES = [50, 100, 200, 500, 1000, 2000, 5000] as const;

const FRAME_META_KEYS = new Set(['stx', 'etx', 'length', 'fid', 'seq_no', 'attr', 'crc16']);

const PAYLOAD_FIELD_ORDER = [
  'temperature_celsius',
  'humidity_percent',
  'sensor_id',
];

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function hexToAscii(hex: string): string {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.substring(i, i + 2), 16);
    out += (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.';
  }
  return out;
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

function displayParsedEntries(parsed: Record<string, unknown>): [string, unknown][] {
  const entries = Object.entries(parsed);
  const picked = new Set<string>();
  const out: [string, unknown][] = [];

  for (const key of PAYLOAD_FIELD_ORDER) {
    if (key in parsed) {
      out.push([key, parsed[key]]);
      picked.add(key);
    }
    const nested = `payload.${key}`;
    if (nested in parsed && !picked.has(key)) {
      out.push([key, parsed[nested]]);
      picked.add(nested);
      picked.add(key);
    }
  }

  for (const [k, v] of entries) {
    if (picked.has(k) || FRAME_META_KEYS.has(k)) continue;
    if (k.startsWith('payload.')) {
      const short = k.slice('payload.'.length);
      if (picked.has(short)) continue;
    }
    out.push([k, v]);
    if (out.length >= 8) break;
  }

  return out.slice(0, 8);
}

export default function DataViewerPage() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocolNames, setProtocolNames] = useState<Record<string, string>>({});
  const [selectedBoard, setSelectedBoard] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
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

  useEffect(() => {
    api.boards.list().then(setBoards).catch(console.error);
    api.protocols.list().then(list => {
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
  const querySince = timeRange === 'custom'
    ? (customStartValid ? customStartDate!.toISOString() : undefined)
    : sinceForRange(timeRange);
  const queryUntil = timeRange === 'custom'
    ? (customEndValid ? customEndDate!.toISOString() : undefined)
    : undefined;

  const fetchPage = useCallback(async (opts: { append?: boolean; cursor?: UartCursor | null } = {}) => {
    if (!selectedBoard) return;
    if (timeRange === 'custom' && !customRangeValid) return;

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
        since: querySince,
        until: queryUntil,
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
  }, [selectedBoard, selectedSession, direction, pageSize, t, querySince, queryUntil, timeRange, customRangeValid]);

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
      since: querySince,
      until: queryUntil,
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
  }, [selectedBoard, selectedSession, direction, querySince, queryUntil, customRangeValid, board?.uid]);

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
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('dataViewer.time')}</th>
                  <th>{t('dataViewer.dir')}</th>
                  <th>{t('dataViewer.raw')}</th>
                  <th>{t('dataViewer.ascii')}</th>
                  <th>{t('dataViewer.parsed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.id}>
                    <td>{new Date(d.timestamp).toLocaleString()}</td>
                    <td>{d.direction}</td>
                    <td className="mono">{d.raw_hex}</td>
                    <td className="mono">{hexToAscii(d.raw_hex)}</td>
                    <td className="mono parsed-cell">
                      {d.parsed_fields
                        ? displayParsedEntries(d.parsed_fields).map(([k, v]) => (
                            <div key={k}><span className="muted">{k}:</span> {renderValue(v)}</div>
                          ))
                        : '—'}
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
