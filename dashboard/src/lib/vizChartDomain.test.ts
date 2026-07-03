import { describe, expect, it } from 'vitest';
import type { VizItem } from '../api';
import { clampChartZoom, computeYAxisDomain, parseOptionalNumber } from './vizDashboardUtils';

describe('clampChartZoom', () => {
  it('clamps indices to data length', () => {
    expect(clampChartZoom(-5, 99, 10)).toEqual({ start: 0, end: 9 });
    expect(clampChartZoom(3, 1, 10)).toEqual({ start: 3, end: 3 });
  });
});

describe('parseOptionalNumber', () => {
  it('parses finite numbers and rejects empty', () => {
    expect(parseOptionalNumber('12.5')).toBe(12.5);
    expect(parseOptionalNumber('')).toBeUndefined();
    expect(parseOptionalNumber('abc')).toBeUndefined();
  });
});

describe('computeYAxisDomain', () => {
  const item: VizItem = {
    id: 'a1',
    label: 'rpm',
    color: '#fff',
    visible: true,
    field_ref: { protocol_id: 'p1', field_name: 'rpm' },
    chart_type: 'line',
    y_axis: { id: 'y-left', label: 'Left' },
    offset: 0,
    weight: 1,
  };

  it('returns padded domain from data', () => {
    const domain = computeYAxisDomain(
      [{ timeKey: 't1', a1: 100 }, { timeKey: 't2', a1: 200 }],
      [item],
    );
    expect(domain).toEqual([95, 205]);
  });

  it('honors fixed min and max', () => {
    const fixed: VizItem = {
      ...item,
      y_axis: { id: 'y-left', label: 'Left', min: 0, max: 500 },
    };
    const domain = computeYAxisDomain([{ timeKey: 't1', a1: 100 }], [fixed]);
    expect(domain).toEqual([0, 500]);
  });

  it('uses full timeline range so zoom window does not shrink domain', () => {
    const full = [
      { timeKey: 't1', a1: 0 },
      { timeKey: 't2', a1: 1000 },
    ];
    const zoomSlice = [{ timeKey: 't2', a1: 1000 }];
    const fullDomain = computeYAxisDomain(full, [item]);
    const sliceDomain = computeYAxisDomain(zoomSlice, [item]);
    expect(fullDomain).toEqual([-50, 1050]);
    expect(sliceDomain).toEqual([950, 1050]);
    expect(sliceDomain).not.toEqual(fullDomain);
  });
});
