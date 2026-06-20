import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board } from '../api';

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');

  useEffect(() => { api.boards.list().then(setBoards).catch(console.error); }, []);

  const register = async () => {
    if (!name || !mac) return;
    const board = await api.boards.register({ name, mac_address: mac });
    setBoards(prev => [board, ...prev]);
    setName('');
    setMac('');
  };

  const now = Date.now();
  return (
    <div className="page">
      <h1>Board Management</h1>
      <div className="card">
        <h2>Register New Board</h2>
        <div className="form-row">
          <input placeholder="Board Name" value={name} onChange={e => setName(e.target.value)} />
          <input placeholder="MAC Address" value={mac} onChange={e => setMac(e.target.value)} />
          <button onClick={register}>Register</button>
        </div>
      </div>
      <div className="card">
        <h2>Boards ({boards.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>MAC</th>
              <th>Status</th>
              <th>Last Heartbeat</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {boards.map(b => {
              const isActive = b.is_active && (now - new Date(b.last_heartbeat).getTime() < 120000);
              return (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.mac_address}</td>
                  <td>
                    <span className={`badge ${isActive ? 'badge-online' : 'badge-offline'}`}>
                      {isActive ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td>{new Date(b.last_heartbeat).toLocaleString()}</td>
                  <td>{b.firmware_version || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
