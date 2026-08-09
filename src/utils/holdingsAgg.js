// accounts 컬렉션에 등록되지 않은 계좌(옵션/임시계좌잔고로만 존재)의 카테고리 보정
export const SPECIAL_ACCOUNT_CATEGORY = {
  '3058-4099': 'domestic',   // 키움국내
  '5124-4860': 'overseas',   // 키움해외
  '1611-0027': 'domestic',   // 키움국내옵션
  '5767-2099': 'overseas',   // 키움해외옵션
  '000-0000-0000': 'pension', // 스냅샷에서 이전한 과거 연금 데이터
}

export function getAccountCategory(accountId, accCatMap) {
  return SPECIAL_ACCOUNT_CATEGORY[accountId] || accCatMap[accountId] || 'domestic'
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

// 계좌별평가(accountEval) 행을 계좌별로 묶어 날짜 오름차순 정렬 (대출금 가상계좌 제외)
export function buildRowsByAccount(rows) {
  const rowsByAccount = new Map()
  for (const r of rows) {
    if (r.accountId === LOAN_ACCOUNT_ID) continue
    if (!rowsByAccount.has(r.accountId)) rowsByAccount.set(r.accountId, [])
    rowsByAccount.get(r.accountId).push(r)
  }
  for (const arr of rowsByAccount.values()) arr.sort((a, b) => a.date.localeCompare(b.date))
  return rowsByAccount
}

// 계좌마다 갱신 주기가 달라도(선물옵션 등) 각 계좌의 asOfDate 이하 최신값을 이월해서 카테고리별로 합산
export function categorySumsAsOf(rowsByAccount, asOfDate, accCatMap) {
  const sums = { pension: 0, domestic: 0, overseas: 0 }
  for (const [accountId, arr] of rowsByAccount) {
    let latestRow = null
    for (const r of arr) { if (r.date > asOfDate) break; latestRow = r }
    if (!latestRow) continue
    sums[getAccountCategory(accountId, accCatMap)] += latestRow.totalAmt || 0
  }
  return sums
}

// 계좌별 가장 최근 예수금(cashAmt) 맵
export function latestCashByAccount(rowsByAccount) {
  return new Map([...rowsByAccount].map(([id, arr]) => [id, arr.at(-1)?.cashAmt || 0]))
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
