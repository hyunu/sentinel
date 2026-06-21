import { useState, useEffect } from 'react';
import { api } from '../api';
import type { ProtocolSpec, FieldSpec, FrameDef, FIDPayload } from '../api';

function emptyField(): FieldSpec {
  return { name: '', offset: 0, length: 1, type: 'uint8', unit: '', endian: 'little', fields: [] };
}

function FieldRow({ field, index, onChange, onDelete, depth }: {
  field: FieldSpec;
  index: number;
  onChange: (i: number, key: string, value: unknown) => void;
  onDelete: (i: number) => void;
  depth: number;
}) {
  const hasChildren = field.type === 'function_args' || field.type === 'func_result' || (field.fields && field.fields.length > 0);

  return (
    <div>
      <div className="field-row" style={{ marginLeft: depth * 24 }}>
        <input
          placeholder="Name" value={field.name}
          onChange={e => onChange(index, 'name', e.target.value)}
          style={{ width: 100 }}
        />
        <select value={field.type} onChange={e => onChange(index, 'type', e.target.value)} style={{ width: 100 }}>
          <option value="uint8">uint8</option>
          <option value="uint16">uint16</option>
          <option value="uint32">uint32</option>
          <option value="int8">int8</option>
          <option value="int16">int16</option>
          <option value="float">float</option>
          <option value="ascii">ascii</option>
          <option value="enum">enum</option>
          <option value="hex">hex</option>
          <option value="raw">raw</option>
          <option value="dynamic">dynamic</option>
          <option value="function_args">function_args</option>
          <option value="func_result">func_result</option>
        </select>
        <input
          type="number" placeholder="Off" value={field.offset ?? 0}
          onChange={e => onChange(index, 'offset', parseInt(e.target.value) || 0)}
          style={{ width: 50 }}
        />
        <input
          type="number" placeholder="Len" value={field.length ?? 1}
          onChange={e => onChange(index, 'length', parseInt(e.target.value) || 0)}
          style={{ width: 50 }}
        />
        <select value={field.endian || 'little'} onChange={e => onChange(index, 'endian', e.target.value)} style={{ width: 70 }}>
          <option value="little">Little</option>
          <option value="big">Big</option>
        </select>
        <input
          placeholder="Flag" value={field.flag || ''}
          onChange={e => onChange(index, 'flag', e.target.value)}
          style={{ width: 50 }}
        />
        <input
          placeholder="Condition" value={field.condition || ''}
          onChange={e => onChange(index, 'condition', e.target.value)}
          style={{ width: 80 }}
        />
        <button className="btn-danger" onClick={() => onDelete(index)}>×</button>
      </div>
      {hasChildren && (
        <div style={{ borderLeft: '2px solid var(--border)', marginLeft: depth * 24 + 12, paddingLeft: 8, marginTop: 4, marginBottom: 4 }}>
          <FieldList fields={field.fields || []} depth={depth + 1} onChange={onChange} parentIndex={index} />
        </div>
      )}
    </div>
  );
}

function FieldList({ fields, depth, onChange, parentIndex }: {
  fields: FieldSpec[];
  depth: number;
  onChange: (path: number[], key: string, value: unknown) => void;
  parentIndex?: number;
}) {
  const pathFor = (i: number) => parentIndex !== undefined ? [parentIndex, i] : [i];

  const handleChange = (path: number[], key: string, value: unknown) => {
    onChange(path, key, value);
  };

  const addField = () => {
    const next = fields.length;
    handleChange([next], '$add', emptyField());
  };

  const deleteField = (idx: number) => {
    handleChange([idx], '$delete', true);
  };

  return (
    <div>
      {fields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          index={i}
          onChange={(idx, key, val) => handleChange([idx], key, val)}
          onDelete={() => deleteField(i)}
          depth={depth}
        />
      ))}
      <button onClick={addField} style={{ marginLeft: depth * 24, marginTop: 4, fontSize: 12 }}>+ Add Sub-field</button>
    </div>
  );
}

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldSpec[]>([emptyField()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [frameDef, setFrameDef] = useState<FrameDef | null>(null);
  const [fidPayloads, setFidPayloads] = useState<FIDPayload[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'frame' | 'fid'>('basic');

  useEffect(() => { api.protocols.list().then(setProtocols).catch(console.error); }, []);

  const save = async () => {
    if (!name) return;
    const data: Record<string, unknown> = { name, version, description, fields: fields.filter(f => f.name) };
    if (frameDef && frameDef.header.length > 0) data.frame_def = frameDef;
    if (fidPayloads.length > 0) data.fid_payloads = fidPayloads.filter(p => p.fid);
    if (editingId) {
      await api.protocols.update(editingId, data);
      setEditingId(null);
    } else {
      await api.protocols.create(data as Parameters<typeof api.protocols.create>[0]);
    }
    resetForm();
    setProtocols(await api.protocols.list());
  };

  const resetForm = () => {
    setName('');
    setVersion('1.0');
    setDescription('');
    setFields([emptyField()]);
    setFrameDef(null);
    setFidPayloads([]);
    setEditingId(null);
    setActiveTab('basic');
  };

  const edit = (p: ProtocolSpec) => {
    setName(p.name);
    setVersion(p.version);
    setDescription(p.description || '');
    setFields(p.fields.length ? p.fields : [emptyField()]);
    setFrameDef(p.frame_def || {
      start_byte: 'AA', end_byte: 'BB', endian: 'big', crc_position: 'before_end',
      header: [{ name: 'length', length: 2, type: 'uint16', endian: 'big' }],
      tail: [{ name: 'crc16', length: 2, type: 'uint16', endian: 'big' }],
    });
    setFidPayloads(p.fid_payloads || []);
    setEditingId(p.id);
  };

  const remove = async (id: string) => {
    await api.protocols.delete(id);
    setProtocols(await api.protocols.list());
  };

  const updateField = (i: number, key: keyof FieldSpec, value: string | number) => {
    setFields(prev => prev.map((f, idx) => idx === i ? { ...f, [key]: value } : f));
  };

  const updateFrameHeader = (i: number, key: string, value: unknown) => {
    if (!frameDef) return;
    setFrameDef({
      ...frameDef,
      header: frameDef.header.map((f, idx) => idx === i ? { ...f, [key]: value } : f),
    });
  };

  const updateFrameTail = (i: number, key: string, value: unknown) => {
    if (!frameDef) return;
    setFrameDef({
      ...frameDef,
      tail: frameDef.tail.map((f, idx) => idx === i ? { ...f, [key]: value } : f),
    });
  };

  const addFidPayload = () => {
    setFidPayloads(prev => [...prev, { fid: '', name: '', fields: [emptyField()] }]);
  };

  const updateFidPayload = (i: number, key: string, value: unknown) => {
    setFidPayloads(prev => prev.map((p, idx) => idx === i ? { ...p, [key]: value } : p));
  };

  const updateFidField = (pi: number, fi: number, key: string, value: unknown) => {
    setFidPayloads(prev => prev.map((p, idx) => {
      if (idx !== pi) return p;
      const newFields = p.fields?.map((f, j) => j === fi ? { ...f, [key]: value } : f) || [];
      return { ...p, fields: newFields };
    }));
  };

  const addFidField = (pi: number) => {
    setFidPayloads(prev => prev.map((p, idx) => {
      if (idx !== pi) return p;
      return { ...p, fields: [...(p.fields || []), emptyField()] };
    }));
  };

  const removeFidField = (pi: number, fi: number) => {
    setFidPayloads(prev => prev.map((p, idx) => {
      if (idx !== pi) return p;
      return { ...p, fields: (p.fields || []).filter((_, j) => j !== fi) };
    }));
  };

  const removeFidPayload = (i: number) => {
    setFidPayloads(prev => prev.filter((_, idx) => idx !== i));
  };

  return (
    <div className="page">
      <h1>Protocol Specifications</h1>
      <div className="card">
        <h2>{editingId ? 'Edit' : 'New'} Protocol</h2>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          <button className={activeTab === 'basic' ? 'btn-primary' : ''} onClick={() => setActiveTab('basic')}>Basic</button>
          <button className={activeTab === 'frame' ? 'btn-primary' : ''} onClick={() => setActiveTab('frame')}>Frame Def</button>
          <button className={activeTab === 'fid' ? 'btn-primary' : ''} onClick={() => setActiveTab('fid')}>FID Payloads</button>
        </div>

        {activeTab === 'basic' && (
          <>
            <div className="form-row">
              <input placeholder="Protocol Name" value={name} onChange={e => setName(e.target.value)} />
              <input style={{ width: 80 }} placeholder="Version" value={version} onChange={e => setVersion(e.target.value)} />
            </div>
            <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            <h3>Fields</h3>
            <div style={{ display: 'flex', gap: 4, fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, marginLeft: 4 }}>
              <span style={{ width: 100 }}>Name</span>
              <span style={{ width: 100 }}>Type</span>
              <span style={{ width: 50 }}>Off</span>
              <span style={{ width: 50 }}>Len</span>
              <span style={{ width: 70 }}>Endian</span>
              <span style={{ width: 50 }}>Flag</span>
              <span style={{ width: 80 }}>Cond</span>
            </div>
            {fields.map((f, i) => (
              <div key={i} className="field-row">
                <input placeholder="Name" value={f.name} onChange={e => updateField(i, 'name', e.target.value)} style={{ width: 100 }} />
                <select value={f.type} onChange={e => updateField(i, 'type', e.target.value)} style={{ width: 100 }}>
                  <option value="uint8">uint8</option>
                  <option value="uint16">uint16</option>
                  <option value="uint32">uint32</option>
                  <option value="int8">int8</option>
                  <option value="int16">int16</option>
                  <option value="float">float</option>
                  <option value="ascii">ascii</option>
                  <option value="hex">hex</option>
                  <option value="raw">raw</option>
                </select>
                <input type="number" placeholder="Off" value={f.offset ?? 0} onChange={e => updateField(i, 'offset', parseInt(e.target.value) || 0)} style={{ width: 50 }} />
                <input type="number" placeholder="Len" value={f.length ?? 1} onChange={e => updateField(i, 'length', parseInt(e.target.value) || 1)} style={{ width: 50 }} />
                <select value={f.endian || 'little'} onChange={e => updateField(i, 'endian', e.target.value)} style={{ width: 70 }}>
                  <option value="little">Little</option>
                  <option value="big">Big</option>
                </select>
                {fields.length > 1 && <button className="btn-danger" onClick={() => setFields(prev => prev.filter((_, idx) => idx !== i))}>×</button>}
              </div>
            ))}
            <div className="form-row">
              <button onClick={() => setFields(prev => [...prev, emptyField()])}>+ Add Field</button>
            </div>
          </>
        )}

        {activeTab === 'frame' && (
          <>
            <h3>Frame Definition</h3>
            <div className="form-row">
              <label style={{ color: 'var(--text-muted)' }}>Start Byte (hex):</label>
              <input value={frameDef?.start_byte || 'AA'} onChange={e => setFrameDef(prev => prev ? { ...prev, start_byte: e.target.value } : null)} style={{ width: 60 }} />
              <label style={{ color: 'var(--text-muted)' }}>End Byte (hex):</label>
              <input value={frameDef?.end_byte || 'BB'} onChange={e => setFrameDef(prev => prev ? { ...prev, end_byte: e.target.value } : null)} style={{ width: 60 }} />
              <label style={{ color: 'var(--text-muted)' }}>Endian:</label>
              <select value={frameDef?.endian || 'big'} onChange={e => setFrameDef(prev => prev ? { ...prev, endian: e.target.value } : null)}>
                <option value="big">Big</option>
                <option value="little">Little</option>
              </select>
              <label style={{ color: 'var(--text-muted)' }}>CRC:</label>
              <select value={frameDef?.crc_position || 'before_end'} onChange={e => setFrameDef(prev => prev ? { ...prev, crc_position: e.target.value } : null)}>
                <option value="before_end">Tail (before end)</option>
                <option value="none">None</option>
              </select>
            </div>
            <h4>Header Fields</h4>
            {(frameDef?.header || []).map((f, i) => (
              <div key={i} className="field-row">
                <input value={f.name} onChange={e => updateFrameHeader(i, 'name', e.target.value)} placeholder="Name" style={{ width: 100 }} />
                <select value={f.type} onChange={e => updateFrameHeader(i, 'type', e.target.value)} style={{ width: 80 }}>
                  <option value="uint8">uint8</option>
                  <option value="uint16">uint16</option>
                  <option value="uint32">uint32</option>
                </select>
                <input type="number" value={f.length ?? 1} onChange={e => updateFrameHeader(i, 'length', parseInt(e.target.value) || 1)} style={{ width: 50 }} />
                <select value={f.endian || 'big'} onChange={e => updateFrameHeader(i, 'endian', e.target.value)} style={{ width: 70 }}>
                  <option value="little">Little</option>
                  <option value="big">Big</option>
                </select>
              </div>
            ))}
            <h4>Tail Fields</h4>
            {(frameDef?.tail || []).map((f, i) => (
              <div key={i} className="field-row">
                <input value={f.name} onChange={e => updateFrameTail(i, 'name', e.target.value)} placeholder="Name" style={{ width: 100 }} />
                <select value={f.type} onChange={e => updateFrameTail(i, 'type', e.target.value)} style={{ width: 80 }}>
                  <option value="uint8">uint8</option>
                  <option value="uint16">uint16</option>
                  <option value="uint32">uint32</option>
                </select>
                <input type="number" value={f.length ?? 1} onChange={e => updateFrameTail(i, 'length', parseInt(e.target.value) || 1)} style={{ width: 50 }} />
                <select value={f.endian || 'big'} onChange={e => updateFrameTail(i, 'endian', e.target.value)} style={{ width: 70 }}>
                  <option value="little">Little</option>
                  <option value="big">Big</option>
                </select>
              </div>
            ))}
          </>
        )}

        {activeTab === 'fid' && (
          <>
            <h3>FID Payloads</h3>
            {fidPayloads.map((p, pi) => (
              <div key={pi} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div className="form-row">
                  <input value={p.fid} onChange={e => updateFidPayload(pi, 'fid', e.target.value)} placeholder="FID (e.g. CF)" style={{ width: 60 }} />
                  <input value={p.name} onChange={e => updateFidPayload(pi, 'name', e.target.value)} placeholder="Name" style={{ width: 120 }} />
                  <input value={p.description || ''} onChange={e => updateFidPayload(pi, 'description', e.target.value)} placeholder="Description" style={{ flex: 1 }} />
                  <button className="btn-danger" onClick={() => removeFidPayload(pi)}>×</button>
                </div>
                <div style={{ marginTop: 4 }}>
                  {(p.fields || []).map((f, fi) => (
                    <div key={fi} className="field-row" style={{ marginLeft: 12 }}>
                      <input value={f.name} onChange={e => updateFidField(pi, fi, 'name', e.target.value)} placeholder="Name" style={{ width: 100 }} />
                      <select value={f.type} onChange={e => updateFidField(pi, fi, 'type', e.target.value)} style={{ width: 100 }}>
                        <option value="uint8">uint8</option>
                        <option value="uint16">uint16</option>
                        <option value="uint32">uint32</option>
                        <option value="int8">int8</option>
                        <option value="int16">int16</option>
                        <option value="float">float</option>
                        <option value="ascii">ascii</option>
                        <option value="hex">hex</option>
                        <option value="raw">raw</option>
                        <option value="dynamic">dynamic</option>
                        <option value="function_args">function_args</option>
                        <option value="func_result">func_result</option>
                      </select>
                      <input type="number" value={f.length ?? 1} onChange={e => updateFidField(pi, fi, 'length', parseInt(e.target.value) || 1)} style={{ width: 50 }} />
                      <select value={f.endian || 'little'} onChange={e => updateFidField(pi, fi, 'endian', e.target.value)} style={{ width: 70 }}>
                        <option value="little">Little</option>
                        <option value="big">Big</option>
                      </select>
                      <input value={f.flag || ''} onChange={e => updateFidField(pi, fi, 'flag', e.target.value)} placeholder="Flag" style={{ width: 50 }} />
                      {fi > 0 && <button className="btn-danger" onClick={() => removeFidField(pi, fi)}>×</button>}
                    </div>
                  ))}
                  <button onClick={() => addFidField(pi)} style={{ marginLeft: 12, marginTop: 4, fontSize: 12 }}>+ Add Field</button>
                </div>
              </div>
            ))}
            <button onClick={addFidPayload}>+ Add FID</button>
          </>
        )}

        {activeTab === 'basic' && (
          <div className="form-row" style={{ marginTop: 8 }}>
            <button onClick={save} className="btn-primary">{editingId ? 'Update' : 'Create'}</button>
            {editingId && <button onClick={resetForm}>Cancel</button>}
          </div>
        )}
        {activeTab !== 'basic' && (
          <div className="form-row" style={{ marginTop: 8 }}>
            <button onClick={save} className="btn-primary">{editingId ? 'Save All' : 'Create'}</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Protocols ({protocols.length})</h2>
        <div className="form-row" style={{ marginBottom: 8 }}>
          <button onClick={async () => { await api.protocols.seedDefault(); setProtocols(await api.protocols.list()); }}>
            Seed Default Protocol
          </button>
        </div>
        {protocols.map(p => (
          <div key={p.id} className="list-item">
            <div>
              <strong>{p.name}</strong> v{p.version}
              <p className="muted">{p.description}</p>
              <span className="muted">{p.fields.length} fields{p.frame_def ? ' · frame def' : ''}{p.fid_payloads?.length ? ` · ${p.fid_payloads.length} FIDs` : ''}</span>
            </div>
            <div className="btn-group">
              <button onClick={() => edit(p)}>Edit</button>
              <button className="btn-danger" onClick={() => remove(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
