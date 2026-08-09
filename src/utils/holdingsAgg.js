// accounts 컬렉션에 등록되지 않은 계좌(옵션/임시계좌잔고로만 존재)의 카테고리 보정
export const SPECIAL_ACCOUNT_CATEGORY = {
  '3058-4099': 'domestic',   // 키움국내
  '5124-4860': 'overseas',   // 키움해외
  '1611-0027': 'domestic',   // 키움국내옵션
  '5767-2099': 'overseas',   // 키움해외옵션
  '000-0000-0000': 'pension', // 스냅샷에서 이전한 과거 연금 데이터
}

export function getAccountCategory(accountId, accCatMap) {
  return accCatMap[accountId] || SPECIAL_ACCOUNT_CATEGORY[accountId] || 'domestic'
}

// 대출금은 날짜/계좌 이력이 없는 단일 현재값이라 계좌별평가에 가상 계좌로 등록한다
export const LOAN_ACCOUNT_ID = '대출금'

export function buildLoanEvalRow(date, loans) {
  const totalLoan = loans.reduce((s, l) => s + (l.amount || 0), 0)
  if (!totalLoan) return null
  return { date, accountId: LOAN_ACCOUNT_ID, evalAmt: 0, cashAmt: -totalLoan, totalAmt: -totalLoan }
}

// holdings+cash를 date_accountId 기준으로 합산해 계좌별 평가(accountEval) 행 생성
export function buildAccountEvalRows(holdings, cash) {
  const map = new Map()
  const keyOf = (date, accountId) => `${date}_${accountId}`
  for (const h of holdings) {
    const key = keyOf(h.date, h.accountId)
    if (!map.has(key)) map.set(key, { date: h.date, accountId: h.accountId, evalAmt: 0, cashAmt: 0 })
    map.get(key).evalAmt += h.evalAmt || 0
  }
  for (const c of cash) {
    const key = keyOf(c.date, c.accountId)
    if (!map.has(key)) map.set(key, { date: c.date, accountId: c.accountId, evalAmt: 0, cashAmt: 0 })
    map.get(key).cashAmt += c.amount || 0
  }
  return [...map.values()]
    .map(r => ({ ...r, totalAmt: r.evalAmt + r.cashAmt }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))
}

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
