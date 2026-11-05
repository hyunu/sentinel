import { useMemo, useState } from 'react';
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

export default function ProtocolDisplayEditor({ document, onChange }: ProtocolDisplayEditorProps) {
  const payload = useMemo(() => findPayloadField(document.fields ?? []), [document.fields]);
  const fids = useMemo(() => Object.keys(payload?.field.cases ?? {}), [payload]);
  const [selectedFid, setSelectedFid] = useState<string>('');
  const activeFid = selectedFid && fids.includes(selectedFid) ? selectedFid : fids[0] ?? '';

  const meta = (document._meta ?? {}) as Record<string, any>;
  const enums = (meta.enums ?? {}) as Record<string, Record<string, string>>;
  const enumNames = Object.keys(enums);
  const [enumDraftName, setEnumDraftName] = useState('');

  const fields = useMemo(() => {
    if (!payload || !activeFid) return [];
    const out: FieldEntry[] = [];
    const caseRules = payload.field.cases?.[activeFid] ?? [];
    listCaseFields(caseRules, payload.field.name, ['fields', payload.index, 'cases', activeFid], out);
    return out;
  }, [payload, activeFid]);

  const updateMeta = (nextMeta: Record<string, any>) => {
    onChange({ ...document, _meta: nextMeta });
  };

  const updateEnum = (name: string, values: Record<string, string>) => {
    updateMeta({ ...meta, enums: { ...enums, [name]: values } });
  };

  const addEnum = () => {
    const name = enumDraftName.trim();
    if (!name || enums[name]) return;
    updateEnum(name, {});
    setEnumDraftName('');
  };

  const removeEnum = (name: string) => {
    const next = { ...enums };
    delete next[name];
    updateMeta({ ...meta, enums: next });
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
        <div className="pde-inline">
          <input
            value={enumDraftName}
            onChange={e => setEnumDraftName(e.target.value)}
            placeholder="Enum 이름 (예: CommandType)"
          />
          <button type="button" className="btn-sm" onClick={addEnum} disabled={!enumDraftName.trim()}>
            추가
          </button>
        </div>
        {enumNames.length === 0 && <p className="muted">정의된 enum이 없습니다.</p>}
        {enumNames.map(name => (
          <div className="pde-enum" key={name}>
            <div className="pde-enum-head">
              <strong>{name}</strong>
              <button type="button" className="btn-ghost btn-sm" onClick={() => removeEnum(name)}>
                삭제
              </button>
            </div>
            <textarea
              key={`${name}-${JSON.stringify(enums[name] ?? {})}`}
              rows={3}
              defaultValue={JSON.stringify(enums[name] ?? {}, null, 0)}
              onBlur={e => {
                try {
                  const parsed = JSON.parse(e.target.value) as Record<string, string>;
                  if (parsed && typeof parsed === 'object') updateEnum(name, parsed);
                } catch {
                  /* ignore invalid JSON until it is fixed */
                }
              }}
              spellCheck={false}
            />
            <span className="muted">예: {'{"10":"세탁 시작","22":"헹굼"}'}</span>
          </div>
        ))}
      </div>

      <div className="pde-block">
        <h4>필드 표시 설정</h4>
        {fids.length === 0 && <p className="muted">FID Switch(payload)가 없습니다.</p>}
        {fids.length > 0 && (
          <label className="pde-inline">
            <span>FID</span>
            <select value={activeFid} onChange={e => setSelectedFid(e.target.value)}>
              {fids.map(key => (
                <option key={key} value={key}>{fidLabel(key)}</option>
              ))}
            </select>
          </label>
        )}
        {fields.length > 0 && (
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
              {fields.map(entry => (
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
        )}
      </div>
    </section>
  );
}
