/**
 * Y축(값 축) 줌·팬 계산. uPlot과 무관한 순수 함수.
 * 축 드래그는 포인터 아래 값을 기준으로 확대·축소하고,
 * 플롯 세로 드래그는 현재 보이는 값 구간을 그대로 이동시킨다.
 */

export type YAxisScaleKey = 'y' | 'y2';

export type YAxisDomain = [number, number];

/** 축 드래그 1px당 줌 배율(지수). 위로 끌면 확대, 아래로 끌면 축소. */
const Y_AXIS_DRAG_ZOOM_EXP = 0.004;
/** 축 드래그 줌 배율 계산에 쓰는 최대 이동 거리(px). */
const Y_AXIS_DRAG_MAX_PX = 500;
/** 한 번의 드래그로 허용하는 최대 줌 배율. */
export const MIN_Y_AXIS_ZOOM_FACTOR = 0.02;
export const MAX_Y_AXIS_ZOOM_FACTOR = 50;
/** 줌인 시 값 구간이 0에 수렴하지 않도록 남기는 최소 비율. */
const MIN_Y_AXIS_SPAN_RATIO = 1e-4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteDomain(domain: YAxisDomain | null | undefined): domain is YAxisDomain {
  return !!domain
    && Number.isFinite(domain[0])
    && Number.isFinite(domain[1])
    && domain[1] > domain[0];
}

/** 두 구간이 실질적으로 같은지(부동소수 오차 허용). */
export function isYAxisDomainZoomed(
  current: YAxisDomain | null | undefined,
  base: YAxisDomain | null | undefined,
): boolean {
  if (!isFiniteDomain(current) || !isFiniteDomain(base)) return false;
  const span = Math.abs(base[1] - base[0]);
  const eps = Math.max(span * 1e-9, 1e-12);
  return Math.abs(current[0] - base[0]) > eps || Math.abs(current[1] - base[1]) > eps;
}

/** 세로 드래그 거리 -> 줌 배율. 위로 끌면(음수) 1보다 작아져 확대된다. */
export function yAxisDragZoomFactor(deltaPx: number): number {
  if (!Number.isFinite(deltaPx)) return 1;
  const clamped = clamp(deltaPx, -Y_AXIS_DRAG_MAX_PX, Y_AXIS_DRAG_MAX_PX);
  return clamp(
    Math.exp(clamped * Y_AXIS_DRAG_ZOOM_EXP),
    MIN_Y_AXIS_ZOOM_FACTOR,
    MAX_Y_AXIS_ZOOM_FACTOR,
  );
}

/**
 * 기준 구간을 anchor(포인터가 가리키던 값) 주위로 factor배 확대·축소한다.
 * factor < 1 = 확대, factor > 1 = 축소.
 */
export function computeYAxisZoomDomain(
  base: YAxisDomain,
  anchorValue: number,
  factor: number,
): YAxisDomain {
  if (!isFiniteDomain(base)) return base;
  if (!Number.isFinite(anchorValue) || !Number.isFinite(factor) || factor <= 0) return base;

  const [min, max] = base;
  const span = max - min;
  const anchor = clamp(anchorValue, min, max);
  const f = clamp(factor, MIN_Y_AXIS_ZOOM_FACTOR, MAX_Y_AXIS_ZOOM_FACTOR);

  let nextMin = anchor + (min - anchor) * f;
  let nextMax = anchor + (max - anchor) * f;

  const minSpan = span * MIN_Y_AXIS_SPAN_RATIO;
  if (nextMax - nextMin < minSpan) {
    const mid = (nextMin + nextMax) / 2;
    nextMin = mid - minSpan / 2;
    nextMax = mid + minSpan / 2;
  }

  return [nextMin, nextMax];
}

/**
 * 세로 팬: 플롯을 아래로 끌면(deltaPx > 0) 보이는 값 구간이 위로 이동한다.
 * (데이터가 마우스를 따라 내려오므로 화면상 값은 높아진다.)
 */
export function computeYAxisPanDomain(
  base: YAxisDomain,
  deltaPx: number,
  plotHeight: number,
): YAxisDomain {
  if (!isFiniteDomain(base) || !Number.isFinite(plotHeight) || plotHeight <= 0) return base;
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return base;
  const shift = (deltaPx / plotHeight) * (base[1] - base[0]);
  return [base[0] + shift, base[1] + shift];
}
