import { describe, expect, it } from 'vitest';
import { normalizeWheelDeltaY, wheelDeltaToZoomFactor } from './vizChartInteraction';

describe('normalizeWheelDeltaY', () => {
  it('scales mouse line-mode detents to pixel-like magnitude', () => {
    const e = { deltaY: 1, deltaMode: 1 } as WheelEvent;
    expect(normalizeWheelDeltaY(e)).toBe(33);
  });
});

describe('wheelDeltaToZoomFactor', () => {
  it('returns zoom-in factor for mouse wheel up (negative delta)', () => {
    const factor = wheelDeltaToZoomFactor(-33);
    expect(factor).not.toBeNull();
    expect(factor!).toBeLessThan(1);
  });

  it('returns zoom-out factor for mouse wheel down (positive delta)', () => {
    const factor = wheelDeltaToZoomFactor(33);
    expect(factor).not.toBeNull();
    expect(factor!).toBeGreaterThan(1);
  });

  it('returns a strong zoom-in for legacy ±120px mouse detents', () => {
    const factor = wheelDeltaToZoomFactor(-120);
    expect(factor).not.toBeNull();
    expect(factor!).toBeLessThan(0.7);
  });
});
