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
/** Rough whole-range sample size. Kept below the detailed chunk size so the
 *  first phase stays fast while preserving peaks and start/end of the range. */
export const OVERVIEW_SAMPLE_POINTS = 4_000;
/** Time-sliced full-load chunk size. Keep each response comfortably below the single-response budget. */
export const FULL_LOAD_CHUNK_ROWS = 4_000;
/** Concurrent chunk requests. Each chunk is ~14 MB, so keep the fan-out small. */
export const FULL_LOAD_CONCURRENCY = 3;

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
