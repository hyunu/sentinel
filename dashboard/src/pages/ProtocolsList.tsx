import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ProtocolSpec } from '../api';
import ProtocolsSectionHeader from '../components/ProtocolsSectionHeader';
import { protocolFieldCount, protocolFormatLabel } from '../lib/protocolFormat';

export default function ProtocolsListPage() {
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setProtocols(await api.protocols.list());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete protocol "${name}"?`)) return;
    await api.protocols.delete(id);
    await reload();
  };

  const seedDefault = async () => {
    await api.protocols.seedDefault();
    await reload();
  };

  return (
    <div className="page protocols-page">
      <ProtocolsSectionHeader />

      <div className="card table-card protocols-card">
        <div className="card-header">
          <h2>Saved Protocols</h2>
          <div className="btn-group">
            <button type="button" className="btn-sm" onClick={seedDefault}>Seed LCP Default</button>
            <Link to="/protocols/new" className="btn-primary btn-sm protocols-add-link">+ New Protocol</Link>
          </div>
        </div>

        {loading ? (
          <p className="muted protocols-list-empty">Loading…</p>
        ) : protocols.length === 0 ? (
          <div className="protocols-list-empty">
            <p className="muted">No saved protocols.</p>
            <Link to="/protocols/new" className="btn-primary btn-sm">Create first protocol</Link>
          </div>
        ) : (
          <div className="protocol-list">
            {protocols.map(p => (
              <div key={p.id} className="protocol-list-row">
                <div className="protocol-list-main">
                  <div className="protocol-item-title">
                    {p.name}
                    <span className="tag">v{p.version}</span>
                  </div>
                  {p.description && <p className="protocol-item-meta">{p.description}</p>}
                  <div className="protocol-list-tags">
                    <span className="tag tag-subtle">{protocolFormatLabel(p)}</span>
                    <span className="tag tag-subtle">{protocolFieldCount(p)} top-level fields</span>
                  </div>
                </div>
                <div className="btn-group">
                  <Link to={`/protocols/${p.id}/edit`} className="btn-sm">Edit</Link>
                  <button type="button" className="btn-danger btn-sm" onClick={() => remove(p.id, p.name)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
