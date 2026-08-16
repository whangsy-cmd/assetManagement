// 자산 가치 시계열의 최대낙폭(MDD) — 셰넌 시뮬레이션/리밸런싱 리포트 공용
export function maxDrawdown(series) {
  let peak = series[0], dd = 0
  for (const v of series) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return dd
}

// 시계열(dates/values) 기반 성과지표 — values에 raw 잔액을 넣으면 입출금이 섞인 값, TWR 조정 index(buildAdjustedIndex 결과)를 넣으면 순수 운용성과 기준
// 관측 주기가 불규칙해도 되도록 연간 관측횟수(freq)를 실제 데이터로 추정해 변동성을 연환산
export function computePerformanceStats(dates, values) {
  if (dates.length < 2 || values[0] <= 0) return null
  const days = (new Date(dates.at(-1)) - new Date(dates[0])) / 86400000
  const years = days / 365
  const cagr = years > 0 ? Math.pow(values.at(-1) / values[0], 1 / years) - 1 : 0

  const rets = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1)
  }
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0
  const variance = rets.length ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0
  const freq = years > 0 ? rets.length / years : 0
  const volatility = Math.sqrt(variance * freq)
  const sharpe = volatility > 0 ? cagr / volatility : 0

  // 소르티노 지수 — 샤프와 달리 손실(음수 수익률)만으로 변동성을 계산해 상방 변동은 벌점 대상에서 제외
  const downRets = rets.filter(r => r < 0)
  const downsideVariance = rets.length ? downRets.reduce((s, r) => s + r ** 2, 0) / rets.length : 0
  const downsideDeviation = Math.sqrt(downsideVariance * freq)
  const sortino = downsideDeviation > 0 ? cagr / downsideDeviation : 0

  return { cagr, mdd: maxDrawdown(values), volatility, sharpe, downsideDeviation, sortino }
}

// 계좌통합(전체 계좌 합산) 기준 이체(입출금) 유형 — 대체입출금(계좌간 내부이동)도 모두 포함.
// 내부이동은 같은 구간에 입금/출금 쌍이 같이 잡혀 합산 시 서로 상쇄되므로 굳이 제외할 필요 없음. 배당/이자/분배금 등 손익성 입출금은 제외.
export const TRANSFER_TYPES = new Set(['이체입금', '계좌대체입금', '대체출금', '대체입금', '이체출금', '소액이체인증입금', '이체오픈뱅킹입금', '대체외화출금', '대체외화입금'])

// 거래내역에서 순수 이체(입출금) 이벤트만 추출해 날짜별 KRW 환산 금액으로 변환 (TWR 계산용)
export function buildTransferEvents(transactions, usdRate) {
  return transactions
    .filter(t => TRANSFER_TYPES.has(t.type))
    .map(t => {
      const signed = t.type.endsWith('입금') ? Math.abs(t.amount) : -Math.abs(t.amount)
      return { date: t.date, amountKrw: t.currency === 'USD' ? signed * (usdRate || 0) : signed }
    })
}

// 대출 잔액 증감을 입출금 이벤트로 변환 — 대출로 투자원금이 늘거나(증액=입금) 상환으로 줄어드는 것(감액=출금)도
// 순자산(자산-대출) 기준 순수 운용수익 계산에서는 투자성과가 아닌 외부 자금 유출입이라 TWR에서 제외해야 함
// loanRows: accountEval 중 accountId===LOAN_ACCOUNT_ID 행 (totalAmt = -대출잔액)
export function buildLoanTransferEvents(loanRows) {
  const sorted = [...loanRows].sort((a, b) => a.date.localeCompare(b.date))
  const events = []
  let prevLoan = 0
  for (const r of sorted) {
    const loan = -(r.totalAmt || 0)
    const delta = loan - prevLoan
    if (delta !== 0) events.push({ date: r.date, amountKrw: delta })
    prevLoan = loan
  }
  return events
}

// 이체(입출금) 반영해 순수 운용수익만 남긴 지수 시리즈(시작=1) — 평가일 구간마다 이체금액을 뺀 수익률을 기하연결
// 이 index를 computePerformanceStats에 넣으면 CAGR/MDD/변동성/샤프가 입출금에 왜곡되지 않는다
function buildAdjustedIndex(dates, values, transferEvents) {
  const index = [1]
  for (let i = 1; i < dates.length; i++) {
    const from = dates[i - 1], to = dates[i]
    const cf = transferEvents.filter(e => e.date > from && e.date <= to).reduce((s, e) => s + e.amountKrw, 0)
    const prev = values[i - 1]
    const r = prev > 0 ? (values[i] - cf) / prev - 1 : 0
    index.push(index[i - 1] * (1 + r))
  }
  return index
}

// TWR(시간가중수익률) — 평가일 구간마다 순수 입출금(이체)을 제외한 운용수익률을 구해 기하연결
// dates/values: 평가시점별 총잔액(오름차순), transferEvents: buildTransferEvents() 결과
// index를 함께 반환 — computePerformanceStats(dates, twr.index)로 넘기면 입출금 영향 없는 CAGR/MDD/변동성/샤프 계산 가능
export function computeTWR(dates, values, transferEvents) {
  if (dates.length < 2) return null
  const index = buildAdjustedIndex(dates, values, transferEvents)
  const total = index.at(-1) - 1
  const days = (new Date(dates.at(-1)) - new Date(dates[0])) / 86400000
  const years = days / 365
  const annualized = years > 0 ? Math.pow(index.at(-1), 1 / years) - 1 : total
  return { total, annualized, index }
}

const isTaxTxType = (type) => type.includes('세')
const isDividendType = (type) => /배당|분배금|이자|이용료/.test(type) && !isTaxTxType(type)

// 계좌통합(전체 계좌) 기준 입출금/수익/비용 요약 — 계좌평가 조회 탭과 동일한 분류 기준(대체류 제외, 배당/이자/세금 판별)을 기간 전체·전계좌로 확장
// transferEvents: buildTransferEvents() 결과(입금액/출금액 산출용) — TWR과 같은 입출금 정의를 그대로 재사용해 숫자가 서로 어긋나지 않게 함
export function buildCashFlowSummary(transactions, transferEvents, fromDate, toDate, usdRate) {
  const inRange = d => (!fromDate || d >= fromDate) && (!toDate || d <= toDate)
  const toKrw = (krw, usd) => krw + usd * (usdRate || 0)

  const eventsInRange = transferEvents.filter(e => inRange(e.date))
  const deposits = eventsInRange.filter(e => e.amountKrw > 0).reduce((s, e) => s + e.amountKrw, 0)
  const withdrawals = eventsInRange.filter(e => e.amountKrw < 0).reduce((s, e) => s + Math.abs(e.amountKrw), 0)

  const txInRange = transactions.filter(t => inRange(t.date))

  let divKrw = 0, divUsd = 0, feeKrw = 0, feeUsd = 0, taxFieldKrw = 0, taxFieldUsd = 0, taxTxKrw = 0, taxTxUsd = 0
  for (const t of txInRange) {
    const isUsd = t.currency === 'USD'
    if (isUsd) { feeUsd += t.fee || 0; taxFieldUsd += t.tax || 0 } else { feeKrw += t.fee || 0; taxFieldKrw += t.tax || 0 }

    if (isDividendType(t.type)) {
      const sign = t.type.endsWith('입금') ? 1 : t.type.endsWith('출금') ? -1 : Math.sign(t.amount) || 1
      const v = sign * Math.abs(t.amount)
      if (isUsd) divUsd += v; else divKrw += v
    } else if (isTaxTxType(t.type)) {
      const sign = t.type.endsWith('입금') ? -1 : t.type.endsWith('출금') ? 1 : Math.sign(t.amount) || 1
      const v = sign * Math.abs(t.amount)
      if (isUsd) taxTxUsd += v; else taxTxKrw += v
    }
  }

  return {
    deposits,
    withdrawals,
    netTransfer: deposits - withdrawals,
    dividendTotal: toKrw(divKrw, divUsd),
    feeTotal: toKrw(feeKrw, feeUsd),
    taxTotal: toKrw(taxFieldKrw, taxFieldUsd) + toKrw(taxTxKrw, taxTxUsd),
  }
}
