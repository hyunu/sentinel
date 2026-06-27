import type { FieldSpec } from '../api';
import { emptyField } from './protocolPresets';

export const COMPOSITOR_TYPES = new Set([
  'struct', 'dispatch', 'tagged_repeat', 'tagged_block',
  'function_args', 'func_result',
]);

export const TAGGED_TYPES = new Set([
  'tagged_repeat', 'tagged_block', 'function_args', 'func_result',
]);

export function isCompositorType(type?: string): boolean {
  return COMPOSITOR_TYPES.has(type || '');
}

export function isTaggedType(type?: string): boolean {
  return TAGGED_TYPES.has(type || '');
}

export function isDispatchType(type?: string): boolean {
  return type === 'dispatch' || type === 'dynamic';
}

export function fieldNeedsPanel(field: FieldSpec): boolean {
  return isCompositorType(field.type || '') || isDispatchType(field.type);
}

export function defaultFieldsForType(type: string): Partial<FieldSpec> {
  switch (type) {
    case 'struct':
      return { fields: [emptyField()], length: 0 };
    case 'tagged_repeat':
    case 'function_args':
      return {
        fields: [{ flag: 'FA', name: 'variant', fields: [emptyField()] }],
        tagged_layout: 'flag_len_body',
        tagged_until: 'no_matching_flag',
        length: 0,
      };
    case 'tagged_block':
    case 'func_result':
      return {
        fields: [{ flag: 'FD', name: 'success', fields: [emptyField()] }],
        tagged_layout: 'flag_len_body',
        length: 0,
      };
    case 'dispatch':
    case 'dynamic':
      return {
        dispatch_on: '',
        dispatch_variants: { '01': [emptyField({ name: 'value', length: 2, type: 'uint16' })] },
        default_fields: [{ name: 'raw', type: 'raw', length_mode: 'remaining' }],
        length: 0,
      };
    case 'raw':
      return { length_mode: 'remaining', length: 0 };
    default:
      return {};
  }
}

export function dispatchVariantEntries(field: FieldSpec): { key: string; fields: FieldSpec[] }[] {
  const v = field.dispatch_variants || {};
  return Object.entries(v).map(([key, fields]) => ({ key, fields: fields || [] }));
}

export function setDispatchVariant(
  field: FieldSpec,
  oldKey: string,
  newKey: string,
  fields: FieldSpec[],
): Record<string, FieldSpec[]> {
  const next = { ...(field.dispatch_variants || {}) };
  if (oldKey !== newKey) delete next[oldKey];
  next[newKey.toUpperCase()] = fields;
  return next;
}

export function removeDispatchVariant(field: FieldSpec, key: string): Record<string, FieldSpec[]> {
  const next = { ...(field.dispatch_variants || {}) };
  delete next[key];
  return next;
}

export function addDispatchVariant(field: FieldSpec): Record<string, FieldSpec[]> {
  const next = { ...(field.dispatch_variants || {}) };
  let n = 1;
  while (next[n.toString(16).padStart(2, '0').toUpperCase()]) n++;
  const key = n.toString(16).padStart(2, '0').toUpperCase();
  next[key] = [emptyField({ name: 'value', length: 1, type: 'uint8' })];
  return next;
}

export function cloneFields(fields: FieldSpec[]): FieldSpec[] {
  return structuredClone(fields);
}
