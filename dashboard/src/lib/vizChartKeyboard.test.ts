import { describe, expect, it } from 'vitest';
import { isEditableKeyboardTarget, resolveChartKeyboardAction } from './vizChartKeyboard';

describe('resolveChartKeyboardAction', () => {
  it('maps zoom and pan keys', () => {
    expect(resolveChartKeyboardAction('=')).toEqual({ type: 'zoom-in' });
    expect(resolveChartKeyboardAction('-')).toEqual({ type: 'zoom-out' });
    expect(resolveChartKeyboardAction('ArrowLeft')).toEqual({ type: 'pan-left' });
    expect(resolveChartKeyboardAction('Home')).toEqual({ type: 'reset-zoom' });
    expect(resolveChartKeyboardAction('x')).toBeNull();
  });
});

describe('isEditableKeyboardTarget', () => {
  it('detects form controls', () => {
    const input = document.createElement('input');
    expect(isEditableKeyboardTarget(input)).toBe(true);
    const div = document.createElement('div');
    expect(isEditableKeyboardTarget(div)).toBe(false);
  });
});
