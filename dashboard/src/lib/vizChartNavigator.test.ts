import { describe, expect, it } from 'vitest';
import {
  centerNavigatorWindowAtRatio,
  computeNavigatorRangePercent,
  navigatorIndexFromTrackRatio,
  shiftNavigatorWindowByTrackDelta,
} from './vizChartNavigator';

const chartData = [
  { timeKey: '2025-08-21T00:00:00.000Z' },
  { timeKey: '2025-08-21T01:00:00.000Z' },
  { timeKey: '2025-08-21T03:00:00.000Z' },
  { timeKey: '2025-08-21T04:00:00.000Z' },
];

describe('computeNavigatorRangePercent', () => {
  it('uses time span even when overview is downsampled', () => {
    const { leftPct, widthPct } = computeNavigatorRangePercent(
      { start: 1, end: 2 },
      chartData,
      43000,
      8000,
    );

    expect(leftPct).toBeCloseTo(25, 5);
    expect(widthPct).toBeCloseTo(50, 5);
  });
});

describe('navigatorIndexFromTrackRatio', () => {
  it('maps track ratio by time instead of index', () => {
    expect(navigatorIndexFromTrackRatio(0.7, chartData)).toBe(2);
    expect(navigatorIndexFromTrackRatio(0.5, chartData)).toBe(1);
  });
});

describe('shiftNavigatorWindowByTrackDelta', () => {
  it('shifts the window proportionally to elapsed time on the track', () => {
    const shifted = shiftNavigatorWindowByTrackDelta(chartData, 0, 0, 250, 1000);
    expect(shifted.start).toBe(1);
    expect(shifted.end).toBe(1);
  });
});

describe('centerNavigatorWindowAtRatio', () => {
  it('centers on the time-aligned focus index', () => {
    const centered = centerNavigatorWindowAtRatio(chartData, 0.5, 2);
    expect(centered.start).toBe(1);
    expect(centered.end).toBe(2);
  });
});
