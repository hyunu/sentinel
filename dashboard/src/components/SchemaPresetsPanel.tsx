import { useCallback, useEffect, useState } from 'react';
import { api, type FieldSpec, type FIDPayload, type FrameDef, type SchemaPreset, type SchemaPresetCategory } from '../api';
import FieldSchemaEditor, { PayloadFieldEditor } from './FieldSchemaEditor';
import FieldTable from './FieldTable';
import { cloneFields } from '../lib/fieldSchemaUtils';
import { emptyField, emptyFidPayload, LCP_FRAME } from '../lib/protocolPresets';

const CATEGORY_LABELS: Record<SchemaPresetCategory, string> = {
  payload: 'Payload fields',
  frame: 'Frame envelope',
  protocol: 'Full protocol',
};

function emptyPreset(category: SchemaPresetCategory = 'payload'): Omit<SchemaPreset, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: '',
    description: '',
    category,
    fields: category === 'payload' ? [emptyField()] : undefined,
    frame_def: category === 'frame' || category === 'protocol' ? structuredClone(LCP_FRAME) : undefined,
    fid_payloads: category === 'protocol' ? [emptyFidPayload()] : undefined,
    protocol_version: category === 'protocol' ? '1.0' : undefined,
  };
}

type SchemaPresetsPanelProps = {
  onChange?: () => void;
};

export default function SchemaPresetsPanel({ onChange }: SchemaPresetsPanelProps) {
  const [presets, setPresets] = useState<SchemaPreset[]>([]);
  const [filter, setFilter] = useState<SchemaPresetCategory | 'all'>('all');
  const [editing, setEditing] = useState<SchemaPreset | null>(null);
  const [draft, setDraft] = useState<Omit<SchemaPreset, 'id' | 'created_at' | 'updated_at'>>(emptyPreset());
  const [isNew, setIsNew] = useState(false);

  const reload = useCallback(async () => {
    const list = await api.schemaPresets.list();
    setPresets(list);
    onChange?.();
  }, [onChange]);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  const filtered = filter === 'all' ? presets : presets.filter(p => p.category === filter);

  const startCreate = (category: SchemaPresetCategory) => {
    setIsNew(true);
    setEditing(null);
    setDraft(emptyPreset(category));
  };

  const startEdit = (preset: SchemaPreset) => {
    setIsNew(false);
    setEditing(preset);
    setDraft({
      name: preset.name,
      description: preset.description || '',
      category: preset.category,
      fields: preset.fields?.length ? structuredClone(preset.fields) : [emptyField()],
      frame_def: preset.frame_def ? structuredClone(preset.frame_def) : structuredClone(LCP_FRAME),
      fid_payloads: preset.fid_payloads?.length ? structuredClone(preset.fid_payloads) : [emptyFidPayload()],
      protocol_version: preset.protocol_version || '1.0',
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setIsNew(false);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    const body = {
      name: draft.name.trim(),
      description: draft.description,
      category: draft.category,
      fields: draft.category === 'payload' ? draft.fields : undefined,
      frame_def: draft.category === 'frame' || draft.category === 'protocol' ? draft.frame_def : undefined,
      fid_payloads: draft.category === 'protocol' ? draft.fid_payloads : undefined,
      protocol_version: draft.category === 'protocol' ? draft.protocol_version : undefined,
    };
    if (isNew) {
      await api.schemaPresets.create(body);
    } else if (editing) {
      await api.schemaPresets.update(editing.id, body);
    }
    cancelEdit();
    await reload();
  };

  const remove = async (id: string) => {
    await api.schemaPresets.delete(id);
    if (editing?.id === id) cancelEdit();
    await reload();
  };

  const updateFrame = (patch: Partial<FrameDef>) => {
    setDraft(d => ({ ...d, frame_def: { ...(d.frame_def || LCP_FRAME), ...patch } }));
  };

  const updateFidPayload = (i: number, patch: Partial<FIDPayload>) => {
    setDraft(d => ({
      ...d,
      fid_payloads: (d.fid_payloads || []).map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
  };

  return (
    <div className="card schema-presets-panel">
      <div className="card-header">
        <h2>Schema Presets</h2>
        <div className="btn-group">
          <button type="button" className="btn-sm" onClick={() => startCreate('payload')}>+ Payload</button>
          <button type="button" className="btn-sm" onClick={() => startCreate('frame')}>+ Frame</button>
          <button type="button" className="btn-sm" onClick={() => startCreate('protocol')}>+ Protocol</button>
          <button
            type="button"
            className="btn-sm"
            onClick={async () => { await api.schemaPresets.seedDefault(); await reload(); }}
          >
            Seed defaults
          </button>
        </div>
      </div>

      <p className="muted section-hint">
        재사용 스키마 템플릿입니다. 프로토콜 편집기에서 적용하거나 여기서 CRUD합니다.
      </p>

      <div className="preset-filter-tabs btn-group">
        {(['all', 'payload', 'frame', 'protocol'] as const).map(cat => (
          <button
            key={cat}
            type="button"
            className={`btn-sm ${filter === cat ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(cat)}
          >
            {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {(isNew || editing) && (
        <div className="preset-editor-card">
          <div className="form-row">
            <div className="form-field">
              <label>Name</label>
              <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>Category</label>
              <select
                value={draft.category}
                onChange={e => {
                  const cat = e.target.value as SchemaPresetCategory;
                  setDraft(emptyPreset(cat));
                  setDraft(d => ({ ...emptyPreset(cat), name: d.name, description: d.description }));
                }}
              >
                <option value="payload">Payload fields</option>
                <option value="frame">Frame envelope</option>
                <option value="protocol">Full protocol</option>
              </select>
            </div>
            {draft.category === 'protocol' && (
              <div className="form-field protocol-meta-version">
                <label>Version</label>
                <input
                  value={draft.protocol_version || '1.0'}
                  onChange={e => setDraft(d => ({ ...d, protocol_version: e.target.value }))}
                />
              </div>
            )}
          </div>
          <div className="form-field">
            <label>Description</label>
            <input
              value={draft.description || ''}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="Optional"
            />
          </div>

          {draft.category === 'payload' && (
            <FieldSchemaEditor
              fields={draft.fields?.length ? draft.fields : [emptyField()]}
              onChange={fields => setDraft(d => ({ ...d, fields }))}
              mode="payload"
              showUnit
            />
          )}

          {(draft.category === 'frame' || draft.category === 'protocol') && draft.frame_def && (
            <div className="preset-frame-editor">
              <p className="muted section-hint">Frame envelope</p>
              <div className="form-row">
                <div className="form-field">
                  <label>Start</label>
                  <input className="mono" value={draft.frame_def.start_byte} onChange={e => updateFrame({ start_byte: e.target.value })} />
                </div>
                <div className="form-field">
                  <label>End</label>
                  <input className="mono" value={draft.frame_def.end_byte} onChange={e => updateFrame({ end_byte: e.target.value })} />
                </div>
                <div className="form-field">
                  <label>Payload key</label>
                  <input
                    className="mono"
                    value={draft.frame_def.payload_key_field || 'fid'}
                    onChange={e => updateFrame({ payload_key_field: e.target.value })}
                  />
                </div>
              </div>
              <FieldTable
                fields={draft.frame_def.header || []}
                onChange={header => updateFrame({ header })}
                mode="raw"
              />
              <p className="muted" style={{ margin: '8px 0 4px', fontSize: 12 }}>Tail</p>
              <FieldTable
                fields={draft.frame_def.tail || []}
                onChange={tail => updateFrame({ tail })}
                mode="raw"
              />
            </div>
          )}

          {draft.category === 'protocol' && (
            <div className="preset-protocol-messages">
              <p className="muted section-hint">FID messages</p>
              {(draft.fid_payloads || []).map((p, pi) => (
                <div key={pi} className="fid-card">
                  <div className="fid-header">
                    <input
                      className="mono fid-hex"
                      value={p.fid}
                      onChange={e => updateFidPayload(pi, { fid: e.target.value.toUpperCase() })}
                      placeholder="CF"
                    />
                    <input
                      value={p.name}
                      onChange={e => updateFidPayload(pi, { name: e.target.value })}
                      placeholder="Message name"
                    />
                  </div>
                  <PayloadFieldEditor
                    fields={p.fields?.length ? p.fields : [emptyField()]}
                    onChange={fields => updateFidPayload(pi, { fields })}
                    showUnit
                  />
                </div>
              ))}
              <button
                type="button"
                className="btn-sm"
                onClick={() => setDraft(d => ({ ...d, fid_payloads: [...(d.fid_payloads || []), emptyFidPayload()] }))}
              >
                + Add message
              </button>
            </div>
          )}

          <div className="form-row editor-actions">
            <button type="button" className="btn-primary" onClick={save} disabled={!draft.name.trim()}>Save preset</button>
            <button type="button" className="btn-ghost" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}

      <div className="preset-list">
        {filtered.length === 0 ? (
          <p className="muted">프리셋이 없습니다. Seed defaults를 누르거나 새로 만드세요.</p>
        ) : filtered.map(p => (
          <div key={p.id} className="preset-list-item">
            <div>
              <div className="preset-list-title">
                {p.name}
                <span className="tag">{CATEGORY_LABELS[p.category]}</span>
              </div>
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

export function presetToPayloadOptions(presets: SchemaPreset[]): { label: string; fields: FieldSpec[] }[] {
  return presets
    .filter(p => p.category === 'payload' && p.fields?.length)
    .map(p => ({ label: p.name, fields: cloneFields(p.fields!) }));
}

export function applyProtocolPreset(preset: SchemaPreset): {
  name: string;
  version: string;
  description: string;
  frameDef: FrameDef;
  fidPayloads: FIDPayload[];
} {
  return {
    name: preset.name,
    version: preset.protocol_version || '1.0',
    description: preset.description || '',
    frameDef: preset.frame_def ? structuredClone(preset.frame_def) : structuredClone(LCP_FRAME),
    fidPayloads: preset.fid_payloads?.length ? structuredClone(preset.fid_payloads) : [emptyFidPayload()],
  };
}

export function applyFramePreset(preset: SchemaPreset): FrameDef {
  return preset.frame_def ? structuredClone(preset.frame_def) : structuredClone(LCP_FRAME);
}
