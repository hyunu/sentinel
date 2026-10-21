export interface VizAggregationRow {
  timestamp: string;
  values: Record<string, number>;
}

export type VizAggregationMethod = 'raw' | 'avg' | 'min' | 'max';

interface BucketAccumulator {
  timestamp: string;
  sums: Record<string, number>;
  counts: Record<string, number>;
  mins: Record<string, number>;
  maxs: Record<string, number>;
}

/**
 * Aggregate raw viz rows into fixed time buckets for AI-proposed charts.
 * The offset/weight transforms are applied later in toChartPoints, and are
 * linear, so aggregating raw values here keeps the visual result consistent.
 */
export function aggregateVizRows(
  rows: VizAggregationRow[],
  aggregation: string | undefined,
  bucketSeconds: number | undefined,
): VizAggregationRow[] {
  if (aggregation !== 'avg' && aggregation !== 'min' && aggregation !== 'max') {
    return rows;
  }
  const seconds = bucketSeconds && bucketSeconds > 0 ? bucketSeconds : 60;
  const bucketMs = seconds * 1000;

  const buckets = new Map<number, BucketAccumulator>();
  for (const row of rows) {
    const time = Date.parse(row.timestamp);
    if (!Number.isFinite(time)) continue;
    const bucketStart = Math.floor(time / bucketMs) * bucketMs;
    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { timestamp: new Date(bucketStart).toISOString(), sums: {}, counts: {}, mins: {}, maxs: {} };
      buckets.set(bucketStart, bucket);
    }
    for (const [key, value] of Object.entries(row.values)) {
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      bucket.sums[key] = (bucket.sums[key] ?? 0) + value;
      bucket.counts[key] = (bucket.counts[key] ?? 0) + 1;
      bucket.mins[key] = bucket.mins[key] === undefined ? value : Math.min(bucket.mins[key], value);
      bucket.maxs[key] = bucket.maxs[key] === undefined ? value : Math.max(bucket.maxs[key], value);
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, bucket]) => {
      const values: Record<string, number> = {};
      for (const key of Object.keys(bucket.sums)) {
        if (aggregation === 'avg') {
          values[key] = bucket.sums[key] / bucket.counts[key];
        } else if (aggregation === 'min') {
          values[key] = bucket.mins[key];
        } else {
          values[key] = bucket.maxs[key];
        }
      }
      return { timestamp: bucket.timestamp, values };
    });
}
