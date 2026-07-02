export type VizFullLoadRow = { timestamp: string; values: Record<string, number> };

export type VizFullLoadMeta = {
  total_matched: number;
  returned: number;
  downsampled: boolean;
};

/** In-memory full dataset budget (~100 MiB JSON). */
export const FULL_LOAD_BYTE_BUDGET = 100 * 1024 * 1024;

/** Safety cap for point count when loading entire series into memory. */
export const FULL_LOAD_MAX_POINTS = 500_000;

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

export function formatFullLoadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
