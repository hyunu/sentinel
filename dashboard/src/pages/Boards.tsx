import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board } from '../api';
import { formatDateTime } from '../utils/date';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';

function rssiClass(rssi: number): string {
  if (rssi >= -60) return 'rssi-good';
  if (rssi >= -75) return 'rssi-ok';
  return 'rssi-weak';
}

function isBoardOnline(b: Board, now: number): boolean {
  return b.is_active && now - new Date(b.last_heartbeat).getTime() < 120_000;
}

function emptyRegisterForm() {
  return { name: '', bleId: '', wifiMac: '', location: '' };
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    const load = (showLoading = false) => {
      if (document.activeElement?.classList.contains('table-inline-input')) return;
      if (showLoading) setLoading(true);
      api.boards.list()
        .then(setBoards)
        .catch(console.error)
        .finally(() => { if (showLoading) setLoading(false); });
    };
    load(true);
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
      ? `"${boardName}" 보드를 삭제할까요? 연결된 기기에 삭제 알림을 보낸 뒤, 다음 heartbeat에서 데이터가 제거됩니다.`
      : `"${boardName}" 보드와 관련 데이터(UART, 세션, 온도 등)를 모두 삭제할까요?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await api.boards.delete(id);
      setBoards(prev => prev.filter(b => b.id !== id));
      if (res.pending) {
        window.alert(`"${boardName}" 삭제 요청을 전송했습니다. 기기가 다음 heartbeat를 보내면 등록이 해제됩니다.`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const register = async () => {
    const { name, bleId, wifiMac, location } = registerForm;
    if (!name || !bleId || registering) return;
    setRegistering(true);
    try {
      const board = await api.boards.register({
        name,
        mac_address: bleId,
        ...(wifiMac ? { wifi_mac: wifiMac } : {}),
        ...(location ? { location } : {}),
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
        title="Boards"
        subtitle="등록된 보드 상태, 위치, 연결 정보를 확인합니다. 30초마다 자동 갱신됩니다."
      />

      <div className="card table-card">
        <div className="card-header">
          <h2>All Boards</h2>
          <div className="btn-group">
            <span className="count-badge">{onlineCount} online · {boards.length} total</span>
            <button type="button" className="btn-primary btn-sm" onClick={openRegister}>
              + Register Board
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted protocols-list-empty">불러오는 중…</p>
        ) : (
          <div className="table-wrap">
            <table className="boards-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>UID</th>
                  <th className="col-location">Location</th>
                  <th>BLE ID</th>
                  <th>WiFi MAC</th>
                  <th>Status</th>
                  <th>Last Heartbeat</th>
                  <th>Version</th>
                  <th>RSSI</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {boards.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={10}>등록된 보드가 없습니다.</td>
                  </tr>
                ) : boards.map(b => {
                  const online = isBoardOnline(b, now);
                  return (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td className="mono-cell">{b.uid || '—'}</td>
                      <td className="col-location">
                        <input
                          className="table-inline-input"
                          value={b.location ?? ''}
                          placeholder="위치"
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
                          {online ? 'Online' : 'Offline'}
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
                          Delete
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
        title="Register Board"
        footer={(
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={closeRegister} disabled={registering}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={register}
              disabled={!canRegister || registering}
            >
              {registering ? 'Registering…' : 'Register'}
            </button>
          </>
        )}
      >
        <div className="form-grid modal-form-grid">
          <div className="form-field">
            <label>Name</label>
            <input
              placeholder="STN-0001"
              value={registerForm.name}
              onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="form-field">
            <label>BLE ID</label>
            <input
              className="mono"
              placeholder="remoteId / UUID"
              value={registerForm.bleId}
              onChange={e => setRegisterForm(f => ({ ...f, bleId: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label>WiFi MAC</label>
            <input
              className="mono"
              placeholder="AA:BB:CC:DD:EE:FF"
              value={registerForm.wifiMac}
              onChange={e => setRegisterForm(f => ({ ...f, wifiMac: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label>Location</label>
            <input
              placeholder="예: Lab A / Rack 3"
              value={registerForm.location}
              onChange={e => setRegisterForm(f => ({ ...f, location: e.target.value }))}
            />
          </div>
        </div>
        <p className="muted modal-hint">Name과 BLE ID는 필수입니다.</p>
      </Modal>
    </div>
  );
}
