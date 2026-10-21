import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Board, Session } from '../api';
import PageHeader from '../components/PageHeader';
import { formatDateTime } from '../utils/date';
import { useTranslation } from '../i18n';

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
            <button type="button" className="btn-primary" onClick={openCreate} disabled={!selectedBoard}>
              + {t('sessions.newSession')}
            </button>
            <button type="button" className="btn-sm" onClick={() => setAutoSplitOpen(v => !v)} disabled={!selectedBoard}>
              {t('sessions.autoSplit')}
            </button>
            <button type="button" className="btn-sm" onClick={() => reload()} disabled={!selectedBoard || loading}>
              {t('common.refresh')}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="muted sessions-error">{error}</p>}

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

      {formOpen && (
        <div className="card sessions-panel sessions-create-form">
          <div className="form-grid">
            <div className="form-field">
              <label>{t('sessions.name')}</label>
              <input
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('sessions.namePlaceholder')}
              />
            </div>
            <div className="form-field">
              <label>{t('sessions.description')}</label>
              <input
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('common.optional')}
              />
            </div>
            <div className="form-field">
              <label>{t('sessions.start')}</label>
              <input
                type="datetime-local"
                value={form.start}
                onChange={e => setForm(prev => ({ ...prev, start: e.target.value }))}
              />
            </div>
            <div className="form-field">
              <label>{t('sessions.end')}</label>
              <input
                type="datetime-local"
                value={form.end}
                onChange={e => setForm(prev => ({ ...prev, end: e.target.value }))}
              />
            </div>
          </div>
          <p className="muted sessions-form-hint">{t('sessions.assignHint')}</p>
          <div className="btn-group">
            <button type="button" className="btn-primary" onClick={create} disabled={saving || !form.name.trim()}>
              {saving ? t('common.loading') : t('common.create')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>
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
