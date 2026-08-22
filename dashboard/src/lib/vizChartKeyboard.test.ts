import { describe, expect, it } from 'vitest';
import {
  isEditableKeyboardTarget,
  resolveChartKeyboardAction,
  resolveChartKeyboardActionFromKey,
  resolveVizPageKeyboardAction,
  shouldIgnoreVizKeyboardShortcut,
} from './vizChartKeyboard';

describe('resolveChartKeyboardAction', () => {
  it('maps zoom and pan by physical code (한/영 independent)', () => {
    expect(resolveChartKeyboardAction({
      key: '=', code: 'Equal', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'zoom-in' });
    expect(resolveChartKeyboardAction({
      key: '+', code: 'Equal', altKey: false, ctrlKey: false, metaKey: false, shiftKey: true,
    })).toEqual({ type: 'zoom-in' });
    expect(resolveChartKeyboardAction({
      key: '-', code: 'Minus', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'zoom-out' });
    expect(resolveChartKeyboardAction({
      key: 'ArrowLeft', code: 'ArrowLeft', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'pan-left', fast: false });
    expect(resolveChartKeyboardAction({
      key: 'ArrowRight', code: 'ArrowRight', altKey: false, ctrlKey: false, metaKey: false, shiftKey: true,
    })).toEqual({ type: 'pan-right', fast: true });
    expect(resolveChartKeyboardAction({
      key: 'Home', code: 'Home', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'reset-zoom' });
  });

  it('maps letter keys by code even when key is a Hangul character', () => {
    expect(resolveChartKeyboardAction({
      key: 'ㄹ', code: 'KeyF', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'toggle-fullscreen' });
    expect(resolveChartKeyboardAction({
      key: 'ㅅ', code: 'KeyT', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'toggle-tooltip' });
  });

  it('ignores modified keys', () => {
    expect(resolveChartKeyboardAction({
      key: 'f', code: 'KeyF', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toBeNull();
  });

  it('legacy key-only helper still works', () => {
    expect(resolveChartKeyboardActionFromKey('=')).toEqual({ type: 'zoom-in' });
    expect(resolveChartKeyboardActionFromKey('x')).toBeNull();
  });
});

describe('resolveVizPageKeyboardAction', () => {
  it('maps Alt+R refresh and L live toggle by code', () => {
    expect(resolveVizPageKeyboardAction({
      key: 'r', code: 'KeyR', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'refresh' });
    expect(resolveVizPageKeyboardAction({
      key: 'ㅣ', code: 'KeyL', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    })).toEqual({ type: 'toggle-live' });
  });
});

describe('shouldIgnoreVizKeyboardShortcut', () => {
  it('allows IME Process key outside text fields (Korean keyboard)', () => {
    expect(shouldIgnoreVizKeyboardShortcut(document.body, false)).toBe(false);
  });

  it('blocks shortcuts while typing in inputs', () => {
    const input = document.createElement('input');
    expect(shouldIgnoreVizKeyboardShortcut(input, false)).toBe(true);
  });
});

describe('isEditableKeyboardTarget', () => {
  it('detects form controls but not buttons', () => {
    const input = document.createElement('input');
    expect(isEditableKeyboardTarget(input)).toBe(true);
    const button = document.createElement('button');
    expect(isEditableKeyboardTarget(button)).toBe(false);
    const div = document.createElement('div');
    expect(isEditableKeyboardTarget(div)).toBe(false);
  });
});
