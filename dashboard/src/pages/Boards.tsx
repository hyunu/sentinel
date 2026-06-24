import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board } from '../api';
import { formatDateTime } from '../utils/date';
import PageHeader from '../components/PageHeader';

function rssiClass(rssi: number): string {
  if (rssi >= -60) return 'rssi-good';
  if (rssi >= -75) return 'rssi-ok';
  return 'rssi-weak';
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState('');
  const [bleId, setBleId] = useState('');
  const [wifiMac, setWifiMac] = useState('');

  useEffect(() => {
    const load = () => {
      if (document.activeElement?.classList.contains('table-inline-input')) return;
      api.boards.list().then(setBoards).catch(console.error);
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

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

  const register = async () => {
    if (!name || !bleId) return;
    const board = await api.boards.register({
      name,
      mac_address: bleId,
      ...(wifiMac ? { wifi_mac: wifiMac } : {}),
    });
    setBoards(prev => [board, ...prev]);
    setName('');
    setBleId('');
    setWifiMac('');
  };

  const now = Date.now();
  const onlineCount = boards.filter(
    b => b.is_active && now - new Date(b.last_heartbeat).getTime() < 120_000,
  ).length;

  return (
    <div className="page">
      <PageHeader
        title="Boards"
        subtitle="등록된 보드 상태, 위치, 연결 정보를 확인합니다. 30초마다 자동 갱신됩니다."
      />

      <div className="card">
        <div className="card-header">
          <h2>Register Board</h2>
        </div>
        <div className="form-grid">
          <div className="form-field">
            <label>Name</label>
            <input placeholder="STN-0001" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label>BLE ID</label>
            <input className="mono" placeholder="remoteId / UUID" value={bleId} onChange={e => setBleId(e.target.value)} />
          </div>
          <div className="form-field">
            <label>WiFi MAC</label>
            <input className="mono" placeholder="AA:BB:CC:DD:EE:FF" value={wifiMac} onChange={e => setWifiMac(e.target.value)} />
          </div>
        </div>
        <button onClick={register} className="btn-primary" disabled={!name || !bleId}>
          Register
        </button>
      </div>

      <div className="card table-card">
        <div className="card-header">
          <h2>All Boards</h2>
          <span className="count-badge">{onlineCount} online · {boards.length} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>UID</th>
                <th>Location</th>
                <th>BLE ID</th>
                <th>WiFi MAC</th>
                <th>Status</th>
                <th>Last Heartbeat</th>
                <th>Version</th>
                <th>RSSI</th>
              </tr>
            </thead>
            <tbody>
              {boards.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={9}>등록된 보드가 없습니다.</td>
                </tr>
              ) : boards.map(b => {
                const isActive = b.is_active && (now - new Date(b.last_heartbeat).getTime() < 120_000);
                return (
                  <tr key={b.id}>
                    <td><strong>{b.name}</strong></td>
                    <td className="mono-cell">{b.uid || '—'}</td>
                    <td>
                      <input
                        className="table-inline-input"
                        value={b.location ?? ''}
                        placeholder="위치 입력"
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
                      <span className={`badge ${isActive ? 'badge-online' : 'badge-offline'}`}>
                        {isActive ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="mono-cell">{formatDateTime(b.last_heartbeat)}</td>
                    <td>{b.firmware_version || '—'}</td>
                    <td className={`rssi-cell ${b.wifi_rssi != null ? rssiClass(b.wifi_rssi) : ''}`}>
                      {b.wifi_rssi != null ? `${b.wifi_rssi} dBm` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
