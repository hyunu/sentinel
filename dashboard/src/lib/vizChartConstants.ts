/** Time gap (seconds) after which chart lines are not connected across points. */
export const VIZ_SESSION_GAP_SECONDS = 30;

export const VIZ_SESSION_GAP_MS = VIZ_SESSION_GAP_SECONDS * 1000;

/** Default uPlot line/area series stroke width (CSS pixels). */
export const CHART_SERIES_LINE_WIDTH = 1.5;

/** Finest X-axis label spacing when fully zoomed in (milliseconds). */
export const MIN_CHART_X_LABEL_INTERVAL_MS = 100;

/** Minimum visible time window — ~5 labels at 100ms spacing. */
export const MIN_CHART_ZOOM_SPAN_MS = MIN_CHART_X_LABEL_INTERVAL_MS * 5;

/** uPlot x-axis tick steps (seconds); 0.1 = 100ms. */
export const CHART_X_AXIS_INCRS_SECONDS = [
  0.1, 0.2, 0.5,
  1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800, 3600,
  3600 * 2, 3600 * 3, 3600 * 6, 3600 * 12, 3600 * 24,
] as const;
