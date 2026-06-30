import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ProtocolSpec } from '../api';
import PageHeader from '../components/PageHeader';
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
    if (!window.confirm(`"${name}" 프로토콜을 삭제할까요?`)) return;
    await api.protocols.delete(id);
    await reload();
  };

  const seedDefault = async () => {
    await api.protocols.seedDefault();
    await reload();
  };

  return (
    <div className="page protocols-page">
      <PageHeader
        title="Protocols"
        subtitle="Serial Parser parse_rules JSON으로 UART 패킷 구조를 정의합니다."
      />

      <div className="card table-card protocols-card">
        <div className="card-header">
          <h2>Saved Protocols</h2>
          <div className="btn-group">
            <button type="button" className="btn-sm" onClick={seedDefault}>Seed LCP Default</button>
            <Link to="/protocols/new" className="btn-primary btn-sm protocols-add-link">+ New Protocol</Link>
          </div>
        </div>

        {loading ? (
          <p className="muted protocols-list-empty">불러오는 중…</p>
        ) : protocols.length === 0 ? (
          <div className="protocols-list-empty">
            <p className="muted">저장된 프로토콜이 없습니다.</p>
            <Link to="/protocols/new" className="btn-primary btn-sm">첫 프로토콜 만들기</Link>
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
