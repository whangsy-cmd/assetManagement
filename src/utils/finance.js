// 자산 가치 시계열의 최대낙폭(MDD) — 셰넌 시뮬레이션/리밸런싱 리포트 공용
export function maxDrawdown(series) {
  let peak = series[0], dd = 0
  for (const v of series) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return dd
}
