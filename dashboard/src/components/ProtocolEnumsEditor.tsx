import { useEffect, useState } from 'react';

export type ProtocolEnumMap = Record<string, Record<string, string>>;

interface ProtocolEnumsEditorProps {
  enums: ProtocolEnumMap;
  onChange: (enums: ProtocolEnumMap) => void;
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
          onBlur={() => {
            if (labelDraft !== label) onLabel(valueKey, labelDraft.trim() || valueKey);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setLabelDraft(label);
              e.currentTarget.blur();
            }
          }}
        />
      </td>
      <td>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => onRemove(valueKey)}
          aria-label={`${valueKey} 삭제`}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

export default function ProtocolEnumsEditor({ enums, onChange }: ProtocolEnumsEditorProps) {
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

  const updateEnum = (name: string, values: Record<string, string>) => {
    onChange({ ...enums, [name]: values });
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
    onChange(next);
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

  return (
    <section className="protocol-enums-editor">
      <p className="muted">
        Enum은 parse_rules와 별도로 관리되는 프로토콜 그룹입니다. 필드 규칙에서는 Enum 이름만 참조합니다.
      </p>

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
    </section>
  );
}
