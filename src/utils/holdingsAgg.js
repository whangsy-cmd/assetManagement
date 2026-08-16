// 계좌 유형(카테고리)은 계좌 관리에 등록된 값만 사용 — 하드코딩된 계좌번호별 매핑 없음
export function getAccountCategory(accountId, accCatMap) {
  return accCatMap[accountId] || 'domestic'
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

// 계좌별로 asOfDate에 정확히 일치하는 데이터만 카테고리별로 합산 (이월 없음 — 없는 날은 0).
// pension/domestic/overseas는 항상 존재(0 초기화)하고, 그 외 등록된 유형(예: 선물옵션)은 등장하는 만큼 키가 추가됨.
export function categorySumsAsOf(rowsByAccount, asOfDate, accCatMap) {
  const sums = { pension: 0, domestic: 0, overseas: 0 }
  for (const [accountId, arr] of rowsByAccount) {
    const row = arr.find(r => r.date === asOfDate)
    if (!row) continue
    const cat = getAccountCategory(accountId, accCatMap)
    sums[cat] = (sums[cat] || 0) + (row.totalAmt || 0)
  }
  return sums
}

// categorySumsAsOf 결과의 모든 카테고리(고정 3개 + 추가 유형) 합계
export function sumCategoryValues(sums) {
  return Object.values(sums).reduce((a, b) => a + (b || 0), 0)
}

// 계좌별 가장 최근 예수금(cashAmt) 맵
export function latestCashByAccount(rowsByAccount) {
  return new Map([...rowsByAccount].map(([id, arr]) => [id, arr.at(-1)?.cashAmt || 0]))
}

// 계좌별평가+대출 rows를 일자별 카테고리 합계 요약(전일 대비 증감 포함)으로 변환 — 계좌통합조회/성과분석 공용
export function buildDailySummary(evalRows, loanRows, accCatMap) {
  const rowsByAccount = buildRowsByAccount(evalRows)
  const loanByDate = new Map(loanRows.map(r => [r.date, -(r.totalAmt || 0)]))
  const loanDates = [...loanByDate.keys()].sort()
  const loanAsOf = date => {
    let v = 0
    for (const d of loanDates) { if (d > date) break; v = loanByDate.get(d) }
    return v
  }
  const evalDates = [...new Set(evalRows.map(r => r.date))].sort()
  const summary = evalDates.map(date => {
    const s = categorySumsAsOf(rowsByAccount, date, accCatMap)
    const totalBalance = sumCategoryValues(s)
    const totalLoan = loanAsOf(date)
    return { date, domestic: s.domestic, overseas: s.overseas, pension: s.pension, futures: s.futures || 0, totalBalance, totalLoan, netBalance: totalBalance - totalLoan }
  })
  for (let i = 0; i < summary.length; i++) {
    const prev = i > 0 ? summary[i - 1] : null
    summary[i].domesticChange = prev ? summary[i].domestic - prev.domestic : 0
    summary[i].overseasChange = prev ? summary[i].overseas - prev.overseas : 0
    summary[i].pensionChange = prev ? summary[i].pension - prev.pension : 0
    summary[i].futuresChange = prev ? summary[i].futures - prev.futures : 0
    summary[i].totalChange = prev ? summary[i].totalBalance - prev.totalBalance : 0
    summary[i].totalChangeRate = prev && prev.totalBalance ? (summary[i].totalChange / prev.totalBalance) * 100 : 0
  }
  return summary
}
