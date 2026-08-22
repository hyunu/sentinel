export interface SpectrumTimeRange {
  startMs: number;
  endMs: number;
}

/** Map spectrum bin indices to an inclusive time range (end is exclusive bucket boundary). */
export function spectrumBinRangeToTimeRange(
  startIdx: number,
  endIdx: number,
  spectrumStartMs: number,
  spectrumEndMs: number,
  binCount: number,
): SpectrumTimeRange | null {
  if (binCount <= 0) return null;
  if (!Number.isFinite(spectrumStartMs) || !Number.isFinite(spectrumEndMs)) return null;
  if (spectrumEndMs <= spectrumStartMs) return null;

  const lo = Math.max(0, Math.min(startIdx, endIdx));
  const hi = Math.min(binCount - 1, Math.max(startIdx, endIdx));
  const span = spectrumEndMs - spectrumStartMs;
  return {
    startMs: spectrumStartMs + span * (lo / binCount),
    endMs: spectrumStartMs + span * ((hi + 1) / binCount),
  };
}
