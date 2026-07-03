export const TIME_PRESET_ALL = 'all' as const;

export type TimePresetId = typeof TIME_PRESET_ALL | '1d' | '3d' | '7d' | '15d' | '30d' | '3m' | '6m' | '1y';

export const TIME_PRESET_IDS: TimePresetId[] = ['1d', '3d', '7d', '15d', '30d', '3m', '6m', '1y', 'all'];

export function presetRangeStart(end: Date, presetId: TimePresetId): Date {
  switch (presetId) {
    case '1d':
      return new Date(end.getTime() - 86400000);
    case '3d':
      return new Date(end.getTime() - 3 * 86400000);
    case '7d':
      return new Date(end.getTime() - 7 * 86400000);
    case '15d':
      return new Date(end.getTime() - 15 * 86400000);
    case '30d':
      return new Date(end.getTime() - 30 * 86400000);
    case '3m': {
      const start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      return start;
    }
    case '6m': {
      const start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      return start;
    }
    case '1y': {
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      return start;
    }
    default:
      return end;
  }
}

export function isAllTimeRangeSelection(presetId: TimePresetId, customStart: string, customEnd: string): boolean {
  return presetId === TIME_PRESET_ALL && !customStart && !customEnd;
}

export function isCustomTimeRangeSelection(presetId: TimePresetId, customStart: string, customEnd: string): boolean {
  return presetId === TIME_PRESET_ALL && !!(customStart || customEnd);
}
