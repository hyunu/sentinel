import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { UartData, Board, UartCursor } from '../api';
import PageHeader from '../components/PageHeader';
import { useTranslation } from '../i18n';

type TimeRange = 'all' | '1h' | '24h' | '7d';
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
  if (range === 'all') return undefined;
  const ms = range === '1h' ? 3_600_000 : range === '24h' ? 86_400_000 : 7 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
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
  const [direction, setDirection] = useState<DirectionFilter>('');
  const [pageSize, setPageSize] = useState<number>(100);
  const [data, setData] = useState<UartData[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<UartCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

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

  const fetchPage = useCallback(async (opts: { append?: boolean; cursor?: UartCursor | null } = {}) => {
    if (!selectedBoard) return;

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
        direction: direction || undefined,
        since: sinceForRange(timeRange),
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
  }, [selectedBoard, timeRange, direction, pageSize, t]);

  useEffect(() => {
    if (!selectedBoard) {
      setData([]);
      setTotal(null);
      setHasMore(false);
      setNextBefore(null);
      return;
    }
    fetchPage();
  }, [selectedBoard, timeRange, direction, pageSize, t]);

  const statLabel = total !== null
    ? t('dataViewer.showingOf', { shown: formatCount(data.length), total: formatCount(total) })
    : data.length > 0
      ? t('dataViewer.showing', { count: formatCount(data.length) })
      : t('dataViewer.noRecords');

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
            <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
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
            <select value={timeRange} onChange={e => setTimeRange(e.target.value as TimeRange)}>
              <option value="1h">{t('dataViewer.last1h')}</option>
              <option value="24h">{t('dataViewer.last24h')}</option>
              <option value="7d">{t('dataViewer.last7d')}</option>
              <option value="all">{t('dataViewer.allTime')}</option>
            </select>
          </div>
          <div className="form-field">
            <label>{t('dataViewer.direction')}</label>
            <select value={direction} onChange={e => setDirection(e.target.value as DirectionFilter)}>
              <option value="">{t('common.all')}</option>
              <option value="TX">TX</option>
              <option value="RX">RX</option>
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
      </div>

      <div className="card data-viewer-table-card">
        <div className="toolbar" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span className="toolbar-stat muted">{statLabel}</span>
          {selectedBoard && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => fetchPage()}
            >
              {t('common.refresh')}
            </button>
          )}
        </div>

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
    </div>
  );
}
