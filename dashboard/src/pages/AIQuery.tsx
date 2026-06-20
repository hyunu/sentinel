import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Board, ProtocolSpec } from '../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: string;
}

export default function AIQueryPage() {
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
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e}` }]);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <h1>AI Data Query</h1>
      <div className="card">
        <div className="form-row">
          <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)}>
            <option value="">Select Board</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={selectedProto} onChange={e => setSelectedProto(e.target.value)}>
            <option value="">Protocol (context)</option>
            {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card chat-container">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <strong>{m.role === 'user' ? 'You' : 'AI'}:</strong>
            <p>{m.content}</p>
            {m.data && <pre className="muted">{m.data}</pre>}
          </div>
        ))}
        {loading && <div className="chat-msg assistant"><em>Thinking...</em></div>}
      </div>

      <div className="card">
        <div className="form-row">
          <input
            placeholder='Ask about data (e.g., "Find RPM over 3000", "Show temperature anomalies")'
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          <button onClick={send} disabled={loading || !selectedBoard} className="btn-primary">Send</button>
        </div>
      </div>
    </div>
  );
}
