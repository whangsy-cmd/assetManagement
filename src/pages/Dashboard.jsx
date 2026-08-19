// 대시보드 — 총자산 현황/그래프/계좌별 평가현황/섹터 비중
import { Fragment, useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import { getLatestHoldings, getAllAccountEval, getSectors, getRebalanceSettings, getLoans, getAllRealizedProfits, getAllTransactions } from '../utils/firestore'
import { getAccountCategory, LOAN_ACCOUNT_ID, buildRowsByAccount, categorySumsAsOf, sumCategoryValues, latestCashByAccount, buildDailySummary } from '../utils/holdingsAgg'
import { buildTransferEvents, buildCashFlowSummary } from '../utils/finance'
import { getUsdKrwRate } from '../utils/exchangeRate'
import AccountEvalChart from '../components/AccountEvalChart'
import { fmt, sgn, pc } from '../utils/format'
import { CATEGORY_LABEL, CATEGORY_ORDER, ASSET_BASELINE_DATE } from '../constants'
import '../common.css'

const COLORS = ['#2f71ed', '#0ea5b7', '#e0b94f', '#e2703a', '#8b6cf0', '#38b28a', '#c65a8a', '#4fa8dc', '#d97b3f', '#7c8ba1']

function fmtWon(n) {
  if (!n && n !== 0) return '-'
  return Math.round(n).toLocaleString()
}

function makePieLabel(denom) {
  return function({ cx, cy, midAngle, innerRadius, outerRadius, value }) {
    const pct = value / denom
    if (pct < 0.04) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.6
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {(pct * 100).toFixed(1)}%
      </text>
    )
  }
}

// 카테고리 표시 순서 — 등록된 카테고리 중 알려진 것만 우선 정렬, 나머지는 이름순 뒤에 붙임
function sortCategories(cats) {
  return [...cats].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a), bi = CATEGORY_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

// 기간별 실현손익 합계 — realizedProfits를 기간(월/연)×계좌유형별로 합산
function realizedProfitSumsByPeriod(rows, accCatMap, mode) {
  const map = new Map() // periodKey -> { category: sum }
  for (const r of rows) {
    const key = mode === 'year' ? r.date.slice(0, 4) : r.date.slice(0, 7)
    const cat = getAccountCategory(r.accountId, accCatMap)
    if (!map.has(key)) map.set(key, {})
    const bucket = map.get(key)
    bucket[cat] = (bucket[cat] || 0) + (r.realizedProfit || 0)
  }
  return map
}

// 잔액은 계좌별평가 스냅샷, 수익(실현손익)은 realizedProfits 테이블 기준 — 서로 다른 집계 방식
function computeAggregates(snapshots, mode, categories, realizedByPeriod) {
  const groups = {}
  for (const s of snapshots) {
    const key = mode === 'year' ? s.date.slice(0, 4) : s.date.slice(0, 7)
    groups[key] = s
  }
  // 실현손익만 있고 계좌평가 스냅샷이 없는 기간도 누락 없이 포함 (합계가 원본 실현손익 총액과 어긋나는 것 방지)
  const keys = [...new Set([...Object.keys(groups), ...realizedByPeriod.keys()])].sort()
  // i=0 기준점: 데이터셋 최초 스냅샷 → 모든 기간 합산 = latest - first (텔레스코핑 보장)
  const absFirst = snapshots[0]

  let lastSnapshot = absFirst
  return keys.map((key) => {
    const curr = groups[key] || { categories: {}, totalBalance: 0 }
    const baseBal = lastSnapshot?.totalBalance ?? 0
    const realizedBucket = realizedByPeriod.get(key) || {}
    const cat = {}
    let totalChg = 0
    for (const c of categories) {
      const bal = curr.categories[c] || 0
      const chg = realizedBucket[c] || 0
      cat[c] = { bal, chg }
      totalChg += chg
    }
    const rate = baseBal > 0 ? totalChg / baseBal * 100 : null
    if (groups[key]) lastSnapshot = groups[key]
    return { period: key, cat, totalBal: curr.totalBalance ?? 0, totalChg, rate }
  }).reverse()
}

function AggregateTable({ rows, categories }) {
  const totals = rows.reduce((acc, r) => {
    const next = { ...acc, totalChg: acc.totalChg + r.totalChg }
    for (const c of categories) next[c] = (acc[c] || 0) + r.cat[c].chg
    return next
  }, { totalChg: 0 })

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th rowSpan={2}>기간</th>
            {categories.map(c => <th key={c} className="th-group sep" colSpan={2}>{CATEGORY_LABEL[c] || c}</th>)}
            <th className="th-group sep" colSpan={2}>합계</th>
            <th className="r sep" rowSpan={2}>수익률</th>
          </tr>
          <tr>
            {categories.map(c => (
              <Fragment key={c}><th className="r sep">잔액</th><th className="r">실현손익(원)</th></Fragment>
            ))}
            <th className="r sep">잔액</th><th className="r">실현손익(원)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.period}</td>
              {categories.map(c => (
                <Fragment key={c}>
                  <td className="r sep-dim">{fmtWon(r.cat[c].bal)}</td>
                  <td className={`r ${pc(r.cat[c].chg)}`}>{sgn(r.cat[c].chg)}{fmtWon(r.cat[c].chg)}</td>
                </Fragment>
              ))}
              <td className="r bold sep-dim">{fmtWon(r.totalBal)}</td>
              <td className={`r bold ${pc(r.totalChg)}`}>{sgn(r.totalChg)}{fmtWon(r.totalChg)}</td>
              <td className={`r sep-dim ${r.rate !== null ? pc(r.rate) : 'muted'}`}>
                {r.rate !== null ? `${sgn(r.rate)}${r.rate.toFixed(2)}%` : '-'}
              </td>
            </tr>
          ))}
          <tr className="total-row">
            <td className="bold dim">실현손익합계</td>
            {categories.map(c => (
              <Fragment key={c}>
                <td className="sep-dim" />
                <td className={`r bold ${pc(totals[c])}`}>{sgn(totals[c])}{fmtWon(totals[c])}</td>
              </Fragment>
            ))}
            <td className="sep-dim" /><td className={`r bold ${pc(totals.totalChg)}`}>{sgn(totals.totalChg)}{fmtWon(totals.totalChg)}</td>
            <td className="sep-dim" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [holdings, setHoldings] = useState([])
  const [accountEval, setAccountEval] = useState([])
  const [realizedProfits, setRealizedProfits] = useState([])
  const [loans, setLoans] = useState([])
  const [sectors, setSectors] = useState([])
  const [rebalanceSettings, setRebalanceSettings] = useState({})
  const [transactions, setTransactions] = useState([])
  const [usdRate, setUsdRate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [aggMode, setAggMode] = useState('month')

  useEffect(() => {
    if (!user) return
    Promise.all([
      getLatestHoldings(user.uid),
      getAllAccountEval(user.uid),
      getSectors(user.uid),
      getRebalanceSettings(user.uid),
      getLoans(user.uid),
      getAllRealizedProfits(user.uid),
      getAllTransactions(user.uid),
    ]).then(([h, ae, sec, st, ln, rp, tx]) => {
      setHoldings(h); setAccountEval(ae); setSectors(sec)
      setRebalanceSettings(st || {})
      setLoans(ln)
      setRealizedProfits(rp)
      setTransactions(tx)
      setLoading(false)
    })
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    getUsdKrwRate(today).then(setUsdRate).catch(() => setUsdRate(null))
  }, [user])

  if (loading) return <div className="loading">로딩 중...</div>
  if (!accountEval.length) return (
    <div className="empty">
      <p>아직 데이터가 없습니다.</p>
      <p style={{ color: '#64748b', fontSize: 14 }}>데이터 입력 메뉴에서 HTS 데이터를 붙여넣기 하세요.</p>
    </div>
  )

  const accCatMap  = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))

  // 전 기간 데이터 시작점 고정 — 그래프/수익률/누적수익 등 모든 계산이 이 날짜부터
  // 대출금(LOAN_ACCOUNT_ID)은 가상 계좌라 자산 집계에서 제외 — 순자산 계산은 아래에서 loans 컬렉션으로 별도 처리
  const evalRows = accountEval.filter(r => r.date >= ASSET_BASELINE_DATE && r.accountId !== LOAN_ACCOUNT_ID)
  const loanEvalRows = accountEval.filter(r => r.date >= ASSET_BASELINE_DATE && r.accountId === LOAN_ACCOUNT_ID)

  // 계좌별평가(accountEval)를 날짜별로 묶고, 계좌별로도 날짜 오름차순 정렬
  const rowsByDate = new Map()
  for (const r of evalRows) {
    if (!rowsByDate.has(r.date)) rowsByDate.set(r.date, [])
    rowsByDate.get(r.date).push(r)
  }
  const rowsByAccount = buildRowsByAccount(evalRows)
  const cashAmtByAccount = latestCashByAccount(rowsByAccount)
  const evalDates = [...rowsByDate.keys()].sort()
  const latestDate = evalDates.at(-1)
  const prevDate = evalDates.length > 1 ? evalDates[evalDates.length - 2] : null

  const latestSums = categorySumsAsOf(rowsByAccount, latestDate, accCatMap)
  const prevSums = prevDate ? categorySumsAsOf(rowsByAccount, prevDate, accCatMap) : latestSums
  const prevTotal = sumCategoryValues(prevSums)

  const totalLoan = loans.reduce((s, l) => s + (l.amount || 0), 0)
  const totalBalance = sumCategoryValues(latestSums)

  const latest = {
    date: latestDate,
    totalBalance,
    totalChange: totalBalance - prevTotal,
    totalChangeRate: prevTotal > 0 ? (totalBalance - prevTotal) / prevTotal * 100 : 0,
    totalLoan,
    netBalance: totalBalance - totalLoan,
    domestic: { balance: latestSums.domestic, change: latestSums.domestic - prevSums.domestic },
    overseas: { balance: latestSums.overseas, change: latestSums.overseas - prevSums.overseas },
    pension:  { balance: latestSums.pension,  change: latestSums.pension  - prevSums.pension },
    futures:  { balance: latestSums.futures || 0, change: (latestSums.futures || 0) - (prevSums.futures || 0) },
  }
  const weekChange     = latest.totalChange
  const weekChangeRate = latest.totalChangeRate
  const pension  = latest.pension.balance
  const domestic = latest.domestic.balance
  const overseas = latest.overseas.balance

  // 섹터별 집계
  const sectorMap = Object.fromEntries(sectors.map(s => [s.code, s.sector || '미분류']))
  const sectorAgg = {}
  for (const h of holdings) {
    const sec = sectorMap[h.code] || '미분류'
    sectorAgg[sec] = (sectorAgg[sec] || 0) + (h.evalAmt || 0)
  }
  const sectorStockTotal = Object.values(sectorAgg).reduce((a, b) => a + b, 0)
  const cashInSector = totalBalance - sectorStockTotal
  if (cashInSector > 0) sectorAgg['예수금'] = (sectorAgg['예수금'] || 0) + cashInSector
  const netDenom  = totalBalance || 1
  const sectorData = Object.entries(sectorAgg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const categoryData = [
    ...Object.entries(latestSums).map(([cat, value]) => ({
      name: CATEGORY_LABEL[cat] || cat,
      value: cat === 'domestic' ? value - (latest.totalLoan || 0) : value,
    })),
    ...(latest.totalLoan > 0 ? [{ name: '대출금', value: latest.totalLoan }] : []),
  ].filter(d => d.value > 0).sort((a, b) => b.value - a.value)

  // 셰넌 리밸런싱 요약 (연금/연금외 독립 — 리밸런싱 페이지에서 저장한 기준 사용, 없으면 기본값). 대출 미반영, 현재 예수금 그대로 계산.
  const isPensionAcc = (id) => getAccountCategory(id, accCatMap) === 'pension'
  function shannonSummary(isPool, poolKey) {
    const poolHoldings = holdings.filter(h => isPool(h.accountId))
    const poolSectorAgg = {}
    for (const h of poolHoldings) {
      const sec = sectorMap[h.code] || '미분류'
      poolSectorAgg[sec] = (poolSectorAgg[sec] || 0) + (h.evalAmt || 0)
    }
    const stockAmt = Object.values(poolSectorAgg).reduce((a, b) => a + b, 0)
    const cashAmt = [...cashAmtByAccount].filter(([id]) => isPool(id)).reduce((s, [, amt]) => s + amt, 0)
    poolSectorAgg['예수금'] = (poolSectorAgg['예수금'] || 0) + cashAmt
    const total = stockAmt + cashAmt || 1

    const cfg = rebalanceSettings.shannon?.[poolKey] || {}
    const safeRatio = cfg.safeRatio ?? 30
    const band = cfg.band ?? 10
    const safeSectors = cfg.safeSectors ?? ['예수금']
    const safeAssetAmt = safeSectors.reduce((s, n) => s + (poolSectorAgg[n] || 0), 0)
    const riskyAssetAmt = total - safeAssetAmt
    const targetSafeAmt = safeRatio / 100 * total
    const targetRiskyAmt = total - targetSafeAmt
    const currentSafePct = safeAssetAmt / total * 100
    const needsRebalance = Math.abs(currentSafePct - safeRatio) > band
    const riskyRebalanceAmt = needsRebalance ? targetRiskyAmt - riskyAssetAmt : 0

    return { total, safeRatio, band, safeAssetAmt, riskyAssetAmt, needsRebalance, riskyRebalanceAmt }
  }
  const shannonPools = [
    { label: '연금', ...shannonSummary(isPensionAcc, 'pension') },
    { label: '연금외', ...shannonSummary(id => !isPensionAcc(id), 'other') },
  ]

  // 계좌별 집계 — 평가금액/예수금/총잔액은 계좌별평가(accountEval) 최신 날짜 기준, 매입금액/평가손익은 보유종목(holdings)에서 보충
  const accNameMap = Object.fromEntries(accounts.map(a => [a.accountId, a.name || a.accountId]))
  const purchaseByAccount = {}
  const gainLossByAccount = {}
  for (const h of holdings) {
    purchaseByAccount[h.accountId] = (purchaseByAccount[h.accountId] || 0) + (h.purchaseAmt || 0)
    gainLossByAccount[h.accountId] = (gainLossByAccount[h.accountId] || 0) + (h.gainLoss || 0)
  }
  // 전체 계좌 공통 최신 날짜 기준, 예탁금(총액)이 0이 아닌 계좌만 표시
  const latestEvalRows = (rowsByDate.get(latestDate) || []).filter(r => r.totalAmt !== 0)
  const accountRows = latestEvalRows.map(r => {
    const purchaseAmt = purchaseByAccount[r.accountId] || 0
    const gainLoss = gainLossByAccount[r.accountId] || 0
    return {
      accountId: r.accountId,
      category: getAccountCategory(r.accountId, accCatMap),
      purchaseAmt,
      evalAmt: r.evalAmt || 0,
      gainLoss,
      cashAmt: r.cashAmt || 0,
      totalAmt: r.totalAmt || 0,
      returnRate: purchaseAmt > 0 ? (gainLoss / purchaseAmt) * 100 : 0,
    }
  }).sort((a, b) => b.totalAmt - a.totalAmt)
  const accTotals = accountRows.reduce(
    (acc, r) => ({ purchaseAmt: acc.purchaseAmt + r.purchaseAmt, evalAmt: acc.evalAmt + r.evalAmt, gainLoss: acc.gainLoss + r.gainLoss, cashAmt: acc.cashAmt + r.cashAmt, totalAmt: acc.totalAmt + r.totalAmt }),
    { purchaseAmt: 0, evalAmt: 0, gainLoss: 0, cashAmt: 0, totalAmt: 0 }
  )

  // 자산순증 — 계좌통합 조회(일자별 순자산 집계)의 첫 기록과 마지막 기록 차액
  const dailySummary = buildDailySummary(evalRows, loanEvalRows, accCatMap)
  const first = dailySummary[0] || { date: ASSET_BASELINE_DATE, netBalance: 0 }
  const cumulativeGain = (dailySummary.at(-1)?.netBalance ?? 0) - (first.netBalance ?? 0)
  const cumulativeRate = (first.netBalance ?? 0) > 0 ? (cumulativeGain / first.netBalance) * 100 : 0

  // 순입출금액 — 자산순증과 같은 기간(첫 기록 ~ 마지막 기록)의 순수 입출금(이체)만 집계
  const transferEvents = buildTransferEvents(transactions, usdRate)
  const cashFlow = buildCashFlowSummary(transactions, transferEvents, first.date, dailySummary.at(-1)?.date, usdRate)

  // 종목별 비중 (코드별 합산 → 섹터별 그룹)
  const totalBal = totalBalance || 1
  const codeAgg = {}
  for (const h of holdings) {
    if (!codeAgg[h.code]) codeAgg[h.code] = { code: h.code, name: h.name || h.code, evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    codeAgg[h.code].evalAmt     += h.evalAmt     || 0
    codeAgg[h.code].purchaseAmt += h.purchaseAmt || 0
    codeAgg[h.code].gainLoss    += h.gainLoss    || 0
  }
  const sectorGroupMap = {}
  for (const item of Object.values(codeAgg)) {
    const sec = sectorMap[item.code] || '미분류'
    if (!sectorGroupMap[sec]) sectorGroupMap[sec] = { sector: sec, items: [], evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    sectorGroupMap[sec].items.push(item)
    sectorGroupMap[sec].evalAmt     += item.evalAmt
    sectorGroupMap[sec].purchaseAmt += item.purchaseAmt
    sectorGroupMap[sec].gainLoss    += item.gainLoss
  }
  const sectorGroups = Object.values(sectorGroupMap)
    .map(g => ({ ...g, items: g.items.sort((a, b) => b.evalAmt - a.evalAmt) }))
    .sort((a, b) => b.evalAmt - a.evalAmt)
  const holdingsEvalTotal     = sectorGroups.reduce((s, g) => s + g.evalAmt, 0)
  const holdingsGainTotal     = sectorGroups.reduce((s, g) => s + g.gainLoss, 0)
  const holdingsPurchaseTotal = sectorGroups.reduce((s, g) => s + g.purchaseAmt, 0)
  const holdingCount          = Object.keys(codeAgg).length
  const stockCashTotal        = (holdingsEvalTotal + accTotals.cashAmt) || 1 // 종목별 비중 표 전용 분모 — 주식+예수금 합계가 100%가 되도록

  // 기간별 수익 집계 — 계좌별평가를 날짜별 카테고리 합계로 변환해 스냅샷과 동일한 형태로 공급
  const categories = sortCategories([...new Set(Object.values(accCatMap))])
  const snapshotsLike = evalDates.map(d => {
    const s = categorySumsAsOf(rowsByAccount, d, accCatMap)
    return { date: d, categories: s, totalBalance: sumCategoryValues(s) }
  })
  const realizedByPeriod = realizedProfitSumsByPeriod(realizedProfits, accCatMap, aggMode)
  const aggData = computeAggregates(snapshotsLike, aggMode, categories, realizedByPeriod)

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">대시보드</h2>
        <span className="page-heading-sub">{first.date} ~ {latest.date} 기준</span>
        <span className="page-heading-net"><span className="page-heading-sub">순자산&nbsp;</span>{(latest.netBalance ?? 0).toLocaleString()}원</span>
      </div>

      {/* 요약 바 */}
      <div className="summary-bar">
        <div className="summary-main">
          <span className="summary-label">순자산</span>
          <span className="summary-value">{fmt(latest.netBalance)}원</span>
          <span className="summary-sub" style={{ color: weekChange >= 0 ? '#22c55e' : '#ef4444' }}>
            주간 {sgn(weekChange)}{fmt(weekChange)}원 ({sgn(weekChangeRate)}{weekChangeRate.toFixed(2)}%)
          </span>
        </div>

        <div className="summary-divider" />

        {[
          { label: '국내', val: domestic, chg: latest.domestic?.change ?? 0 },
          { label: '해외', val: overseas, chg: latest.overseas?.change ?? 0 },
          { label: '연금', val: pension,  chg: latest.pension?.change  ?? 0 },
          { label: '선물옵션', val: latest.futures.balance, chg: latest.futures.change },
          ...(latest.totalLoan > 0 ? [{ label: '대출금', val: latest.totalLoan, chg: null, neg: true }] : []),
        ].map(({ label, val, chg, neg }) => (
          <div key={label} className="summary-item">
            <span className="summary-label">{label}</span>
            <span className="summary-item-val" style={{ color: neg ? '#ef4444' : '#f1f5f9' }}>
              {neg ? '-' : ''}{fmt(val)}원
            </span>
            {chg !== null && (
              <span className="summary-sub" style={{ color: chg >= 0 ? '#22c55e' : '#ef4444' }}>
                {sgn(chg)}{fmt(chg)}
              </span>
            )}
          </div>
        ))}

        <div className="summary-divider" />

        {[
          { label: '자산순증',   val: `${sgn(cumulativeGain)}${fmt(cumulativeGain)}원`, color: pc(cumulativeGain), sub: `${first.date} ~` },
          { label: '순증가률', val: `${sgn(cumulativeRate)}${cumulativeRate.toFixed(2)}%`, color: pc(cumulativeRate), sub: `기준 ${fmt(first.netBalance)}원` },
          { label: '순입출금액', val: `${sgn(cashFlow.netTransfer)}${fmt(cashFlow.netTransfer)}원`, color: pc(cashFlow.netTransfer), sub: '입금액 − 출금액' },
        ].map(({ label, val, color, sub }) => (
          <div key={label} className="summary-item">
            <span className="summary-label">{label}</span>
            <span className={`summary-item-val ${color}`}>{val}</span>
            <span className="summary-sub">{sub}</span>
          </div>
        ))}
      </div>

      {/* 셰넌 리밸런싱 요약 (연금/연금외, 리밸런싱 페이지에서 저장한 기준 사용) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-header">
          <h3 className="section-title">셰넌 리밸런싱 요약</h3>
          <span className="page-heading-sub">기준 조정은 리밸런싱 페이지에서</span>
        </div>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {shannonPools.map(p => (
            <div key={p.label} style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{p.label}</span> — 위험 {(100 - p.safeRatio).toFixed(0)}% · 변동범위 ±{p.band}%p
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13 }}>
                  <span className="dim">위험자산 </span>
                  <span style={{ fontWeight: 700 }}>{fmt(p.riskyAssetAmt)}원</span>
                  <span className="dim"> ({(p.riskyAssetAmt / p.total * 100).toFixed(1)}%, </span>
                  <span className={p.needsRebalance ? pc(p.riskyRebalanceAmt) : 'dim'}>
                    {p.needsRebalance
                      ? <>{p.riskyRebalanceAmt >= 0 ? '매수 ' : '매도 '}{fmt(Math.abs(p.riskyRebalanceAmt))}</>
                      : '밴드이내'}
                  </span>
                  <span className="dim">)</span>
                </span>
                <span style={{ fontSize: 13 }}>
                  <span className="dim">안전자산 </span>
                  <span style={{ fontWeight: 700 }}>{fmt(p.safeAssetAmt)}원</span>
                  <span className="dim"> ({(p.safeAssetAmt / p.total * 100).toFixed(1)}%)</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 총자산 변동 차트 (계좌별평가 기준) */}
      <AccountEvalChart rows={evalRows} categoryOf={id => CATEGORY_LABEL[getAccountCategory(id, accCatMap)] || getAccountCategory(id, accCatMap)} />

      {/* 비중 차트 */}
      <div className="card-row">
        {[
          { title: '섹터별 비중',   data: sectorData,   denom: netDenom },
          { title: '자산유형별 비중', data: categoryData, denom: totalBal },
        ].map(({ title, data, denom }) => (
          <div key={title} className="card">
            <div className="section-header">
              <h3 className="section-title" style={{ flexShrink: 0 }}>{title}</h3>
              <div className="legend" style={{ flex: 1, justifyContent: 'flex-end' }}>
                {data.map((d, i) => (
                  <span key={i} className="legend-item">
                    <span className="legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{d.name}</span>
                    <span className="legend-pct">{((d.value / denom) * 100).toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} labelLine={false} label={makePieLabel(denom)}>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
                    formatter={(v, name) => [`${v.toLocaleString()}원 (${((v / denom) * 100).toFixed(1)}%)`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* 종목별 비중 */}
      {sectorGroups.length > 0 && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">종목별 비중</h3>
            <span className="page-heading-sub">{holdingCount}개 종목</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>코드</th>
                  <th className="r">평가금액</th>
                  <th className="r">총자산비중</th>
                  <th className="r">평가손익</th>
                  <th className="r">수익률</th>
                </tr>
              </thead>
              <tbody>
                {sectorGroups.map(g => (
                  <Fragment key={g.sector}>
                    <tr className="sector-row">
                      <td colSpan={2} className="bold">{g.sector}</td>
                      <td className="r bold">{fmtWon(g.evalAmt)}</td>
                      <td className="r bold">{(g.evalAmt / stockCashTotal * 100).toFixed(1)}%</td>
                      <td className={`r bold ${pc(g.gainLoss)}`}>{sgn(g.gainLoss)}{fmtWon(g.gainLoss)}</td>
                      <td className={`r bold ${g.purchaseAmt > 0 ? pc(g.gainLoss) : 'muted'}`}>
                        {g.purchaseAmt > 0 ? `${sgn(g.gainLoss)}${(g.gainLoss / g.purchaseAmt * 100).toFixed(2)}%` : '-'}
                      </td>
                    </tr>
                    {g.items.map(h => {
                      const weight = h.evalAmt / stockCashTotal * 100
                      const returnRate = h.purchaseAmt > 0 ? (h.gainLoss / h.purchaseAmt) * 100 : 0
                      return (
                        <tr key={`${g.sector}-${h.code}`}>
                          <td style={{ paddingLeft: '1.8rem' }}>{h.name}</td>
                          <td className="dim">{h.code}</td>
                          <td className="r">{fmtWon(h.evalAmt)}</td>
                          <td className="r">{weight.toFixed(1)}%</td>
                          <td className={`r ${pc(h.gainLoss)}`}>{sgn(h.gainLoss)}{fmtWon(h.gainLoss)}</td>
                          <td className={`r ${pc(returnRate)}`}>{sgn(returnRate)}{returnRate.toFixed(2)}%</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
                {accTotals.cashAmt > 0 && (
                  <tr>
                    <td className="bold" colSpan={2}>예수금</td>
                    <td className="r">{fmtWon(accTotals.cashAmt)}</td>
                    <td className="r">{(accTotals.cashAmt / stockCashTotal * 100).toFixed(1)}%</td>
                    <td className="r dim">-</td>
                    <td className="r dim">-</td>
                  </tr>
                )}
                <tr className="total-row">
                  <td className="bold dim" colSpan={2}>합계</td>
                  <td className="r bold">{fmtWon(holdingsEvalTotal + accTotals.cashAmt)}</td>
                  <td className="r bold">{((holdingsEvalTotal + accTotals.cashAmt) / stockCashTotal * 100).toFixed(1)}%</td>
                  <td className={`r bold ${pc(holdingsGainTotal)}`}>{sgn(holdingsGainTotal)}{fmtWon(holdingsGainTotal)}</td>
                  <td className={`r bold ${holdingsPurchaseTotal > 0 ? pc(holdingsGainTotal) : 'muted'}`}>
                    {holdingsPurchaseTotal > 0 ? `${sgn(holdingsGainTotal)}${(holdingsGainTotal / holdingsPurchaseTotal * 100).toFixed(2)}%` : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 계좌별 평가현황 */}
      {accountRows.length > 0 && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">계좌별 평가현황</h3>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>계좌</th><th>유형</th>
                  <th className="r">매입금액</th><th className="r">평가금액</th>
                  <th className="r">평가손익</th><th className="r">수익률</th>
                  <th className="r">예수금</th><th className="r">총잔액</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((r, i) => (
                  <tr key={i}>
                    <td>{accNameMap[r.accountId] || r.accountId}</td>
                    <td><span className={`badge badge-${r.category}`}>{CATEGORY_LABEL[r.category] || r.category}</span></td>
                    <td className="r">{r.purchaseAmt > 0 ? fmtWon(r.purchaseAmt) : '-'}</td>
                    <td className="r">{fmtWon(r.evalAmt)}</td>
                    <td className={`r bold ${r.purchaseAmt > 0 ? pc(r.gainLoss) : 'muted'}`}>{r.purchaseAmt > 0 ? `${sgn(r.gainLoss)}${fmtWon(r.gainLoss)}` : '-'}</td>
                    <td className={`r bold ${r.purchaseAmt > 0 ? pc(r.returnRate) : 'muted'}`}>{r.purchaseAmt > 0 ? `${sgn(r.returnRate)}${r.returnRate.toFixed(2)}%` : '-'}</td>
                    <td className="r dim">{r.cashAmt > 0 ? fmtWon(r.cashAmt) : '-'}</td>
                    <td className="r bold">{fmtWon(r.totalAmt)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td className="bold dim" colSpan={2}>합계</td>
                  <td className="r bold">{fmtWon(accTotals.purchaseAmt)}</td>
                  <td className="r bold">{fmtWon(accTotals.evalAmt)}</td>
                  <td className={`r bold ${pc(accTotals.gainLoss)}`}>{sgn(accTotals.gainLoss)}{fmtWon(accTotals.gainLoss)}</td>
                  <td className={`r bold ${accTotals.purchaseAmt > 0 ? pc(accTotals.gainLoss) : 'muted'}`}>
                    {accTotals.purchaseAmt > 0 ? `${sgn(accTotals.gainLoss)}${((accTotals.gainLoss / accTotals.purchaseAmt) * 100).toFixed(2)}%` : '-'}
                  </td>
                  <td className="r bold dim">{fmtWon(accTotals.cashAmt)}</td>
                  <td className="r bold purple">{fmtWon(accTotals.totalAmt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 기간별 수익 집계 */}
      <div className="card">
        <div className="section-header">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h3 className="section-title">기간별 실현수익 집계</h3>
          </div>
          <div className="toggle-group">
            <button className={`toggle-btn${aggMode === 'month' ? ' active' : ''}`} onClick={() => setAggMode('month')}>월별</button>
            <button className={`toggle-btn${aggMode === 'year'  ? ' active' : ''}`} onClick={() => setAggMode('year')}>연별</button>
          </div>
        </div>
        <AggregateTable rows={aggData} categories={categories} />
      </div>
    </div>
  )
}
