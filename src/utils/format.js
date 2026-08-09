// 금액 축약 표시 (억/만 단위)
export function fmt(n) {
  if (!n && n !== 0) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return Math.round(n).toLocaleString()
}

export function sgn(v) { return v >= 0 ? '+' : '' }
export function pc(v) { return v >= 0 ? 'pos' : 'neg' }
