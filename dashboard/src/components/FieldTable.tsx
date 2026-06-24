import type { FieldSpec } from '../api';
import { FIELD_TYPES, FIELD_TYPES_ADVANCED } from '../lib/protocolPresets';

type FieldTableProps = {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  mode: 'raw' | 'payload';
  showUnit?: boolean;
};

const TYPES = (mode: 'raw' | 'payload') =>
  mode === 'payload' ? FIELD_TYPES_ADVANCED : FIELD_TYPES;

export default function FieldTable({ fields, onChange, mode, showUnit }: FieldTableProps) {
  const types = TYPES(mode);

  const update = (i: number, patch: Partial<FieldSpec>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const remove = (i: number) => {
    if (fields.length <= 1) {
      onChange([{ name: '', offset: 0, length: 1, type: 'uint8', endian: 'little' }]);
      return;
    }
    onChange(fields.filter((_, idx) => idx !== i));
  };

  const add = () => onChange([...fields, { name: '', offset: 0, length: 1, type: 'uint8', endian: 'little' }]);

  return (
    <div className="field-table-wrap">
      <table className={`field-table field-table--${mode}`}>
        <colgroup>
          <col className="col-name" />
          <col className="col-type" />
          {mode === 'raw' && <col className="col-offset" />}
          <col className="col-len" />
          <col className="col-endian" />
          {showUnit && <col className="col-unit" />}
          {mode === 'payload' && <col className="col-flag" />}
          <col className="col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            {mode === 'raw' && <th>Offset</th>}
            <th>Len</th>
            <th>Endian</th>
            {showUnit && <th>Unit</th>}
            {mode === 'payload' && <th>Flag</th>}
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i}>
              <td>
                <input
                  value={f.name}
                  placeholder="field_name"
                  onChange={e => update(i, { name: e.target.value })}
                />
              </td>
              <td>
                <select value={f.type} onChange={e => update(i, { type: e.target.value })}>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              {mode === 'raw' && (
                <td>
                  <input
                    className="field-num"
                    type="number"
                    min={0}
                    value={f.offset ?? 0}
                    onChange={e => update(i, { offset: parseInt(e.target.value, 10) || 0 })}
                  />
                </td>
              )}
              <td>
                <input
                  className="field-num"
                  type="number"
                  min={0}
                  value={f.length ?? 1}
                  onChange={e => update(i, { length: parseInt(e.target.value, 10) || 1 })}
                />
              </td>
              <td>
                <select
                  value={f.endian || 'little'}
                  onChange={e => update(i, { endian: e.target.value })}
                >
                  <option value="little">LE</option>
                  <option value="big">BE</option>
                </select>
              </td>
              {showUnit && (
                <td>
                  <input
                    className="field-unit"
                    value={f.unit || ''}
                    placeholder="°C"
                    onChange={e => update(i, { unit: e.target.value })}
                  />
                </td>
              )}
              {mode === 'payload' && (
                <td>
                  <input
                    className="mono field-flag"
                    value={f.flag || ''}
                    placeholder="—"
                    onChange={e => update(i, { flag: e.target.value })}
                  />
                </td>
              )}
              <td className="col-action-cell">
                <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => remove(i)} aria-label="Remove field">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-sm field-table-add" onClick={add}>+ Add field</button>
    </div>
  );
}
