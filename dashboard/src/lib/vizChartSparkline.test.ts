import { describe, expect, it } from 'vitest';
import {
  buildSparklinePolyline,
  computeSparklineValueBins,
  sparklineValueScaleMax,
} from './vizChartSparkline';

describe('computeSparklineValueBins', () => {
  const itemIds = ['v'];

  it('keeps the peak value per time bin', () => {
    const data = [
      { timeKey: '2025-08-21T00:00:00.000Z', v: 0 },
      { timeKey: '2025-08-21T00:00:01.000Z', v: 24000 },
      { timeKey: '2025-08-21T00:00:02.000Z', v: 0 },
    ];
    const bins = computeSparklineValueBins(data, itemIds, 3);
    expect(Math.max(...bins)).toBe(24000);
  });
});

describe('sparklineValueScaleMax', () => {
  it('prefers the chart y-axis max when provided', () => {
    expect(sparklineValueScaleMax([100, 200], 24000)).toBe(24000);
  });
});

describe('buildSparklinePolyline', () => {
  const itemIds = ['v'];

  it('splits polylines when consecutive points exceed the session gap', () => {
    const data = [
      { timeKey: '2025-08-21T00:00:00.000Z', v: 10 },
      { timeKey: '2025-08-21T00:00:10.000Z', v: 20 },
      { timeKey: '2025-08-21T02:00:00.000Z', v: 15 },
      { timeKey: '2025-08-21T02:00:10.000Z', v: 25 },
    ];

    const segments = buildSparklinePolyline(data, itemIds, 100, 20, 30_000);
    expect(segments).toHaveLength(2);
  });

  it('keeps one segment when points are within the session gap', () => {
    const data = [
      { timeKey: '2025-08-21T00:00:00.000Z', v: 10 },
      { timeKey: '2025-08-21T00:00:10.000Z', v: 20 },
      { timeKey: '2025-08-21T00:00:20.000Z', v: 15 },
    ];

    const segments = buildSparklinePolyline(data, itemIds, 100, 20, 30_000);
    expect(segments).toHaveLength(1);
  });
});
