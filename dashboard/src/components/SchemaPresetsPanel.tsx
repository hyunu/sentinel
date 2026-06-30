import { useCallback, useEffect, useState } from 'react';
import { api, type JsonRuleDocument, type SchemaPreset } from '../api';
import ParseRulesBuilder from './ParseRulesBuilder';
import { DEFAULT_LCP_PARSE_RULES } from '../lib/protocolFormat';
import { documentToJson } from '../lib/ruleBuilderUtils';

type SchemaPresetsPanelProps = {
  onChange?: () => void;
};

function emptyPreset(): Omit<SchemaPreset, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: '',
    description: '',
    protocol_version: '1.0',
    parse_rules: structuredClone(DEFAULT_LCP_PARSE_RULES),
  };
}

export default function SchemaPresetsPanel({ onChange }: SchemaPresetsPanelProps) {
  const [presets, setPresets] = useState<SchemaPreset[]>([]);
  const [editing, setEditing] = useState<SchemaPreset | null>(null);
  const [draft, setDraft] = useState(emptyPreset());
  const [rulesText, setRulesText] = useState(JSON.stringify(DEFAULT_LCP_PARSE_RULES, null, 2));
  const [rulesError, setRulesError] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [editMode, setEditMode] = useState<'ui' | 'json'>('ui');

  const applyRules = useCallback((doc: JsonRuleDocument) => {
    if (!doc.fields?.length) {
      setRulesError('fields required');
      return;
    }
    setDraft(d => ({ ...d, parse_rules: doc }));
    setRulesText(documentToJson(doc));
    setRulesError('');
  }, []);

  const reload = useCallback(async () => {
    const list = await api.schemaPresets.list();
    setPresets(list);
    onChange?.();
  }, [onChange]);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  const syncRulesText = (text: string) => {
    setRulesText(text);
    try {
      applyRules(JSON.parse(text) as JsonRuleDocument);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const startCreate = () => {
    setIsNew(true);
    setEditing(null);
    const blank = emptyPreset();
    setDraft(blank);
    setRulesText(JSON.stringify(blank.parse_rules, null, 2));
    setRulesError('');
  };

  const startEdit = (preset: SchemaPreset) => {
    setIsNew(false);
    setEditing(preset);
    setDraft({
      name: preset.name,
      description: preset.description || '',
      protocol_version: preset.protocol_version || '1.0',
      parse_rules: structuredClone(preset.parse_rules),
    });
    setRulesText(JSON.stringify(preset.parse_rules, null, 2));
    setRulesError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setIsNew(false);
  };

  const save = async () => {
    if (!draft.name.trim() || rulesError) return;
    if (isNew) await api.schemaPresets.create(draft);
    else if (editing) await api.schemaPresets.update(editing.id, draft);
    cancelEdit();
    await reload();
  };

  const remove = async (id: string) => {
    await api.schemaPresets.delete(id);
    if (editing?.id === id) cancelEdit();
    await reload();
  };

  const editingOpen = isNew || editing;

  return (
    <div className="card schema-presets-panel">
      <div className="card-header">
        <h2>Rule Presets</h2>
        <div className="btn-group">
          <button type="button" className="btn-sm" onClick={startCreate}>+ Preset</button>
          <button type="button" className="btn-sm" onClick={() => api.schemaPresets.seedDefault().then(reload)}>
            Seed defaults
          </button>
        </div>
      </div>

      {editingOpen && (
        <div className="preset-editor">
          <div className="form-row">
            <input placeholder="Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            <input placeholder="Version" value={draft.protocol_version} onChange={e => setDraft(d => ({ ...d, protocol_version: e.target.value }))} style={{ width: 72 }} />
          </div>
          <input placeholder="Description" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
          <div className="card-header" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>규칙 편집</h2>
            <div className="segmented-control">
              <button type="button" className={editMode === 'ui' ? 'is-active' : ''} onClick={() => setEditMode('ui')}>시각 편집</button>
              <button
                type="button"
                className={editMode === 'json' ? 'is-active' : ''}
                onClick={() => {
                  setEditMode('json');
                  if (!rulesError) setRulesText(documentToJson(draft.parse_rules));
                }}
              >
                JSON
              </button>
            </div>
          </div>
          {editMode === 'ui' ? (
            <ParseRulesBuilder document={draft.parse_rules} onChange={applyRules} />
          ) : (
            <textarea className="mono" rows={12} value={rulesText} onChange={e => syncRulesText(e.target.value)} spellCheck={false} />
          )}
          {rulesError && <p className="error-text">{rulesError}</p>}
          <div className="btn-group">
            <button type="button" className="btn-primary btn-sm" disabled={!!rulesError} onClick={save}>Save</button>
            <button type="button" className="btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}

      <div className="preset-list">
        {presets.map(p => (
          <div key={p.id} className="preset-list-row">
            <div>
              <strong>{p.name}</strong>
              {p.description && <p className="muted preset-list-desc">{p.description}</p>}
            </div>
            <div className="btn-group">
              <button type="button" className="btn-sm" onClick={() => startEdit(p)}>Edit</button>
              <button type="button" className="btn-danger btn-sm" onClick={() => remove(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
