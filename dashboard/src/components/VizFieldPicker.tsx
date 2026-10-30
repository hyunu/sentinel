import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { IconSearch } from './ChartControlIcons';

interface VizFieldPickerProps {
  fields: readonly string[];
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  clearLabel: string;
  noResultsLabel: (query: string) => string;
  onAdd: (field: string) => void;
}

const MAX_VISIBLE_OPTIONS = 100;

function matchesField(field: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = field.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function renderMatch(field: string, query: string) {
  const firstTerm = query.trim().split(/\s+/).find(Boolean);
  if (!firstTerm) return field;
  const index = field.toLowerCase().indexOf(firstTerm.toLowerCase());
  if (index < 0) return field;
  return (
    <>
      {field.slice(0, index)}
      <mark>{field.slice(index, index + firstTerm.length)}</mark>
      {field.slice(index + firstTerm.length)}
    </>
  );
}

export default function VizFieldPicker({
  fields,
  disabled = false,
  placeholder,
  ariaLabel,
  clearLabel,
  noResultsLabel,
  onAdd,
}: VizFieldPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listboxID = useId();
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const filteredFields = useMemo(
    () => fields.filter(field => matchesField(field, query)).slice(0, MAX_VISIBLE_OPTIONS),
    [fields, query],
  );
  const hasQuery = query.trim().length > 0;
  const safeActiveIndex = Math.min(
    activeIndex,
    Math.max(0, filteredFields.length - 1),
  );

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const padding = 8;
      const width = Math.min(
        Math.max(rect.width, 320),
        window.innerWidth - padding * 2,
      );
      const below = window.innerHeight - rect.bottom - padding;
      const above = rect.top - padding;
      const openUp = below < 220 && above > below;
      const available = Math.max(140, openUp ? above : below);
      const maxHeight = Math.min(300, available - 4);
      const left = Math.max(
        padding,
        Math.min(rect.left, window.innerWidth - width - padding),
      );
      setMenuPosition({
        top: openUp ? rect.top - maxHeight - 4 : rect.bottom + 4,
        left,
        width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeActiveIndex, open, filteredFields.length]);

  const choose = useCallback((field: string) => {
    onAdd(field);
    setQuery('');
    setActiveIndex(0);
    setOpen(fields.length > 1);
    inputRef.current?.focus();
  }, [fields.length, onAdd]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex(index => Math.min(index + 1, Math.max(0, filteredFields.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex(index => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      const field = filteredFields[safeActiveIndex] ?? filteredFields[0];
      if (!field) return;
      event.preventDefault();
      event.stopPropagation();
      choose(field);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`viz-field-picker${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <div className="viz-field-picker-control">
        <IconSearch className="viz-field-picker-icon" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          className="viz-field-picker-input"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxID}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filteredFields[safeActiveIndex]
              ? `${listboxID}-${safeActiveIndex}`
              : undefined
          }
          role="combobox"
          autoComplete="off"
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {hasQuery && (
          <button
            type="button"
            className="viz-field-picker-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              setQuery('');
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && !disabled && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          id={listboxID}
          className="viz-field-picker-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
          }}
        >
          {filteredFields.length === 0 ? (
            <div className="viz-field-picker-empty" role="status">
              {noResultsLabel(query)}
            </div>
          ) : (
            <>
              {filteredFields.map((field, index) => {
                const active = index === safeActiveIndex;
                return (
                  <div
                    key={field}
                    id={`${listboxID}-${index}`}
                    className={`viz-field-picker-option${active ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    title={field}
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(field)}
                  >
                    <span className="viz-field-picker-name">
                      {renderMatch(field, query)}
                    </span>
                    <span className="viz-field-picker-add" aria-hidden>+</span>
                  </div>
                );
              })}
              {fields.length > filteredFields.length && (
                <div className="viz-field-picker-count">
                  {filteredFields.length} / {fields.length}
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
