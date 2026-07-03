import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec } from '../api';
import PageHeader from '../components/PageHeader';
import { useTranslation } from '../i18n';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: string;
}

export default function AIQueryPage() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.boards.list().then(setBoards);
    api.protocols.list().then(setProtocols);
  }, []);

  const send = async () => {
    if (!query.trim() || !selectedBoard) return;
    const userMsg: Message = { role: 'user', content: query };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setLoading(true);

    try {
      const result = await api.ai.query(selectedBoard, query);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        data: JSON.stringify(result.context, null, 2),
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('ai.errorPrefix', { message: String(e) }),
      }]);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('ai.title')}
        subtitle={t('ai.subtitle')}
      />

      <div className="card">
        <div className="form-grid">
          <div className="form-field">
            <label>{t('common.board')}</label>
            <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
              <option value="">{t('ai.selectBoard')}</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>{t('ai.protocolContext')}</label>
            <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
              <option value="">{t('common.optional')}</option>
              {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card chat-panel">
        <div className="chat-container">
          {messages.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>
              {t('ai.emptyHint')}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <strong>{m.role === 'user' ? t('ai.you') : t('ai.assistant')}</strong>
              <p>{m.content}</p>
              {m.data && <pre>{m.data}</pre>}
            </div>
          ))}
          {loading && <div className="chat-msg assistant"><em>{t('ai.thinking')}</em></div>}
        </div>
        <div className="chat-input-row">
          <input
            placeholder={t('ai.inputPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          <button type="button" onClick={send} disabled={loading || !selectedBoard} className="btn-primary">
            {t('common.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
