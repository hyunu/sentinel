export type VizFullLoadRow = { timestamp: string; values: Record<string, number> };

export type VizFullLoadMeta = {
  total_matched: number;
  returned: number;
  downsampled: boolean;
};

/**
 * In-memory full dataset budget (~100 MiB JSON). The current 98-field
 * monitoring payload is ~3.4 KB per row, so 90k rows would be ~306 MB.
 * Loading that as one response times out on remote browsers; larger sets use
 * the overview + detail-window cache instead.
 */
export const FULL_LOAD_BYTE_BUDGET = 100 * 1024 * 1024;

/** Safety cap for point count when loading entire series into memory. */
export const FULL_LOAD_MAX_POINTS = 100_000;
/** Measured stable in-browser chart memory budget (desktop). */
export const CHART_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
/** Rough whole-range preview size. Envelope mode returns min+max per bucket,
 *  so the response is about twice this number of rows. */
export const OVERVIEW_SAMPLE_POINTS = 4_000;
/** Bucket count for the envelope preview. */
export const OVERVIEW_BUCKETS = OVERVIEW_SAMPLE_POINTS / 2;
/** Rows per partition used to decide how many partitions to refine in parallel. */
export const PROGRESSIVE_PARTITION_ROWS = 5_000;
export const PROGRESSIVE_MAX_PARTITIONS = 24;
/** Raw rows per striped request. Each row is downloaded exactly once.
 *  Larger pages reduce request overhead; the payload stays small because a
 *  query now only asks for the chart series (<= 24 fields), not every item. */
export const PROGRESSIVE_STRIPE_ROWS = 1600;
/** Concurrent requests. Browsers use at most ~6 HTTP/1.1 connections per
 *  origin; going higher just queues and measurably slows the server. */
export const FULL_LOAD_CONCURRENCY = 6;

export function estimateVizPayloadBytes(data: VizFullLoadRow[]): number {
  if (data.length === 0) return 0;
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

export function estimateFullLoadBytes(
  sample: VizFullLoadRow[],
  returned: number,
  totalMatched: number,
): number {
  if (returned <= 0 || totalMatched <= 0) return 0;
  const bytesPerPoint = estimateVizPayloadBytes(sample) / returned;
  return Math.ceil(bytesPerPoint * totalMatched);
}

export function shouldFullLoadInMemory(
  meta: VizFullLoadMeta | null | undefined,
  sample: VizFullLoadRow[],
): boolean {
  if (!meta) return false;
  if (!meta.downsampled) return false;
  if (meta.total_matched <= meta.returned) return false;
  if (meta.total_matched > FULL_LOAD_MAX_POINTS) return false;
  return estimateFullLoadBytes(sample, meta.returned, meta.total_matched) <= FULL_LOAD_BYTE_BUDGET;
}

/** Large but bounded datasets that should be loaded in time-sliced chunks. */
export function shouldChunkedFullLoad(
  meta: VizFullLoadMeta | null | undefined,
): boolean {
  if (!meta) return false;
  if (!meta.downsampled) return false;
  if (meta.total_matched <= meta.returned) return false;
  return meta.total_matched <= FULL_LOAD_MAX_POINTS;
}

export type AllRangeLoadLevel = 'ok' | 'heavy';

export type AllRangeLoadAssessment = {
  level: AllRangeLoadLevel;
  totalMatched: number;
  returned: number;
  downsampled: boolean;
  inMemoryFull: boolean;
  heavyReason?: 'points' | 'bytes';
  estimatedBytes?: number;
};

/** All(전체 기간) 조회 시 in-memory 전량 적재 가능 여부와 사용성 경고 판단. */
export function assessAllTimeRangeLoad(
  meta: VizFullLoadMeta | null | undefined,
  sample: VizFullLoadRow[],
): AllRangeLoadAssessment {
  if (!meta) {
    return {
      level: 'ok',
      totalMatched: 0,
      returned: 0,
      downsampled: false,
      inMemoryFull: false,
    };
  }

  const { total_matched: totalMatched, returned, downsampled } = meta;
  const estimatedBytes = downsampled
    ? estimateFullLoadBytes(sample, returned, totalMatched)
    : estimateVizPayloadBytes(sample);

  if (!downsampled) {
    return {
      level: 'ok',
      totalMatched,
      returned,
      downsampled,
      inMemoryFull: true,
      estimatedBytes,
    };
  }

  if (shouldFullLoadInMemory(meta, sample) || shouldChunkedFullLoad(meta)) {
    return {
      level: 'ok',
      totalMatched,
      returned,
      downsampled,
      inMemoryFull: true,
      estimatedBytes,
    };
  }

  const heavyReason: 'points' | 'bytes' = totalMatched > FULL_LOAD_MAX_POINTS
    ? 'points'
    : 'bytes';

  return {
    level: 'heavy',
    totalMatched,
    returned,
    downsampled,
    inMemoryFull: false,
    heavyReason,
    estimatedBytes,
  };
}

export function formatFullLoadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
