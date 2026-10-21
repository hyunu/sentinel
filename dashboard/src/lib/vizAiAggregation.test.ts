import { describe, expect, it } from 'vitest';
import { aggregateVizRows } from './vizAiAggregation';

const rows = [
  { timestamp: '2026-10-21T10:00:00Z', values: { a: 1, b: 10 } },
  { timestamp: '2026-10-21T10:00:30Z', values: { a: 3, b: 20 } },
  { timestamp: '2026-10-21T10:01:10Z', values: { a: 5, b: 30 } },
];

describe('aggregateVizRows', () => {
  it('returns the original rows for raw or missing aggregation', () => {
    expect(aggregateVizRows(rows, undefined, 60)).toBe(rows);
    expect(aggregateVizRows(rows, 'raw', 60)).toBe(rows);
  });

  it('averages values into one-minute buckets', () => {
    const result = aggregateVizRows(rows, 'avg', 60);
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe('2026-10-21T10:00:00.000Z');
    expect(result[0].values.a).toBe(2);
    expect(result[0].values.b).toBe(15);
    expect(result[1].values.a).toBe(5);
    expect(result[1].values.b).toBe(30);
  });

  it('uses min and max aggregation', () => {
    const min = aggregateVizRows(rows, 'min', 60);
    expect(min[0].values).toEqual({ a: 1, b: 10 });
    const max = aggregateVizRows(rows, 'max', 60);
    expect(max[0].values).toEqual({ a: 3, b: 20 });
  });

  it('respects a custom bucket size', () => {
    const result = aggregateVizRows(rows, 'avg', 30);
    expect(result).toHaveLength(3);
    expect(result[1].timestamp).toBe('2026-10-21T10:00:30.000Z');
  });

  it('ignores rows with invalid timestamps and missing numeric values', () => {
    const result = aggregateVizRows([
      { timestamp: 'not-a-date', values: { a: 1 } },
      { timestamp: '2026-10-21T10:00:00Z', values: { a: 2 } },
      { timestamp: '2026-10-21T10:00:10Z', values: { b: 7 } },
    ], 'avg', 60);
    expect(result).toHaveLength(1);
    expect(result[0].values).toEqual({ a: 2, b: 7 });
  });
});
