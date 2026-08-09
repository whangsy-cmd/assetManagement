// 종목코드 기준(계좌 합산)으로 날짜별 시계열을 만든다.
export function buildStockSeries(holdings) {
  const byCode = new Map()
  for (const h of holdings) {
    if (!byCode.has(h.code)) byCode.set(h.code, { code: h.code, name: h.name, byDate: new Map() })
    const entry = byCode.get(h.code)
    entry.name = h.name || entry.name
    const d = entry.byDate.get(h.date) || { date: h.date, qty: 0, evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    d.qty += h.qty || 0
    d.evalAmt += h.evalAmt || 0
    d.purchaseAmt += h.purchaseAmt || 0
    d.gainLoss += h.gainLoss || 0
    entry.byDate.set(h.date, d)
  }
  return byCode
}
