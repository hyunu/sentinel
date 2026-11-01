import { describe, expect, it } from 'vitest';
import {
  computeYAxisPanDomain,
  computeYAxisZoomDomain,
  isYAxisDomainZoomed,
  yAxisDragZoomFactor,
} from './vizChartYAxis';

describe('yAxisDragZoomFactor', () => {
  it('zooms in when dragging up and out when dragging down', () => {
    expect(yAxisDragZoomFactor(0)).toBe(1);
    expect(yAxisDragZoomFactor(-50)).toBeLessThan(1);
    expect(yAxisDragZoomFactor(50)).toBeGreaterThan(1);
  });

  it('clamps extreme drag distances', () => {
    expect(yAxisDragZoomFactor(-100000)).toBeGreaterThanOrEqual(0.02);
    expect(yAxisDragZoomFactor(100000)).toBeLessThanOrEqual(50);
  });
});

describe('computeYAxisZoomDomain', () => {
  it('keeps the pointer value anchored while zooming in', () => {
    const base: [number, number] = [0, 100];
    const next = computeYAxisZoomDomain(base, 25, 0.5);
    expect(next[0]).toBeCloseTo(12.5);
    expect(next[1]).toBeCloseTo(62.5);
    expect(next[1] - next[0]).toBeLessThan(base[1] - base[0]);
  });

  it('zooms out around the anchor', () => {
    const next = computeYAxisZoomDomain([0, 100], 50, 2);
    expect(next).toEqual([-50, 150]);
  });

  it('clamps anchors outside the base domain', () => {
    expect(computeYAxisZoomDomain([0, 100], 9999, 0.5)).toEqual([50, 100]);
    expect(computeYAxisZoomDomain([0, 100], -9999, 0.5)).toEqual([0, 50]);
  });

  it('clamps extreme zoom factors to the allowed range', () => {
    const next = computeYAxisZoomDomain([0, 100], 50, 1e-9);
    expect(next[1] - next[0]).toBeGreaterThan(0);
    // factor is clamped to MIN_Y_AXIS_ZOOM_FACTOR (0.02)
    expect(next[1] - next[0]).toBeCloseTo(2);
  });

  it('returns the base for invalid input', () => {
    expect(computeYAxisZoomDomain([0, 100], Number.NaN, 0.5)).toEqual([0, 100]);
    expect(computeYAxisZoomDomain([0, 100], 50, 0)).toEqual([0, 100]);
  });
});

describe('computeYAxisPanDomain', () => {
  it('moves the visible value range up when dragging down', () => {
    const next = computeYAxisPanDomain([0, 100], 100, 400);
    expect(next).toEqual([25, 125]);
  });

  it('moves down when dragging up', () => {
    const next = computeYAxisPanDomain([0, 100], -100, 400);
    expect(next).toEqual([-25, 75]);
  });

  it('ignores invalid geometry', () => {
    expect(computeYAxisPanDomain([0, 100], 100, 0)).toEqual([0, 100]);
    expect(computeYAxisPanDomain([0, 100], 0, 400)).toEqual([0, 100]);
  });
});

describe('isYAxisDomainZoomed', () => {
  it('detects zoomed vs base domains', () => {
    expect(isYAxisDomainZoomed([0, 100], [0, 100])).toBe(false);
    expect(isYAxisDomainZoomed([0, 50], [0, 100])).toBe(true);
    expect(isYAxisDomainZoomed([25, 125], [0, 100])).toBe(true);
  });

  it('returns false when the base is unknown', () => {
    expect(isYAxisDomainZoomed([0, 50], null)).toBe(false);
  });
});
