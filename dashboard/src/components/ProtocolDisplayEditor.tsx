import { useEffect, useMemo, useState } from 'react';
import type { JsonFieldRule, JsonRuleDocument } from '../types/ruleparser';

interface ProtocolDisplayEditorProps {
  document: JsonRuleDocument;
  onChange: (next: JsonRuleDocument) => void;
}

type FieldEntry = {
  path: string;
  name: string;
  type: string;
  display: string;
  enumName: string;
  indexes: (string | number)[];
};

const DISPLAY_OPTIONS = [
  { value: 'series', label: '연속' },
  { value: 'event', label: '이벤트' },
  { value: 'hidden', label: '숨김' },
];

function findPayloadField(fields: JsonFieldRule[]): { index: number; field: JsonFieldRule } | undefined {
  const index = fields.findIndex(field => field.type === 'Switch' && field.key_from === 'fid');
  return index >= 0 ? { index, field: fields[index] } : undefined;
}

function listCaseFields(
  rules: JsonFieldRule[],
  prefix: string,
  chain: (string | number)[],
  out: FieldEntry[],
) {
  rules.forEach((rule, index) => {
    const path = `${prefix}.${rule.name}`;
    out.push({
      path,
      name: rule.name,
      type: rule.type,
      display: rule.display || 'series',
      enumName: rule.enum || '',
      indexes: [...chain, index],
    });
    const base = [...chain, index];
    if (rule.item_rules?.length) {
      listCaseFields(rule.item_rules, `${path}[]`, [...base, 'item_rules'], out);
    }
    if (rule.rules?.length) {
      listCaseFields(rule.rules, path, [...base, 'rules'], out);
    }
    if (rule.default?.length) {
      listCaseFields(rule.default, path, [...base, 'default'], out);
    }
  });
}

function setFieldByIndexes(
  document: JsonRuleDocument,
  indexes: (string | number)[],
  patch: Partial<JsonFieldRule>,
): JsonRuleDocument {
  const clone = structuredClone(document);
  let current: any = { fields: clone.fields };
  for (const key of indexes) {
    current = current?.[key];
  }
  if (current && typeof current === 'object') {
    Object.assign(current, patch);
  }
  return clone;
}

function fidLabel(key: string): string {
  const numeric = Number(key);
  if (!Number.isFinite(numeric)) return key;
  return `0x${numeric.toString(16).toUpperCase().padStart(2, '0')} (${key})`;
}

function EnumRow({
  valueKey,
  label,
  onRename,
  onLabel,
  onRemove,
}: {
  valueKey: string;
  label: string;
  onRename: (oldKey: string, nextKey: string) => boolean;
  onLabel: (key: string, label: string) => void;
  onRemove: (key: string) => void;
}) {
  const [keyDraft, setKeyDraft] = useState(valueKey);
  const [labelDraft, setLabelDraft] = useState(label);

  useEffect(() => {
    setKeyDraft(valueKey);
    setLabelDraft(label);
  }, [valueKey, label]);

  return (
    <tr>
      <td>
        <input
          value={keyDraft}
          onChange={e => setKeyDraft(e.target.value)}
          onBlur={() => {
            if (keyDraft === valueKey) return;
            if (!onRename(valueKey, keyDraft)) setKeyDraft(valueKey);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setKeyDraft(valueKey);
              e.currentTarget.blur();
            }
          }}
          className="pde-input-key"
        />
      </td>
      <td>
        <input
          value={labelDraft}
          onChange={e => setLabelDraft(e.target.value)}
          onBlur={() => onLabel(valueKey, labelDraft)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </td>
      <td className="pde-cell-action">
        <button type="button" className="btn-ghost btn-sm" onClick={() => onRemove(valueKey)} title="삭제">
          ×
        </button>
      </td>
    </tr>
  );
}

export default function ProtocolDisplayEditor({ document, onChange }: ProtocolDisplayEditorProps) {
  const payload = useMemo(() => findPayloadField(document.fields ?? []), [document.fields]);
  const fids = useMemo(() => Object.keys(payload?.field.cases ?? {}), [payload]);
  const [selectedFid, setSelectedFid] = useState<string>('');
  const activeFid = selectedFid && fids.includes(selectedFid) ? selectedFid : fids[0] ?? '';

  const meta = (document._meta ?? {}) as Record<string, any>;
  const enums = (meta.enums ?? {}) as Record<string, Record<string, string>>;
  const enumNames = Object.keys(enums);

  const [selectedEnum, setSelectedEnum] = useState<string>('');
  const activeEnum = selectedEnum && enumNames.includes(selectedEnum)
    ? selectedEnum
    : enumNames[0] ?? '';
  const enumValues = enums[activeEnum] ?? {};

  const [newEnumName, setNewEnumName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [enumError, setEnumError] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');

  const fields = useMemo(() => {
    if (!payload || !activeFid) return [];
    const out: FieldEntry[] = [];
    const caseRules = payload.field.cases?.[activeFid] ?? [];
    listCaseFields(caseRules, payload.field.name, ['fields', payload.index, 'cases', activeFid], out);
    return out;
  }, [payload, activeFid]);

  const visibleFields = useMemo(() => {
    const query = fieldFilter.trim().toLowerCase();
    if (!query) return fields;
    return fields.filter(field => field.path.toLowerCase().includes(query));
  }, [fields, fieldFilter]);

  const updateMeta = (nextMeta: Record<string, any>) => {
    onChange({ ...document, _meta: nextMeta });
  };

  const updateEnum = (name: string, values: Record<string, string>) => {
    updateMeta({ ...meta, enums: { ...enums, [name]: values } });
  };

  const addEnum = () => {
    const name = newEnumName.trim();
    if (!name) {
      setEnumError('Enum 이름을 입력하세요.');
      return;
    }
    if (enums[name]) {
      setEnumError('이미 같은 이름의 Enum이 있습니다.');
      return;
    }
    updateEnum(name, {});
    setSelectedEnum(name);
    setNewEnumName('');
    setEnumError('');
  };

  const removeEnum = () => {
    if (!activeEnum) return;
    const next = { ...enums };
    delete next[activeEnum];
    updateMeta({ ...meta, enums: next });
    setSelectedEnum('');
  };

  const addEnumValue = () => {
    const key = newValue.trim();
    if (!key) {
      setEnumError('값을 입력하세요.');
      return;
    }
    if (enumValues[key] !== undefined) {
      setEnumError('이미 존재하는 값입니다.');
      return;
    }
    updateEnum(activeEnum, { ...enumValues, [key]: newLabel.trim() || key });
    setNewValue('');
    setNewLabel('');
    setEnumError('');
  };

  const renameEnumValue = (oldKey: string, nextKey: string): boolean => {
    const key = nextKey.trim();
    if (!key || key === oldKey) return key === oldKey;
    if (enumValues[key] !== undefined) {
      setEnumError('이미 존재하는 값입니다.');
      return false;
    }
    const renamed: Record<string, string> = {};
    for (const [existingKey, label] of Object.entries(enumValues)) {
      renamed[existingKey === oldKey ? key : existingKey] = label;
    }
    setEnumError('');
    updateEnum(activeEnum, renamed);
    return true;
  };

  const setEnumLabel = (key: string, label: string) => {
    updateEnum(activeEnum, { ...enumValues, [key]: label });
  };

  const removeEnumValue = (key: string) => {
    const next = { ...enumValues };
    delete next[key];
    updateEnum(activeEnum, next);
  };

  const updateField = (entry: FieldEntry, patch: Partial<JsonFieldRule>) => {
    onChange(setFieldByIndexes(document, entry.indexes, patch));
  };

  return (
    <section className="protocol-display-editor">
      <h3>표시 / 이벤트 설정</h3>
      <p className="muted">
        필드별로 연속/이벤트/숨김을 지정하고, 이벤트 값은 enum으로 해석해 차트에 표시합니다.
      </p>

      <div className="pde-block">
        <h4>Enum 정의</h4>
        <div className="pde-enum-toolbar">
          <label className="pde-inline">
            <span>Enum</span>
            <select
              value={activeEnum}
              onChange={e => setSelectedEnum(e.target.value)}
              disabled={enumNames.length === 0}
            >
              {enumNames.length === 0 && <option value="">(없음)</option>}
              {enumNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="pde-inline">
            <input
              value={newEnumName}
              onChange={e => setNewEnumName(e.target.value)}
              placeholder="새 Enum 이름"
              onKeyDown={e => { if (e.key === 'Enter') addEnum(); }}
            />
            <button type="button" className="btn-sm" onClick={addEnum}>Enum 추가</button>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={removeEnum}
            disabled={!activeEnum}
          >
            Enum 삭제
          </button>
        </div>

        {activeEnum ? (
          <>
            <table className="pde-table pde-enum-table">
              <thead>
                <tr>
                  <th>값</th>
                  <th>라벨</th>
                  <th aria-label="삭제" />
                </tr>
              </thead>
              <tbody>
                {Object.entries(enumValues).map(([key, label]) => (
                  <EnumRow
                    key={key}
                    valueKey={key}
                    label={label}
                    onRename={renameEnumValue}
                    onLabel={setEnumLabel}
                    onRemove={removeEnumValue}
                  />
                ))}
                {Object.keys(enumValues).length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">아직 값이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="pde-inline pde-enum-add">
              <input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="값 (예: 31)"
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="라벨 (예: 탈수)"
                onKeyDown={e => { if (e.key === 'Enter') addEnumValue(); }}
              />
              <button type="button" className="btn-sm" onClick={addEnumValue}>값 추가</button>
            </div>
            {enumError && <p className="pde-error">{enumError}</p>}
          </>
        ) : (
          <p className="muted">먼저 Enum을 추가하세요.</p>
        )}
      </div>

      <div className="pde-block">
        <h4>필드 표시 설정</h4>
        {fids.length === 0 && <p className="muted">FID Switch(payload)가 없습니다.</p>}
        {fids.length > 0 && (
          <div className="pde-enum-toolbar">
            <label className="pde-inline">
              <span>FID</span>
              <select value={activeFid} onChange={e => setSelectedFid(e.target.value)}>
                {fids.map(key => (
                  <option key={key} value={key}>{fidLabel(key)}</option>
                ))}
              </select>
            </label>
            <label className="pde-inline">
              <span>필드 검색</span>
              <input
                value={fieldFilter}
                onChange={e => setFieldFilter(e.target.value)}
                placeholder="필드 경로"
              />
            </label>
            <span className="muted">{visibleFields.length} / {fields.length}개</span>
          </div>
        )}
        {visibleFields.length > 0 && (
          <div className="pde-table-scroll">
            <table className="pde-table">
              <thead>
                <tr>
                  <th>필드</th>
                  <th>타입</th>
                  <th>표시</th>
                  <th>Enum</th>
                </tr>
              </thead>
              <tbody>
                {visibleFields.map(entry => (
                  <tr key={entry.indexes.join('.')}>
                    <td><code>{entry.path}</code></td>
                    <td>{entry.type}</td>
                    <td>
                      <select
                        value={entry.display}
                        onChange={e => updateField(entry, { display: e.target.value })}
                      >
                        {DISPLAY_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={entry.enumName}
                        onChange={e => updateField(entry, { enum: e.target.value || undefined })}
                      >
                        <option value="">없음</option>
                        {enumNames.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
