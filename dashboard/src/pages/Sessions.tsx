import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Board, Session } from '../api';
import PageHeader from '../components/PageHeader';
import SessionTimeline from '../components/SessionTimeline';
import { formatDateTime } from '../utils/date';
import { useTranslation } from '../i18n';
import type { SessionSplitRule } from '../api';

interface CreateForm {
  name: string;
  description: string;
  start: string;
  end: string;
}

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toISOString(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function emptyForm(): CreateForm {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    name: '',
    description: '',
    start: toDateTimeLocal(now),
    end: toDateTimeLocal(later),
  };
}

export default function SessionsPage() {
  const { t } = useTranslation();
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [sessionsByBoard, setSessionsByBoard] = useState<Record<string, Session[]>>({});
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [autoSplitOpen, setAutoSplitOpen] = useState(false);
  const [gapSeconds, setGapSeconds] = useState(60);
  const [autoSplitting, setAutoSplitting] = useState(false);
  const [rules, setRules] = useState<SessionSplitRule[]>([]);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitMessage, setSplitMessage] = useState('');

  const sessions = selectedBoard ? sessionsByBoard[selectedBoard] ?? [] : [];
  const loading = Boolean(selectedBoard) && sessionsByBoard[selectedBoard] === undefined;

  useEffect(() => {
    api.boards.list().then(list => {
      setBoards(list);
      if (list.length > 0) setSelectedBoard(prev => prev || list[0].id);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedBoard) return;
    let cancelled = false;
    api.sessions.list(selectedBoard)
      .then(list => {
        if (!cancelled) {
          setSessionsByBoard(prev => ({ ...prev, [selectedBoard]: list }));
        }
      })
      .catch(e => {
        console.error(e);
        if (!cancelled) {
          setError(t('sessions.loadFailed'));
          setSessionsByBoard(prev => ({ ...prev, [selectedBoard]: [] }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBoard, t]);

  const reload = async (boardId = selectedBoard) => {
    if (!boardId) return;
    try {
      const list = await api.sessions.list(boardId);
      setSessionsByBoard(prev => ({ ...prev, [boardId]: list }));
    } catch (e) {
      console.error(e);
      setError(t('sessions.loadFailed'));
    }
  };

  const selectBoard = (boardId: string) => {
    setSelectedBoard(boardId);
    setEditingId(null);
    setFormOpen(false);
    setAutoSplitOpen(false);
    setError('');
    setSplitMessage('');
  };

  useEffect(() => {
    const board = boards.find(item => item.id === selectedBoard);
    setRules(board?.session_split_rules ?? []);
  }, [selectedBoard, boards]);

  const newRuleId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  const addRule = () => {
    setRules(prev => [...prev, {
      id: newRuleId(),
      name: '',
      enabled: true,
      fid: '',
      direction: '',
      field: '',
      operator: 'eq',
      value: '',
    }]);
    setSplitMessage('');
  };

  const updateRule = (id: string, patch: Partial<SessionSplitRule>) => {
    setRules(prev => prev.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)));
    setSplitMessage('');
  };

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(rule => rule.id !== id));
    setSplitMessage('');
  };

  const saveRules = async () => {
    if (!selectedBoard || rulesSaving) return;
    setRulesSaving(true);
    setError('');
    try {
      const updated = await api.boards.update(selectedBoard, { session_split_rules: rules });
      setBoards(prev => prev.map(board => (board.id === updated.id ? updated : board)));
      setSplitMessage(t('sessions.rulesSaved'));
    } catch (e) {
      console.error(e);
      setError(t('sessions.rulesSaveFailed'));
    } finally {
      setRulesSaving(false);
    }
  };

  const runRuleSplit = async () => {
    if (!selectedBoard || splitting) return;
    if (!window.confirm(t('sessions.splitConfirm'))) return;
    setSplitting(true);
    setError('');
    setSplitMessage('');
    try {
      // Persist the current editor values first so the split uses what the
      // user sees, not the previously saved rule set.
      const updated = await api.boards.update(selectedBoard, { session_split_rules: rules });
      setBoards(prev => prev.map(board => (board.id === updated.id ? updated : board)));
      const result = await api.sessions.splitByRules(selectedBoard, true, 1);
      await reload();
      setSplitMessage(t('sessions.splitResult', {
        sessions: formatCount(result.sessions_created),
        rows: formatCount(result.rows_assigned),
      }));
    } catch (e) {
      console.error(e);
      setError(t('sessions.splitFailed'));
    } finally {
      setSplitting(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setFormOpen(true);
    setError('');
  };

  const create = async () => {
    if (!selectedBoard || !form.name.trim() || saving) return;
    const start = toISOString(form.start);
    const end = toISOString(form.end);
    if (start && end && new Date(end) <= new Date(start)) {
      setError(t('sessions.invalidRange'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.sessions.create({
        board_id: selectedBoard,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        start_time: start,
        end_time: end,
      });
      setFormOpen(false);
      await reload();
    } catch (e) {
      console.error(e);
      setError(t('sessions.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (session: Session) => {
    setEditingId(session.id);
    setEditForm({ name: session.name, description: session.description ?? '' });
    setError('');
  };

  const saveEdit = async (id: string) => {
    if (!editForm.name.trim()) return;
    try {
      await api.sessions.update(id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
      });
      setEditingId(null);
      await reload();
    } catch (e) {
      console.error(e);
      setError(t('sessions.updateFailed'));
    }
  };

  const remove = async (session: Session) => {
    if (!window.confirm(t('sessions.deleteConfirm', { name: session.name }))) return;
    try {
      await api.sessions.delete(session.id);
      await reload();
    } catch (e) {
      console.error(e);
      setError(t('sessions.deleteFailed'));
    }
  };

  const autoSplit = async () => {
    if (!selectedBoard || autoSplitting) return;
    if (gapSeconds < 1) {
      setError(t('sessions.invalidGap'));
      return;
    }
    setAutoSplitting(true);
    setError('');
    try {
      const result = await api.sessions.autoSplit(selectedBoard, 'timegap', gapSeconds);
      setAutoSplitOpen(false);
      await reload();
      if (result.sessions_created === 0) {
        setError(t('sessions.autoSplitNone'));
      }
    } catch (e) {
      console.error(e);
      setError(t('sessions.autoSplitFailed'));
    } finally {
      setAutoSplitting(false);
    }
  };

  return (
    <div className="page sessions-page">
      <PageHeader title={t('sessions.title')} subtitle={t('sessions.subtitle')} />

      <div className="card">
        <div className="form-row">
          <div className="form-field">
            <label>{t('common.board')}</label>
            <select value={selectedBoard} onChange={e => selectBoard(e.target.value)}>
              <option value="">{t('sessions.selectBoard')}</option>
              {boards.map(board => (
                <option key={board.id} value={board.id}>{board.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field sessions-actions">
            <button type="button" className="btn-primary sessions-action-btn" onClick={openCreate} disabled={!selectedBoard}>
              + {t('sessions.newSession')}
            </button>
            <button type="button" className="btn-sm sessions-action-btn" onClick={() => setAutoSplitOpen(v => !v)} disabled={!selectedBoard}>
              {t('sessions.autoSplit')}
            </button>
            <button type="button" className="btn-sm sessions-action-btn" onClick={() => reload()} disabled={!selectedBoard || loading}>
              {t('common.refresh')}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="muted sessions-error">{error}</p>}

      {selectedBoard && (
        <div className="card sessions-timeline-card">
          <div className="card-header">
            <h2>{t('sessions.timelineTitle')}</h2>
          </div>
          <SessionTimeline
            boardId={selectedBoard}
            sessions={sessions}
            onSelectRange={(start, end) => {
              setForm({
                ...emptyForm(),
                start: toDateTimeLocal(new Date(start)),
                end: toDateTimeLocal(new Date(end)),
              });
              setFormOpen(true);
              setAutoSplitOpen(false);
              setError('');
            }}
          />
          {formOpen && (
            <div className="sessions-create-form">
              <div className="sessions-form-head">
                <strong>{t('sessions.newSession')}</strong>
                <button
                  type="button"
                  className="btn-ghost btn-sm sessions-form-close"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  aria-label={t('common.close')}
                >
                  ×
                </button>
              </div>
              <div className="sessions-form-row">
                <div className="form-field sessions-form-name">
                  <label>{t('sessions.name')}</label>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder={t('sessions.namePlaceholder')}
                  />
                </div>
                <div className="form-field sessions-form-desc">
                  <label>{t('sessions.description')}</label>
                  <input
                    value={form.description}
                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={t('common.optional')}
                  />
                </div>
              </div>
              <div className="sessions-form-row">
                <div className="form-field sessions-form-time">
                  <label>{t('sessions.start')}</label>
                  <input
                    type="datetime-local"
                    value={form.start}
                    onChange={e => setForm(prev => ({ ...prev, start: e.target.value }))}
                  />
                </div>
                <div className="form-field sessions-form-time">
                  <label>{t('sessions.end')}</label>
                  <input
                    type="datetime-local"
                    value={form.end}
                    onChange={e => setForm(prev => ({ ...prev, end: e.target.value }))}
                  />
                </div>
                <p className="muted sessions-form-hint">{t('sessions.assignHint')}</p>
                <div className="sessions-form-actions">
                  <button type="button" className="btn-primary" onClick={create} disabled={saving || !form.name.trim()}>
                    {saving ? t('common.loading') : t('common.create')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedBoard && (
        <div className="card sessions-rules-card">
          <div className="card-header">
            <h2>{t('sessions.rulesTitle')}</h2>
            <div className="btn-group">
              <button type="button" className="btn-sm" onClick={addRule}>
                + {t('sessions.addRule')}
              </button>
              <button
                type="button"
                className="btn-sm"
                onClick={() => void saveRules()}
                disabled={rulesSaving}
              >
                {rulesSaving ? t('common.saving') : t('sessions.saveRules')}
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => void runRuleSplit()}
                disabled={splitting || rules.every(rule => !rule.enabled)}
              >
                {splitting ? t('common.loading') : t('sessions.runRuleSplit')}
              </button>
            </div>
          </div>
          <p className="muted sessions-rules-hint">{t('sessions.rulesHint')}</p>
          {rules.length === 0 ? (
            <p className="muted sessions-empty">{t('sessions.noRules')}</p>
          ) : (
            <div className="sessions-rules-list">
              {rules.map(rule => (
                <div className="sessions-rule-row" key={rule.id}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={e => updateRule(rule.id, { enabled: e.target.checked })}
                    aria-label={t('sessions.ruleEnabled')}
                  />
                  <input
                    className="sessions-rule-name"
                    value={rule.name}
                    placeholder={t('sessions.ruleName')}
                    onChange={e => updateRule(rule.id, { name: e.target.value })}
                  />
                  <input
                    className="mono sessions-rule-fid"
                    value={rule.fid ?? ''}
                    placeholder="0xCF"
                    onChange={e => updateRule(rule.id, { fid: e.target.value })}
                  />
                  <select
                    value={rule.direction ?? ''}
                    onChange={e => updateRule(rule.id, { direction: e.target.value as '' | 'TX' | 'RX' })}
                  >
                    <option value="">{t('common.all')}</option>
                    <option value="TX">TX</option>
                    <option value="RX">RX</option>
                  </select>
                  <input
                    className="mono sessions-rule-field"
                    value={rule.field ?? ''}
                    placeholder={t('sessions.ruleField')}
                    onChange={e => updateRule(rule.id, { field: e.target.value })}
                  />
                  <select
                    value={rule.operator ?? 'eq'}
                    onChange={e => updateRule(rule.id, { operator: e.target.value as SessionSplitRule['operator'] })}
                  >
                    <option value="eq">{t('sessions.ruleOpEq')}</option>
                    <option value="neq">{t('sessions.ruleOpNeq')}</option>
                    <option value="contains">{t('sessions.ruleOpContains')}</option>
                    <option value="exists">{t('sessions.ruleOpExists')}</option>
                    <option value="gt">{t('sessions.ruleOpGt')}</option>
                    <option value="lt">{t('sessions.ruleOpLt')}</option>
                  </select>
                  <input
                    className="sessions-rule-value"
                    value={rule.value ?? ''}
                    placeholder={t('sessions.ruleValue')}
                    onChange={e => updateRule(rule.id, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => removeRule(rule.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {splitMessage && <p className="sessions-split-message">{splitMessage}</p>}
        </div>
      )}

      {autoSplitOpen && (
        <div className="card sessions-panel">
          <div>
            <strong>{t('sessions.autoSplitTitle')}</strong>
            <p className="muted">{t('sessions.autoSplitHint')}</p>
          </div>
          <div className="sessions-panel-controls">
            <label>
              {t('sessions.gapSeconds')}
              <input
                type="number"
                min={1}
                value={gapSeconds}
                onChange={e => setGapSeconds(Number(e.target.value))}
              />
            </label>
            <button type="button" className="btn-primary" onClick={autoSplit} disabled={autoSplitting}>
              {autoSplitting ? t('common.loading') : t('sessions.runAutoSplit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAutoSplitOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card table-card">
        <div className="card-header">
          <h2>{t('sessions.listTitle')}</h2>
          <span className="count-badge">{sessions.length}</span>
        </div>
        {loading ? (
          <p className="muted sessions-empty">{t('common.loading')}</p>
        ) : sessions.length === 0 ? (
          <p className="muted sessions-empty">{t('sessions.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table sessions-table">
              <thead>
                <tr>
                  <th>{t('sessions.name')}</th>
                  <th>{t('sessions.range')}</th>
                  <th>{t('sessions.tags')}</th>
                  <th>{t('common.description')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(session => (
                  <tr key={session.id}>
                    <td>
                      {editingId === session.id ? (
                        <input
                          className="table-inline-input"
                          value={editForm.name}
                          onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        />
                      ) : (
                        <strong>{session.name}</strong>
                      )}
                    </td>
                    <td className="mono sessions-range">
                      <div>{formatDateTime(session.start_time)}</div>
                      <div className="muted">{session.end_time ? formatDateTime(session.end_time) : '—'}</div>
                    </td>
                    <td>
                      {(session.tags ?? []).length > 0
                        ? session.tags!.map(tag => <span key={tag} className="tag tag-subtle">{tag}</span>)
                        : '—'}
                    </td>
                    <td>
                      {editingId === session.id ? (
                        <input
                          className="table-inline-input"
                          value={editForm.description}
                          onChange={e => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        />
                      ) : (
                        <span className="muted">{session.description || '—'}</span>
                      )}
                    </td>
                    <td>
                      <div className="btn-group">
                        {editingId === session.id ? (
                          <>
                            <button type="button" className="btn-primary btn-sm" onClick={() => saveEdit(session.id)}>
                              {t('common.save')}
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn-sm" onClick={() => startEdit(session)}>
                              {t('common.edit')}
                            </button>
                            <button type="button" className="btn-danger btn-sm" onClick={() => remove(session)}>
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
