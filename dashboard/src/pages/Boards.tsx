import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec } from '../api';
import { formatDateTime } from '../utils/date';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useTranslation } from '../i18n';

const DEFAULT_PROTOCOL_ID = 'temperature-telemetry-v1';

function rssiClass(rssi: number): string {
  if (rssi >= -60) return 'rssi-good';
  if (rssi >= -75) return 'rssi-ok';
  return 'rssi-weak';
}

function isBoardOnline(b: Board, now: number): boolean {
  return b.is_active && now - new Date(b.last_heartbeat).getTime() < 120_000;
}

function emptyRegisterForm() {
  return { name: '', bleId: '', wifiMac: '', location: '', protocolId: DEFAULT_PROTOCOL_ID };
}

export default function BoardsPage() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    const load = (showLoading = false) => {
      if (document.activeElement?.classList.contains('table-inline-input')) return;
      if (document.activeElement?.classList.contains('table-inline-select')) return;
      if (showLoading) setLoading(true);
      api.boards.list()
        .then(setBoards)
        .catch(console.error)
        .finally(() => { if (showLoading) setLoading(false); });
    };
    load(true);
    api.protocols.list().then(setProtocols).catch(console.error);
    const timer = setInterval(() => load(false), 30_000);
    return () => clearInterval(timer);
  }, []);

  const openRegister = () => {
    setRegisterForm(emptyRegisterForm());
    setRegisterOpen(true);
  };

  const closeRegister = () => {
    if (registering) return;
    setRegisterOpen(false);
    setRegisterForm(emptyRegisterForm());
  };

  const saveProtocol = async (id: string, protocolId: string) => {
    try {
      const updated = await api.boards.update(id, { protocol_id: protocolId });
      setBoards(prev => prev.map(row => (row.id === id ? updated : row)));
    } catch (err) {
      console.error(err);
      api.boards.list().then(setBoards).catch(console.error);
    }
  };

  const saveLocation = async (id: string, location: string) => {
    try {
      await api.boards.update(id, { location });
      const updated = await api.boards.get(id);
      setBoards(prev => prev.map(row => (row.id === id ? updated : row)));
    } catch (err) {
      console.error(err);
      api.boards.list().then(setBoards).catch(console.error);
    }
  };

  const removeBoard = async (id: string, boardName: string, online: boolean) => {
    const msg = online
      ? t('boards.deleteOnlineConfirm', { name: boardName })
      : t('boards.deleteOfflineConfirm', { name: boardName });
    if (!window.confirm(msg)) return;
    try {
      const res = await api.boards.delete(id);
      setBoards(prev => prev.filter(b => b.id !== id));
      if (res.pending) {
        window.alert(t('boards.deletePendingAlert', { name: boardName }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const register = async () => {
    const { name, bleId, wifiMac, location, protocolId } = registerForm;
    if (!name || !bleId || registering) return;
    setRegistering(true);
    try {
      const board = await api.boards.register({
        name,
        mac_address: bleId,
        ...(wifiMac ? { wifi_mac: wifiMac } : {}),
        ...(location ? { location } : {}),
        ...(protocolId ? { protocol_id: protocolId } : {}),
      });
      setBoards(prev => [board, ...prev]);
      setRegisterOpen(false);
      setRegisterForm(emptyRegisterForm());
    } catch (err) {
      console.error(err);
    } finally {
      setRegistering(false);
    }
  };

  const now = Date.now();
  const onlineCount = boards.filter(b => isBoardOnline(b, now)).length;
  const canRegister = Boolean(registerForm.name && registerForm.bleId);

  return (
    <div className="page">
      <PageHeader
        title={t('boards.title')}
        subtitle={t('boards.subtitle')}
      />

      <div className="card table-card">
        <div className="card-header">
          <h2>{t('boards.allBoards')}</h2>
          <div className="btn-group">
            <span className="count-badge">{t('boards.onlineTotal', { online: onlineCount, total: boards.length })}</span>
            <button type="button" className="btn-primary btn-sm" onClick={openRegister}>
              + {t('boards.registerBoard')}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted protocols-list-empty">{t('boards.loading')}</p>
        ) : (
          <div className="table-wrap">
            <table className="boards-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('boards.uid')}</th>
                  <th>{t('common.protocol')}</th>
                  <th className="col-location">{t('common.location')}</th>
                  <th>{t('boards.bleId')}</th>
                  <th>{t('boards.wifiMac')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('boards.lastHeartbeat')}</th>
                  <th>{t('boards.firmwareVersion')}</th>
                  <th>{t('boards.rssi')}</th>
                  <th className="col-actions">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {boards.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={11}>{t('boards.empty')}</td>
                  </tr>
                ) : boards.map(b => {
                  const online = isBoardOnline(b, now);
                  return (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td className="mono-cell">{b.uid || '—'}</td>
                      <td>
                        <select
                          className="table-inline-select"
                          value={b.protocol_id ?? ''}
                          onChange={e => {
                            const protocol_id = e.target.value;
                            setBoards(prev => prev.map(row =>
                              row.id === b.id ? { ...row, protocol_id: protocol_id || undefined } : row,
                            ));
                            saveProtocol(b.id, protocol_id);
                          }}
                        >
                          <option value="">—</option>
                          {protocols.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="col-location">
                        <input
                          className="table-inline-input"
                          value={b.location ?? ''}
                          placeholder={t('boards.locationPlaceholder')}
                          onChange={e => {
                            const location = e.target.value;
                            setBoards(prev => prev.map(row =>
                              row.id === b.id ? { ...row, location } : row,
                            ));
                          }}
                          onBlur={e => saveLocation(b.id, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        />
                      </td>
                      <td className="mono-cell">{b.mac_address || '—'}</td>
                      <td className="mono-cell">{b.wifi_mac || '—'}</td>
                      <td>
                        <span className={`badge ${online ? 'badge-online' : 'badge-offline'}`}>
                          {online ? t('common.online') : t('common.offline')}
                        </span>
                      </td>
                      <td className="mono-cell">{formatDateTime(b.last_heartbeat)}</td>
                      <td>{b.firmware_version || '—'}</td>
                      <td className={`rssi-cell ${b.wifi_rssi != null ? rssiClass(b.wifi_rssi) : ''}`}>
                        {b.wifi_rssi != null ? `${b.wifi_rssi} dBm` : '—'}
                      </td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => removeBoard(b.id, b.name, online)}
                        >
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={registerOpen}
        onClose={closeRegister}
        title={t('boards.registerBoard')}
        footer={(
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={closeRegister} disabled={registering}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={register}
              disabled={!canRegister || registering}
            >
              {registering ? t('common.registering') : t('common.register')}
            </button>
          </>
        )}
      >
        <div className="form-grid modal-form-grid">
          <div className="form-field">
            <label>{t('common.name')}</label>
            <input
              placeholder={t('boards.registerNamePlaceholder')}
              value={registerForm.name}
              onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="form-field">
            <label>{t('boards.bleId')}</label>
            <input
              className="mono"
              placeholder={t('boards.registerBlePlaceholder')}
              value={registerForm.bleId}
              onChange={e => setRegisterForm(f => ({ ...f, bleId: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label>{t('boards.wifiMac')}</label>
            <input
              className="mono"
              placeholder={t('boards.registerWifiPlaceholder')}
              value={registerForm.wifiMac}
              onChange={e => setRegisterForm(f => ({ ...f, wifiMac: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label>{t('common.protocol')}</label>
            <select
              value={registerForm.protocolId}
              onChange={e => setRegisterForm(f => ({ ...f, protocolId: e.target.value }))}
            >
              <option value="">—</option>
              {protocols.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>{t('common.location')}</label>
            <input
              placeholder={t('boards.registerLocationPlaceholder')}
              value={registerForm.location}
              onChange={e => setRegisterForm(f => ({ ...f, location: e.target.value }))}
            />
          </div>
        </div>
        <p className="muted modal-hint">{t('boards.registerHint')}</p>
      </Modal>
    </div>
  );
}
