import { describe, expect, it } from 'vitest';
import type { VizItem } from '../api';
import {
  clampChartZoom,
  computeYAxisDomain,
  digitalLaneDomain,
  digitalLaneValue,
  isDigitalVizItem,
  parseOptionalNumber,
  usesDigitalLane,
} from './vizDashboardUtils';

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

describe('digital lanes', () => {
  const item: VizItem = {
    id: 'd1',
    label: 'valve',
    color: '#fff',
    visible: true,
    field_ref: { protocol_id: 'p1', field_name: 'aquavalve_ison' },
    chart_type: 'line',
    y_axis: { id: 'y-right', label: 'Right' },
    offset: 0,
    weight: 1,
  };

  it('detects on/off fields by protocol name', () => {
    expect(isDigitalVizItem(item)).toBe(true);
    expect(isDigitalVizItem({
      ...item,
      field_ref: { protocol_id: 'p1', field_name: 'drainmotor_getmotorcurrent' },
    })).toBe(false);
  });

  it('stacks digital values on distinct fixed lanes', () => {
    const lane0 = digitalLaneValue(1, 0, 7);
    const lane1 = digitalLaneValue(1, 1, 7);
    const lane0Off = digitalLaneValue(0, 0, 7);
    expect(lane0).toBeGreaterThan(lane1);
    expect(lane0).toBeGreaterThan(lane0Off);
    expect(lane0 - lane1).toBeGreaterThan(1);
  });

  it('reserves a band for digital lanes above analog data', () => {
    const [min, max] = digitalLaneDomain(7, 0.35);
    expect(max).toBeCloseTo(8.4);
    expect(min).toBeLessThan(0);
    expect(min).toBeCloseTo(-15.6);
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

  it('honors negative fixed bounds', () => {
    const fixed: VizItem = {
      ...item,
      y_axis: { id: 'y-left', label: 'Left', min: -10, max: 0 },
    };
    const domain = computeYAxisDomain([{ timeKey: 't1', a1: 30 }], [fixed]);
    expect(domain).toEqual([-10, 0]);
  });

  it('widens a one-sided negative max instead of inverting the axis', () => {
    const fixed: VizItem = {
      ...item,
      y_axis: { id: 'y-left', label: 'Left', max: -5 },
    };
    const domain = computeYAxisDomain([{ timeKey: 't1', a1: 100 }], [fixed]);
    expect(domain).toBeDefined();
    expect(domain![0]).toBeLessThan(domain![1]);
    expect(domain![1]).toBeGreaterThan(-5 - 10);
  });

  it('keeps inverted explicit bounds ordered', () => {
    const fixed: VizItem = {
      ...item,
      y_axis: { id: 'y-left', label: 'Left', min: 10, max: -10 },
    };
    const domain = computeYAxisDomain([{ timeKey: 't1', a1: 1 }], [fixed]);
    expect(domain).toEqual([-10, 10]);
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

describe('usesDigitalLane', () => {
  const base: VizItem = {
    id: 'd1',
    label: 'aquavalve_ison',
    color: '#fff',
    visible: true,
    field_ref: { protocol_id: 'p1', field_name: 'aquavalve_ison' },
    chart_type: 'line',
    y_axis: { id: 'y-right', label: 'Right' },
    offset: 0,
    weight: 1,
  };

  it('keeps plain on/off items on their lane', () => {
    expect(isDigitalVizItem(base)).toBe(true);
    expect(usesDigitalLane(base)).toBe(true);
  });

  it('moves on/off items onto the Y axis when bounds are explicit', () => {
    const bounded: VizItem = {
      ...base,
      y_axis: { id: 'y-right', label: 'Right', min: -10, max: 20 },
    };
    expect(usesDigitalLane(bounded)).toBe(false);
  });

  it('treats a single-sided bound as an explicit range', () => {
    const oneSided: VizItem = {
      ...base,
      y_axis: { id: 'y-right', label: 'Right', max: 0 },
    };
    expect(usesDigitalLane(oneSided)).toBe(false);
  });

  it('never routes analog items to a lane', () => {
    const analog: VizItem = { ...base, field_ref: { protocol_id: 'p1', field_name: 'washmotor_getcurrpm' } };
    expect(usesDigitalLane(analog)).toBe(false);
  });
});
