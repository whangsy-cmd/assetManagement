// 매수/매도 거래를 계좌+종목코드 단위로 FIFO 매칭해 청산된 라운드트립(lot) 생성 — 기대값/보유기간 분석용
// pnl은 실현손익(realizedProfits, 브로커 리포트 기준·수수료/세금 반영·항상 원화)을 우선 사용 — 종목별 손익 탭과 같은 손익 정의를 써서 숫자가 어긋나지 않게 함.
// realizedProfits에 매칭이 없으면 거래 자체의 profit 필드(선물옵션 등, 이미 원화)를 다음 우선순위로 사용.
// 그마저 없으면(드묾) 거래가격차×수량으로 근사 계산(수수료/세금 미반영, 해외종목은 usdRate로 환산) — approx:true로 표시
// realizedProfitByKey: Map(`${date}_${accountId}_${code}` -> 실현손익 합계), StockPeriodTab/AccountEvalTab과 동일 키 규칙
export function buildClosedLots(transactions, realizedProfitByKey, usdRate) {
  const groups = new Map()
  for (const t of transactions) {
    if (!t.code || !t.qty) continue
    const isBuy = /매수/.test(t.type)
    const isSell = /매도/.test(t.type)
    if (!isBuy && !isSell) continue
    const key = `${t.accountId}_${t.code}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ ...t, isBuy })
  }

  const lots = []
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const queue = [] // FIFO 매수 대기열: {date, qty, price}
    for (const r of sorted) {
      const price = r.price || (r.qty ? r.amount / r.qty : 0)
      if (r.isBuy) {
        queue.push({ date: r.date, qty: r.qty, price })
        continue
      }
      const sellQty = r.qty
      const totalRealized = realizedProfitByKey.get(`${r.date}_${r.accountId}_${r.code}`)
      const totalProfit = totalRealized !== undefined ? totalRealized : (r.profit ?? undefined)
      let remaining = sellQty
      while (remaining > 0 && queue.length) {
        const lot = queue[0]
        const matchedQty = Math.min(lot.qty, remaining)
        const holdingDays = Math.round((new Date(r.date) - new Date(lot.date)) / 86400000)
        const approx = totalProfit === undefined
        let pnl
        if (!approx) {
          pnl = totalProfit * (matchedQty / sellQty) // 매도 1건이 여러 매수 lot과 매칭되면 수량 비례 배분
        } else {
          const pnlNative = (price - lot.price) * matchedQty
          pnl = r.currency === 'USD' ? pnlNative * (usdRate || 0) : pnlNative
        }
        lots.push({
          accountId: r.accountId, code: r.code, name: r.name || '',
          entryDate: lot.date, exitDate: r.date, qty: matchedQty,
          entryPrice: lot.price, exitPrice: price, holdingDays, pnl, approx,
          pnlPct: lot.price ? (price / lot.price - 1) * 100 : 0,
        })
        lot.qty -= matchedQty
        remaining -= matchedQty
        if (lot.qty <= 0) queue.shift()
      }
    }
  }
  return lots.sort((a, b) => a.exitDate.localeCompare(b.exitDate))
}

// 청산 라운드트립(lots) 기반 기댓값(Mathematical Expectancy) = 승률×평균이익 + 패률×평균손실(음수)
export function computeExpectancy(lots) {
  if (!lots.length) return null
  const wins = lots.filter(l => l.pnl > 0)
  const losses = lots.filter(l => l.pnl < 0)
  const winRate = wins.length / lots.length
  const avgWin = wins.length ? wins.reduce((s, l) => s + l.pnl, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((s, l) => s + l.pnl, 0) / losses.length : 0
  // 손익비(Profit Factor) — 종목별 손익 탭과 동일 정의: 평균이익 ÷ |평균손실|
  const profitRatio = losses.length ? avgWin / Math.abs(avgLoss) : (wins.length ? Infinity : null)

  // 최대 연속 손실 횟수 — lots는 exitDate 오름차순(buildClosedLots 정렬 결과)이라 그대로 순회
  let maxConsecutiveLosses = 0, streak = 0
  for (const l of lots) {
    streak = l.pnl < 0 ? streak + 1 : 0
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak)
  }

  return {
    count: lots.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitRatio,
    expectancy: winRate * avgWin + (losses.length / lots.length) * avgLoss,
    maxConsecutiveLosses,
  }
}
