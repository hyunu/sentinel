import { useState, type ReactNode } from 'react';
import type { FieldSpec } from '../api';
import { emptyField, FIELD_TYPES, FIELD_TYPES_ADVANCED } from '../lib/protocolPresets';
import {
  addDispatchVariant,
  cloneFields,
  defaultFieldsForType,
  dispatchVariantEntries,
  fieldNeedsPanel,
  isCompositorType,
  isDispatchType,
  isTaggedType,
  removeDispatchVariant,
  setDispatchVariant,
} from '../lib/fieldSchemaUtils';
import FieldTable from './FieldTable';

type FieldSchemaEditorProps = {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  mode?: 'raw' | 'payload';
  showUnit?: boolean;
  depth?: number;
  label?: string;
};

function PanelLabel({ children }: { children: ReactNode }) {
  return <p className="field-schema-panel-label">{children}</p>;
}

function TaggedVariantsEditor({
  variants,
  onChange,
  showUnit,
  depth,
  singleBlock,
}: {
  variants: FieldSpec[];
  onChange: (variants: FieldSpec[]) => void;
  showUnit?: boolean;
  depth: number;
  singleBlock?: boolean;
}) {
  const updateVariant = (i: number, patch: Partial<FieldSpec>) => {
    onChange(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };

  const removeVariant = (i: number) => {
    if (variants.length <= 1) {
      onChange([{ flag: 'FA', name: 'variant', fields: [emptyField()] }]);
      return;
    }
    onChange(variants.filter((_, idx) => idx !== i));
  };

  const addVariant = () => {
    onChange([
      ...variants,
      { flag: '', name: '', fields: [emptyField()] },
    ]);
  };

  return (
    <div className="tagged-variants">
      {variants.map((v, i) => (
        <div key={i} className="tagged-variant-card">
          <div className="tagged-variant-header">
            <input
              className="mono field-flag"
              value={v.flag || ''}
              onChange={e => updateVariant(i, { flag: e.target.value.toUpperCase() })}
              placeholder="FA"
              title="Flag (hex)"
            />
            <input
              value={v.name || ''}
              onChange={e => updateVariant(i, { name: e.target.value })}
              placeholder="variant name"
            />
            <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => removeVariant(i)} aria-label="Remove variant">×</button>
          </div>
          <FieldSchemaEditor
            fields={v.fields?.length ? v.fields : [emptyField()]}
            onChange={next => updateVariant(i, { fields: next })}
            mode="payload"
            showUnit={showUnit}
            depth={depth + 1}
            label={`Flag ${v.flag || '?'}`}
          />
        </div>
      ))}
      {!singleBlock && (
        <button type="button" className="btn-sm field-schema-add-variant" onClick={addVariant}>
          + Add flag variant
        </button>
      )}
    </div>
  );
}

function DispatchPanel({
  field,
  onChange,
  showUnit,
  depth,
}: {
  field: FieldSpec;
  onChange: (patch: Partial<FieldSpec>) => void;
  showUnit?: boolean;
  depth: number;
}) {
  const entries = dispatchVariantEntries(field);

  return (
    <div className="dispatch-panel">
      <div className="field-schema-inline-row">
        <label>
          <span className="field-schema-inline-label">dispatch_on</span>
          <input
            value={field.dispatch_on || ''}
            onChange={e => onChange({ dispatch_on: e.target.value })}
            placeholder="type_id"
          />
        </label>
      </div>
      <PanelLabel>Variants (key → fields)</PanelLabel>
      <div className="dispatch-variants">
        {entries.map(({ key, fields: variantFields }) => (
          <div key={key} className="dispatch-variant-card">
            <div className="dispatch-variant-header">
              <input
                className="mono"
                value={key}
                onChange={e => onChange({
                  dispatch_variants: setDispatchVariant(field, key, e.target.value, variantFields),
                })}
                placeholder="01"
                title="Variant key (hex)"
              />
              <button
                type="button"
                className="btn-danger btn-sm btn-icon"
                onClick={() => onChange({ dispatch_variants: removeDispatchVariant(field, key) })}
                aria-label="Remove variant"
              >
                ×
              </button>
            </div>
            <FieldSchemaEditor
              fields={variantFields.length ? variantFields : [emptyField()]}
              onChange={next => onChange({
                dispatch_variants: setDispatchVariant(field, key, key, next),
              })}
              mode="payload"
              showUnit={showUnit}
              depth={depth + 1}
              label={`Key ${key}`}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn-sm field-schema-add-variant"
          onClick={() => onChange({ dispatch_variants: addDispatchVariant(field) })}
        >
          + Add dispatch key
        </button>
      </div>
      <PanelLabel>Default (fallback)</PanelLabel>
      <FieldSchemaEditor
        fields={field.default_fields?.length ? field.default_fields : [{ name: 'raw', type: 'raw', length_mode: 'remaining' }]}
        onChange={next => onChange({ default_fields: next })}
        mode="payload"
        showUnit={showUnit}
        depth={depth + 1}
        label="default"
      />
    </div>
  );
}

function CompositorPanel({
  field,
  onChange,
  showUnit,
  depth,
}: {
  field: FieldSpec;
  onChange: (patch: Partial<FieldSpec>) => void;
  showUnit?: boolean;
  depth: number;
}) {
  if (field.type === 'struct') {
    return (
      <FieldSchemaEditor
        fields={field.fields?.length ? field.fields : [emptyField()]}
        onChange={next => onChange({ fields: next })}
        mode="payload"
        showUnit={showUnit}
        depth={depth + 1}
        label={`struct ${field.name || ''}`}
      />
    );
  }

  if (isDispatchType(field.type)) {
    return (
      <DispatchPanel field={field} onChange={onChange} showUnit={showUnit} depth={depth} />
    );
  }

  if (isTaggedType(field.type)) {
    const single = field.type === 'tagged_block' || field.type === 'func_result';
    return (
      <div className="tagged-panel">
        {!single && (
          <div className="field-schema-inline-row">
            <label>
              <span className="field-schema-inline-label">tagged_until</span>
              <select
                value={field.tagged_until || 'no_matching_flag'}
                onChange={e => onChange({ tagged_until: e.target.value })}
              >
                <option value="no_matching_flag">no_matching_flag</option>
              </select>
            </label>
          </div>
        )}
        <PanelLabel>{single ? 'Flag variants (one block)' : 'Flag variants (repeat)'}</PanelLabel>
        <TaggedVariantsEditor
          variants={field.fields?.length ? field.fields : [{ flag: 'FA', name: 'variant', fields: [emptyField()] }]}
          onChange={next => onChange({ fields: next })}
          showUnit={showUnit}
          depth={depth}
          singleBlock={single}
        />
      </div>
    );
  }

  return null;
}

export default function FieldSchemaEditor({
  fields,
  onChange,
  mode = 'payload',
  showUnit,
  depth = 0,
  label,
}: FieldSchemaEditorProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  if (mode === 'raw') {
    return <FieldTable fields={fields} onChange={onChange} mode="raw" showUnit={showUnit} />;
  }

  const types = FIELD_TYPES_ADVANCED;
  const primitiveOnly = depth === 0 ? false : true;
  const typeOptions = primitiveOnly
    ? [...FIELD_TYPES, 'struct', 'dispatch', 'tagged_repeat', 'tagged_block', 'raw']
    : types;

  const update = (i: number, patch: Partial<FieldSpec>) => {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const updateType = (i: number, newType: string) => {
    const defaults = defaultFieldsForType(newType);
    onChange(fields.map((f, idx) => (idx === i ? { ...f, type: newType, ...defaults } : f)));
    if (isCompositorType(newType) || isDispatchType(newType)) {
      setExpanded(prev => ({ ...prev, [i]: true }));
    }
  };

  const remove = (i: number) => {
    if (fields.length <= 1) {
      onChange([emptyField()]);
      return;
    }
    onChange(fields.filter((_, idx) => idx !== i));
  };

  const add = () => onChange([...fields, emptyField()]);

  const toggleExpanded = (i: number) => {
    setExpanded(prev => ({ ...prev, [i]: !prev[i] }));
  };

  const isOpen = (i: number, field: FieldSpec) => {
    if (expanded[i] !== undefined) return expanded[i];
    return depth < 1 && fieldNeedsPanel(field);
  };

  return (
    <div className={`field-schema-editor depth-${Math.min(depth, 4)}`}>
      {label && depth > 0 && (
        <div className="field-schema-nest-label">{label}</div>
      )}
      {depth === 0 && (
        <div className={`field-schema-header${showUnit ? ' has-unit' : ''}`}>
          <span />
          <span>Name</span>
          <span>Type</span>
          <span>Len</span>
          <span>Endian</span>
          {showUnit && <span>Unit</span>}
          <span>Decor</span>
          <span />
        </div>
      )}
      <div className="field-schema-list">
        {fields.map((f, i) => {
          const panel = fieldNeedsPanel(f);
          const open = panel && isOpen(i, f);
          const compositor = isCompositorType(f.type);

          return (
            <div key={i} className={`field-schema-item${open ? ' is-open' : ''}`}>
              <div className="field-schema-row">
                {panel && (
                  <button
                    type="button"
                    className="field-schema-toggle"
                    onClick={() => toggleExpanded(i)}
                    aria-expanded={open}
                    title="Structure"
                  >
                    {open ? '▾' : '▸'}
                  </button>
                )}
                {!panel && <span className="field-schema-toggle-spacer" />}
                <input
                  className="field-schema-name"
                  value={f.name}
                  placeholder="name"
                  onChange={e => update(i, { name: e.target.value })}
                />
                <select
                  className="field-schema-type"
                  value={f.type}
                  onChange={e => updateType(i, e.target.value)}
                >
                  {typeOptions.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {!compositor ? (
                  <>
                    {(f.type === 'raw' || f.type === 'dynamic') ? (
                      <select
                        className="field-schema-len-mode"
                        value={f.length_mode === 'remaining' || (f.repeat === 'until_end' && !f.length) ? 'remaining' : 'fixed'}
                        onChange={e => {
                          if (e.target.value === 'remaining') {
                            update(i, { length_mode: 'remaining', repeat: undefined, length: 0 });
                          } else {
                            update(i, { length_mode: undefined, length: f.length || 1 });
                          }
                        }}
                        title="Len mode: fixed bytes or remaining in container"
                      >
                        <option value="fixed">fixed</option>
                        <option value="remaining">remaining</option>
                      </select>
                    ) : null}
                    {f.length_mode !== 'remaining' && f.repeat !== 'until_end' ? (
                      <input
                        className="field-num field-schema-len"
                        type="number"
                        min={0}
                        value={f.length ?? (f.type === 'raw' ? 0 : 1)}
                        onChange={e => update(i, { length: parseInt(e.target.value, 10) || 0 })}
                        title="Len (bytes)"
                      />
                    ) : (
                      <span className="field-schema-na" title="Consumes rest of container">rest</span>
                    )}
                    <select
                      className="field-schema-endian"
                      value={f.endian || 'little'}
                      onChange={e => update(i, { endian: e.target.value })}
                    >
                      <option value="little">LE</option>
                      <option value="big">BE</option>
                    </select>
                  </>
                ) : (
                  <>
                    <span className="field-schema-na" title="Compositor">—</span>
                    <span className="field-schema-na">—</span>
                  </>
                )}
                {showUnit && (
                  <input
                    className="field-unit field-schema-unit"
                    value={f.unit || ''}
                    placeholder="unit"
                    onChange={e => update(i, { unit: e.target.value })}
                  />
                )}
                <input
                  className="mono field-schema-decor"
                  value={f.decoration || ''}
                  placeholder="decor"
                  onChange={e => update(i, { decoration: e.target.value })}
                />
                <button type="button" className="btn-danger btn-sm btn-icon" onClick={() => remove(i)} aria-label="Remove">×</button>
              </div>
              {open && (
                <div className="field-schema-panel">
                  <CompositorPanel
                    field={f}
                    onChange={patch => update(i, patch)}
                    showUnit={showUnit}
                    depth={depth}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="btn-sm field-schema-add" onClick={add}>+ Add field</button>
    </div>
  );
}

/** Top-level payload editor with optional LCP presets. */
export function PayloadFieldEditor({
  fields,
  onChange,
  showUnit,
  presets,
}: {
  fields: FieldSpec[];
  onChange: (fields: FieldSpec[]) => void;
  showUnit?: boolean;
  presets?: { label: string; fields: FieldSpec[] }[];
}) {
  return (
    <div className="payload-field-editor">
      {presets && presets.length > 0 && (
        <div className="field-schema-presets btn-group">
          {presets.map(p => (
            <button
              key={p.label}
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => onChange(cloneFields(p.fields))}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <FieldSchemaEditor fields={fields} onChange={onChange} mode="payload" showUnit={showUnit} depth={0} />
    </div>
  );
}
