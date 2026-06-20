import { useState, useEffect } from 'react';
import { api } from '../api';
import type { ProtocolSpec, FieldSpec } from '../api';

const emptyField = (): FieldSpec => ({ name: '', offset: 0, length: 1, type: 'uint8', unit: '', endian: 'little' });

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<ProtocolSpec[]>([]);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldSpec[]>([emptyField()]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { api.protocols.list().then(setProtocols).catch(console.error); }, []);

  const save = async () => {
    if (!name) return;
    const data = { name, version, description, fields: fields.filter(f => f.name) };
    if (editingId) {
      await api.protocols.update(editingId, data);
      setEditingId(null);
    } else {
      await api.protocols.create(data);
    }
    setName('');
    setVersion('1.0');
    setDescription('');
    setFields([emptyField()]);
    setProtocols(await api.protocols.list());
  };

  const edit = (p: ProtocolSpec) => {
    setName(p.name);
    setVersion(p.version);
    setDescription(p.description || '');
    setFields(p.fields.length ? p.fields : [emptyField()]);
    setEditingId(p.id);
  };

  const remove = async (id: string) => {
    await api.protocols.delete(id);
    setProtocols(await api.protocols.list());
  };

  const updateField = (i: number, key: keyof FieldSpec, value: string | number) => {
    setFields(prev => prev.map((f, idx) => idx === i ? { ...f, [key]: value } : f));
  };

  return (
    <div className="page">
      <h1>Protocol Specifications</h1>
      <div className="card">
        <h2>{editingId ? 'Edit' : 'New'} Protocol</h2>
        <div className="form-row">
          <input placeholder="Protocol Name" value={name} onChange={e => setName(e.target.value)} />
          <input style={{ width: 80 }} placeholder="Version" value={version} onChange={e => setVersion(e.target.value)} />
        </div>
        <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        <h3>Fields</h3>
        {fields.map((f, i) => (
          <div key={i} className="field-row">
            <input placeholder="Field name" value={f.name} onChange={e => updateField(i, 'name', e.target.value)} />
            <input type="number" placeholder="Offset" value={f.offset} onChange={e => updateField(i, 'offset', parseInt(e.target.value) || 0)} style={{ width: 70 }} />
            <input type="number" placeholder="Length" value={f.length} onChange={e => updateField(i, 'length', parseInt(e.target.value) || 1)} style={{ width: 70 }} />
            <select value={f.type} onChange={e => updateField(i, 'type', e.target.value)}>
              <option value="uint8">uint8</option>
              <option value="uint16">uint16</option>
              <option value="uint32">uint32</option>
              <option value="int8">int8</option>
              <option value="int16">int16</option>
              <option value="float">float</option>
              <option value="ascii">ascii</option>
              <option value="enum">enum</option>
            </select>
            <input placeholder="Unit" value={f.unit || ''} onChange={e => updateField(i, 'unit', e.target.value)} style={{ width: 60 }} />
            {fields.length > 1 && <button className="btn-danger" onClick={() => setFields(prev => prev.filter((_, idx) => idx !== i))}>×</button>}
          </div>
        ))}
        <div className="form-row">
          <button onClick={() => setFields(prev => [...prev, emptyField()])}>+ Add Field</button>
          <button onClick={save} className="btn-primary">{editingId ? 'Update' : 'Create'}</button>
          {editingId && <button onClick={() => { setEditingId(null); setName(''); setFields([emptyField()]); }}>Cancel</button>}
        </div>
      </div>
      <div className="card">
        <h2>Protocols ({protocols.length})</h2>
        {protocols.map(p => (
          <div key={p.id} className="list-item">
            <div>
              <strong>{p.name}</strong> v{p.version}
              <p className="muted">{p.description}</p>
              <span className="muted">{p.fields.length} fields</span>
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
