import { describe, expect, it } from 'vitest';
import {
  computePanTimeRange,
  computeWheelZoomTimeRange,
  filterChartPointsByTimeRange,
  isFullChartTimeRange,
  minChartZoomSpanMs,
} from './vizChartZoomTime';
import { MIN_CHART_ZOOM_SPAN_MS } from './vizChartConstants';

describe('computeWheelZoomTimeRange', () => {
  const full = { startMs: 0, endMs: 4 * 60 * 60 * 1000 };

  it('keeps the cursor time fixed while shrinking the span', () => {
    const current = { startMs: 0, endMs: 2 * 60 * 60 * 1000 };
    const focusMs = 1 * 60 * 60 * 1000;
    const next = computeWheelZoomTimeRange(
      current,
      focusMs,
      0.5,
      full.startMs,
      full.endMs,
      60_000,
    );

    expect(next.endMs - next.startMs).toBeCloseTo(1 * 60 * 60 * 1000, -2);
    const focusRatio = (focusMs - next.startMs) / (next.endMs - next.startMs);
    expect(focusRatio).toBeCloseTo(0.5, 5);
  });

  it('scales the visible time span by the wheel factor around the focus', () => {
    const current = { startMs: 0, endMs: 3_600_000 };
    const focusMs = 1_800_000;
    const next = computeWheelZoomTimeRange(
      current,
      focusMs,
      0.8,
      0,
      7_200_000,
      60_000,
    );

    expect(next.endMs - next.startMs).toBeCloseTo(2_880_000, -2);
    expect(focusMs - next.startMs).toBeCloseTo(1_440_000, -2);
  });
});

describe('computePanTimeRange', () => {
  it('pans by the visible time span proportion', () => {
    const current = { startMs: 1_000_000, endMs: 2_000_000 };
    const next = computePanTimeRange(current, -100, 200, 0, 5_000_000);
    expect(next.startMs).toBeCloseTo(1_500_000, -2);
    expect(next.endMs).toBeCloseTo(2_500_000, -2);
  });
});

describe('isFullChartTimeRange', () => {
  it('detects full-range windows by elapsed time', () => {
    expect(isFullChartTimeRange({ startMs: 0, endMs: 10_000 }, 0, 10_000)).toBe(true);
    expect(isFullChartTimeRange({ startMs: 0, endMs: 5_000 }, 0, 10_000)).toBe(false);
  });
});

describe('minChartZoomSpanMs', () => {
  it('caps point-based minimum so 100ms-scale zoom remains reachable', () => {
    const fourHoursMs = 4 * 60 * 60 * 1000;
    expect(minChartZoomSpanMs(fourHoursMs, 8000, 10)).toBe(MIN_CHART_ZOOM_SPAN_MS);
  });
});

describe('filterChartPointsByTimeRange', () => {
  it('keeps points inside the zoom window only', () => {
    const points = [
      { timeKey: '2026-06-22T10:00:00.000Z', v: 1 },
      { timeKey: '2026-06-22T10:05:00.000Z', v: 2 },
      { timeKey: '2026-06-22T10:10:00.000Z', v: 3 },
    ];
    const filtered = filterChartPointsByTimeRange(
      points,
      '2026-06-22T10:04:00.000Z',
      '2026-06-22T10:08:00.000Z',
    );
    expect(filtered.map(p => p.v)).toEqual([2]);
  });
});
