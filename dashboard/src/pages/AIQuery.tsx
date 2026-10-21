import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { AIChartSpec, AIStatus, AIToolCall, Board, ProtocolSpec } from '../api';
import PageHeader from '../components/PageHeader';
import { useTranslation } from '../i18n';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AIToolCall[];
  chart?: AIChartSpec;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

const AI_CHART_STORAGE_KEY = 'sentinel.ai.chart';

function formatAITime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function AIQueryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedProto, setSelectedProto] = useState('');
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.boards.list().then(setBoards).catch(console.error);
    api.protocols.list().then(setProtocols).catch(console.error);
    api.ai.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const configured = status?.configured !== false;

  const send = async (text?: string) => {
    const question = (text ?? query).trim();
    if (!question || !selectedBoard || loading || !configured) return;

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setQuery('');
    setLoading(true);

    try {
      const result = await api.ai.query({
        board_id: selectedBoard,
        protocol_id: selectedProto || undefined,
        query: question,
        history,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        toolCalls: result.tool_calls,
        chart: result.chart ?? undefined,
        usage: result.usage ?? undefined,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('ai.errorPrefix', { message: String(e) }),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const openChart = (chart: AIChartSpec) => {
    try {
      sessionStorage.setItem(AI_CHART_STORAGE_KEY, JSON.stringify(chart));
    } catch {
      /* ignore */
    }
    navigate('/viz');
  };

  return (
    <div className="page">
      <PageHeader title={t('ai.title')} subtitle={t('ai.subtitle')} />

      {status && (
        <div className={`card ai-status-card${configured ? '' : ' ai-status-disabled'}`}>
          {configured ? (
            <span className="ai-status-pill">
              {t('ai.provider')}: <strong>{status.provider}</strong>
              {status.model ? <> · <code>{status.model}</code></> : null}
              {typeof status.tools === 'number' ? <> · {t('ai.toolCount', { count: status.tools })}</> : null}
            </span>
          ) : (
            <div>
              <strong>{t('ai.notConfiguredTitle')}</strong>
              <p className="muted">{t('ai.notConfigured')}</p>
              <code className="ai-env-hint">AI_PROVIDER=openai AI_BASE_URL=http://localhost:8000/v1 AI_MODEL=... AI_API_KEY=...</code>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="form-grid">
          <div className="form-field">
            <label>{t('common.board')}</label>
            <select value={selectedBoard} onChange={e => { setSelectedBoard(e.target.value); setMessages([]); }}>
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
            <div className="ai-empty">
              <p className="muted">{t('ai.emptyHint')}</p>
              <div className="ai-suggestions">
                <button type="button" className="btn-ghost" onClick={() => send(t('ai.suggestionFields'))} disabled={!configured}>
                  {t('ai.suggestionFields')}
                </button>
                <button type="button" className="btn-ghost" onClick={() => send(t('ai.suggestionSummary'))} disabled={!configured}>
                  {t('ai.suggestionSummary')}
                </button>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <strong>{m.role === 'user' ? t('ai.you') : t('ai.assistant')}</strong>
              <p className="ai-message-text">{m.content}</p>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <details className="ai-tool-calls">
                  <summary>{t('ai.toolsUsed', { count: m.toolCalls.length })}</summary>
                  <ul>
                    {m.toolCalls.map((call, idx) => (
                      <li key={idx}>
                        <code>{call.name}</code>
                        <span className="mono ai-tool-args">{JSON.stringify(call.arguments)}</span>
                        {call.error && <span className="ai-tool-error">{t('ai.toolError')}: {call.error}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {m.chart && (
                <div className="ai-chart-card">
                  <div>
                    <strong>{m.chart.title || t('ai.chartTitle')}</strong>
                    <p className="mono">{m.chart.fields.join(', ')}</p>
                    <p className="muted">
                      {formatAITime(m.chart.start)} ~ {formatAITime(m.chart.end)}
                    </p>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => openChart(m.chart!)}>
                    {t('ai.openInViz')}
                  </button>
                </div>
              )}
              {m.usage && m.usage.total_tokens > 0 && (
                <p className="muted ai-usage">{t('ai.usage', { tokens: m.usage.total_tokens })}</p>
              )}
            </div>
          ))}
          {loading && <div className="chat-msg assistant"><em>{t('ai.thinking')}</em></div>}
          <div ref={bottomRef} />
        </div>
        <div className="chat-input-row">
          <input
            placeholder={t('ai.inputPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            disabled={loading || !configured}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={loading || !selectedBoard || !configured}
            className="btn-primary"
          >
            {t('common.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
