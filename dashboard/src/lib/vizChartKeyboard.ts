export const CHART_KEYBOARD_PAN_PX = 48;

export type ChartKeyboardAction =
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'pan-left' }
  | { type: 'pan-right' }
  | { type: 'reset-zoom' }
  | null;

export function resolveChartKeyboardAction(key: string): ChartKeyboardAction {
  switch (key) {
    case '+':
    case '=':
      return { type: 'zoom-in' };
    case '-':
    case '_':
      return { type: 'zoom-out' };
    case 'ArrowLeft':
      return { type: 'pan-left' };
    case 'ArrowRight':
      return { type: 'pan-right' };
    case 'Home':
    case '0':
    case 'Escape':
      return { type: 'reset-zoom' };
    default:
      return null;
  }
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  return target.isContentEditable === true;
}
