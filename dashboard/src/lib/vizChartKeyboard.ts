export const CHART_KEYBOARD_PAN_PX = 48;
export const CHART_KEYBOARD_FAST_PAN_PX = CHART_KEYBOARD_PAN_PX * 4;

export type ChartKeyboardAction =
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'pan-left'; fast?: boolean }
  | { type: 'pan-right'; fast?: boolean }
  | { type: 'reset-zoom' }
  | { type: 'cancel-interaction' }
  | { type: 'toggle-fullscreen' }
  | { type: 'toggle-tooltip' }
  | { type: 'toggle-field-values' }
  | { type: 'toggle-stats' }
  | { type: 'open-manual' };

export type VizPageKeyboardAction =
  | { type: 'refresh' }
  | { type: 'toggle-live' };

/** Minimal keyboard event surface — use physical `code` for 한/영 layout independence. */
export interface KeyboardEventLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isChartNavigationAction(action: ChartKeyboardAction): boolean {
  return action.type === 'zoom-in'
    || action.type === 'zoom-out'
    || action.type === 'pan-left'
    || action.type === 'pan-right'
    || action.type === 'reset-zoom';
}

export function shouldIgnoreVizKeyboardShortcut(
  target: EventTarget | null,
  chartManualOpen: boolean,
): boolean {
  if (chartManualOpen) return true;
  if (isTextEntryKeyboardTarget(target)) return true;
  return false;
}

/** Block shortcuts only while typing in form fields — not toolbar buttons. */
export function isTextEntryKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return isTextEntryKeyboardTarget(target);
}

function hasPrimaryModifier(e: KeyboardEventLike): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

export function resolveChartKeyboardAction(e: KeyboardEventLike): ChartKeyboardAction | null {
  if (hasPrimaryModifier(e)) return null;

  const code = e.code || keyToCodeFallback(e.key);

  switch (code) {
    case 'Equal':
    case 'NumpadAdd':
    case 'BracketRight':
      return { type: 'zoom-in' };
    case 'Minus':
    case 'NumpadSubtract':
    case 'BracketLeft':
      return { type: 'zoom-out' };
    case 'ArrowLeft':
      return { type: 'pan-left', fast: e.shiftKey };
    case 'ArrowRight':
      return { type: 'pan-right', fast: e.shiftKey };
    case 'PageUp':
      return { type: 'pan-left', fast: true };
    case 'PageDown':
      return { type: 'pan-right', fast: true };
    case 'Home':
    case 'Numpad0':
    case 'Digit0':
      return { type: 'reset-zoom' };
    case 'Escape':
      return { type: 'cancel-interaction' };
    case 'KeyF':
      return { type: 'toggle-fullscreen' };
    case 'KeyT':
      return { type: 'toggle-tooltip' };
    case 'KeyV':
      return { type: 'toggle-field-values' };
    case 'KeyS':
      return { type: 'toggle-stats' };
    case 'Slash':
      if (e.shiftKey) return { type: 'open-manual' };
      return null;
    default:
      return null;
  }
}

export function resolveVizPageKeyboardAction(e: KeyboardEventLike): VizPageKeyboardAction | null {
  if (e.code === 'KeyR' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    return { type: 'refresh' };
  }
  if (e.code === 'KeyL' && !hasPrimaryModifier(e) && !e.shiftKey) {
    return { type: 'toggle-live' };
  }
  return null;
}

/** @deprecated Use resolveChartKeyboardAction with KeyboardEventLike — kept for tests migrating from key-only API. */
export function resolveChartKeyboardActionFromKey(key: string): ChartKeyboardAction | null {
  return resolveChartKeyboardAction({
    key,
    code: keyToCodeFallback(key),
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
}

function keyToCodeFallback(key: string): string {
  switch (key) {
    case '+':
    case '=':
      return 'Equal';
    case '-':
    case '_':
      return 'Minus';
    case 'ArrowLeft':
      return 'ArrowLeft';
    case 'ArrowRight':
      return 'ArrowRight';
    case 'Home':
      return 'Home';
    case '0':
      return 'Digit0';
    case 'Escape':
      return 'Escape';
    case 'f':
    case 'F':
      return 'KeyF';
    case 't':
    case 'T':
      return 'KeyT';
    case 'v':
    case 'V':
      return 'KeyV';
    case 's':
    case 'S':
      return 'KeyS';
    default:
      return key;
  }
}
