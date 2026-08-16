// 성과분석 탭 (DataView) — 계좌통합 총잔액 추이 그래프(TQQQ/KODEX 레버리지 비교 포함) + CAGR/MDD/변동성/샤프/TWR 지표
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllAccountEval, getAllTransactions, getAllRealizedProfits, getAllTaxPayments } from '../../utils/firestore'
import { getUsdKrwRate } from '../../utils/exchangeRate'
import { getPriceSeries } from '../../utils/priceData'
import { LOAN_ACCOUNT_ID, buildDailySummary } from '../../utils/holdingsAgg'
import { computePerformanceStats, buildTransferEvents, buildLoanTransferEvents, computeTWR, buildCashFlowSummary } from '../../utils/finance'
import { buildClosedLots, computeExpectancy } from '../../utils/tradeAnalysis'
import { fmt } from './shared'

// 비교 그래프에 항상 표시할 종목 (시뮬레이션 > 종목관리 탭에서 미리 가격 데이터 저장 필요)
const COMPARE_SYMBOLS = [
  { code: 'TQQQ', label: 'TQQQ', color: '#ef4444' },
  { code: '122630', label: 'KODEX 레버리지', color: '#e0b94f' },
]

// 날짜순 정렬된 series에서 targetDate 이전(포함) 최근값 — 스냅샷 주기가 다른 시계열을 같은 x축에 올리기 위한 forward-fill
function valueAtOrBefore(sortedDates, valueOf, targetDate) {
  let result
  for (const d of sortedDates) {
    if (d > targetDate) break
    result = valueOf(d)
  }
  return result
}

function CompareTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>{p.dataKey}: {p.value.toFixed(1)}%</p>
      ))}
    </div>
  )
}

export default function PerformanceTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [accountEval, setAccountEval] = useState([])
  const [transactions, setTransactions] = useState([])
  const [realizedProfits, setRealizedProfits] = useState([])
  const [taxPayments, setTaxPayments] = useState([])
  const [usdRate, setUsdRate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [chartFrom, setChartFrom] = useState('')
  const [chartTo, setChartTo] = useState('')
  const [copied, setCopied] = useState(false)
  const [comparePrices, setComparePrices] = useState({})

  useEffect(() => {
    setLoading(true)
    setLoadError('')
    Promise.all([getAllAccountEval(user.uid), getAllTransactions(user.uid), getAllRealizedProfits(user.uid), getAllTaxPayments(user.uid)])
      .then(([evalRows, txRows, rpRows, taxRows]) => { setAccountEval(evalRows); setTransactions(txRows); setRealizedProfits(rpRows); setTaxPayments(taxRows); setLoading(false) })
      .catch(e => { setLoadError('데이터 로드 오류: ' + e.message); setLoading(false) })
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    getUsdKrwRate(today).then(setUsdRate).catch(() => setUsdRate(null))
    Promise.all(COMPARE_SYMBOLS.map(s => getPriceSeries(user.uid, s.code).catch(() => null)))
      .then(results => setComparePrices(Object.fromEntries(COMPARE_SYMBOLS.map((s, i) => [s.code, results[i]?.prices || null]))))
  }, [])

  const accCatMap = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
  const evalRows = accountEval.filter(r => r.accountId !== LOAN_ACCOUNT_ID)
  const loanRows = accountEval.filter(r => r.accountId === LOAN_ACCOUNT_ID)
  const summary = buildDailySummary(evalRows, loanRows, accCatMap)
  const evalDates = summary.map(s => s.date)

  useEffect(() => {
    if (chartFrom || !evalDates.length) return
    setChartFrom(evalDates[0])
    setChartTo(evalDates.at(-1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalDates.length])

  const chartSummary = summary.filter(s => (!chartFrom || s.date >= chartFrom) && (!chartTo || s.date <= chartTo))

  // 성과분석은 매매(운용) 관점이라 총자산(대출로 조달한 투자금까지 포함, 대출잔액 자체는 차감 안 함) 기준
  // 대출 증감은 투자원금 유출입이라 이체와 동일하게 TWR에서 제외 (순자산으로 미리 차감해버리면 이체 처리와 중복 상쇄됨)
  const transferEvents = buildTransferEvents(transactions, usdRate)
  const loanEvents = buildLoanTransferEvents(loanRows)
  const twr = computeTWR(chartSummary.map(s => s.date), chartSummary.map(s => s.totalBalance), [...transferEvents, ...loanEvents])
  // MDD/변동성/샤프는 입출금(대출 증감 포함)에 왜곡되지 않도록 raw 총자산이 아닌 TWR 조정 index로 계산
  const perfStats = twr ? computePerformanceStats(chartSummary.map(s => s.date), twr.index) : null

  const chartFirstTotal = chartSummary[0]?.totalBalance
  const chartLastTotal = chartSummary.at(-1)?.totalBalance
  const rawChangeRate = chartFirstTotal ? ((chartLastTotal - chartFirstTotal) / chartFirstTotal) * 100 : 0
  const rawChangeAmt = (chartLastTotal || 0) - (chartFirstTotal || 0)

  // 총자산(대출 미차감)과 비교 종목들을 기간 시작일=100 기준 지수로 정규화해 같은 그래프에 표시
  const totalByDate = new Map(chartSummary.map(s => [s.date, s.totalBalance]))
  const compareSeries = [
    { key: '총자산', dates: chartSummary.map(s => s.date), valueOf: d => totalByDate.get(d), color: '#3b82f6' },
    ...COMPARE_SYMBOLS
      .filter(s => comparePrices[s.code])
      .map(s => ({ key: s.label, dates: Object.keys(comparePrices[s.code]).sort(), valueOf: d => comparePrices[s.code][d], color: s.color })),
  ].filter(s => s.dates.length)

  const compareData = (() => {
    if (!compareSeries.length || !chartFrom || !chartTo) return []
    const bases = compareSeries.map(s => {
      const before = valueAtOrBefore(s.dates, s.valueOf, chartFrom)
      if (before !== undefined) return before
      const after = s.dates.find(d => d >= chartFrom)
      return after !== undefined ? s.valueOf(after) : undefined
    })
    const unionDates = [...new Set(compareSeries.flatMap(s => s.dates))].filter(d => d >= chartFrom && d <= chartTo).sort()
    return unionDates.map(date => {
      const point = { date }
      compareSeries.forEach((s, i) => {
        if (bases[i] === undefined) return
        const v = valueAtOrBefore(s.dates, s.valueOf, date)
        if (v !== undefined) point[s.key] = (v / bases[i]) * 100
      })
      return point
    })
  })()

  const realizedProfitByKey = new Map()
  for (const r of realizedProfits) {
    const key = `${r.date}_${r.accountId}_${r.code}`
    realizedProfitByKey.set(key, (realizedProfitByKey.get(key) || 0) + (r.realizedProfit || 0))
  }
  const allLots = buildClosedLots(transactions, realizedProfitByKey, usdRate)
  const periodLots = allLots.filter(l => (!chartFrom || l.exitDate >= chartFrom) && (!chartTo || l.exitDate <= chartTo))
  const expectancy = computeExpectancy(periodLots)
  const cashFlow = buildCashFlowSummary(transactions, transferEvents, chartFrom, chartTo, usdRate)

  // 종목별 손익 — 선택 기간 중 청산된 lot의 pnl을 종목코드 기준으로 합산 (종목별 손익 탭과 달리 기간 내 실현분만)
  const pnlByCode = new Map()
  for (const l of periodLots) {
    if (!pnlByCode.has(l.code)) pnlByCode.set(l.code, { code: l.code, name: l.name || l.code, pnl: 0, count: 0 })
    const e = pnlByCode.get(l.code)
    e.pnl += l.pnl
    e.count += 1
  }
  const stockPnlSorted = [...pnlByCode.values()].sort((a, b) => b.pnl - a.pnl)
  const topStocks = stockPnlSorted.slice(0, 5)
  const bottomStocks = [...stockPnlSorted].reverse().slice(0, 5)

  const taxPaymentsInPeriod = taxPayments.filter(t => (!chartFrom || t.date >= chartFrom) && (!chartTo || t.date <= chartTo))
  const capitalGainsTax = taxPaymentsInPeriod.filter(t => t.taxType?.includes('양도')).reduce((s, t) => s + (t.amount || 0), 0)
  const comprehensiveIncomeTax = taxPaymentsInPeriod.filter(t => t.taxType?.includes('종합소득')).reduce((s, t) => s + (t.amount || 0), 0)

  const realizedProfitInPeriod = realizedProfits
    .filter(r => (!chartFrom || r.date >= chartFrom) && (!chartTo || r.date <= chartTo))
    .reduce((s, r) => s + (r.realizedProfit || 0), 0)
  const totalCosts = cashFlow.feeTotal + cashFlow.taxTotal + capitalGainsTax + comprehensiveIncomeTax
  // 평가손익(미실현) = 기간 순잔액변화(이체·대출증감 제외) - 실현손익 - 배당/이자 + 비용 — 계좌평가 조회 탭과 동일한 잔여값 방식
  const periodExternalCashFlow = [...transferEvents, ...loanEvents]
    .filter(e => e.date > chartFrom && e.date <= chartTo)
    .reduce((s, e) => s + e.amountKrw, 0)
  const netBalanceChange = ((chartLastTotal || 0) - (chartFirstTotal || 0)) - periodExternalCashFlow
  const evalGainLossInPeriod = netBalanceChange - realizedProfitInPeriod - cashFlow.dividendTotal + totalCosts
  // 운용수익(비용 차감 전) = 실현손익 + 배당/이자수익 + 평가손익(미실현) / 순운용수익 = 운용수익 - 비용
  const grossInvestProfit = realizedProfitInPeriod + cashFlow.dividendTotal + evalGainLossInPeriod
  const netInvestProfit = grossInvestProfit - totalCosts

  if (loading) return <div className="loading">로딩 중...</div>
  if (loadError) return <div className="neg" style={{ padding: 20, fontSize: 13 }}>{loadError}</div>
  if (!evalDates.length) return <div className="empty">저장된 계좌별평가 데이터가 없습니다.</div>

  const pct = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  const cls = v => v >= 0 ? 'pos' : 'neg'

  const METRICS = [
    {
      label: '운용수익', value: fmt(grossInvestProfit), valCls: cls(grossInvestProfit),
      desc: '실현손익 + 배당/이자수익 + 평가손익(미실현) — 비용 차감 전',
    },
    {
      label: '순운용수익', value: fmt(netInvestProfit), valCls: cls(netInvestProfit),
      desc: '운용수익 − 수수료 − 거래세 − 양도소득세 − 종합소득세',
    },
    {
      label: '시작값', value: fmt(chartFirstTotal), valCls: '',
      desc: `총자산(대출 미차감) 기준 ${chartFrom} 값`,
    },
    {
      label: '종료값', value: fmt(chartLastTotal), valCls: '',
      desc: `총자산(대출 미차감) 기준 ${chartTo} 값`,
    },
    {
      label: '증감액', value: fmt(rawChangeAmt), valCls: cls(rawChangeAmt),
      desc: '총자산(대출 미차감) 기준 단순 시작~종료 증감금액 (raw, 이체/대출증감 미반영)',
    },
    {
      label: '기간 총증감률', value: pct(rawChangeRate / 100), valCls: cls(rawChangeRate),
      desc: '총자산(대출 미차감) 기준 단순 시작~종료 증감률 (raw, 이체/대출증감 미반영)',
    },
    {
      label: 'TWR (시간가중수익률)', value: twr ? pct(twr.total) : '-', valCls: twr ? cls(twr.total) : '',
      desc: '입출금(이체) 및 대출 증감(투자원금 유출입으로 간주) 제외한 순수 운용수익률 — 평가일 구간마다 해당 금액을 뺀 수익률을 기하연결',
    },
    {
      label: 'TWR 연환산 (CAGR)', value: twr ? pct(twr.annualized) : '-', valCls: twr ? cls(twr.annualized) : '',
      desc: 'TWR을 연 단위로 환산한 값 — 입출금 제외한 순수 연환산 수익률',
    },
    {
      label: 'MDD (최대낙폭)', value: perfStats ? pct(perfStats.mdd) : '-', valCls: 'neg',
      desc: '선택 기간 중 고점 대비 최대 하락폭 (입출금 제외, TWR 조정 기준)',
    },
    {
      label: '변동성', value: perfStats ? pct(perfStats.volatility) : '-', valCls: '',
      desc: '관측주기별 수익률 표준편차를 연환산한 값 (입출금 제외 기준) — 클수록 등락이 심함',
    },
    {
      label: '샤프지수', value: perfStats ? perfStats.sharpe.toFixed(2) : '-', valCls: perfStats ? cls(perfStats.sharpe) : '',
      desc: 'CAGR ÷ 변동성 (무위험수익률 0% 가정) — 위험 대비 수익 효율. 0 이상이어야 하고, 1 이상이면 꽤 좋은 편, 2 이상이면 우수, 3 이상이면 탁월한 수준',
    },
    {
      label: '소르티노 지수', value: perfStats ? perfStats.sortino.toFixed(2) : '-', valCls: perfStats ? cls(perfStats.sortino) : '',
      desc: 'CAGR ÷ 하방편차(손실 구간만의 변동성) — 샤프와 달리 상승 변동은 벌점에서 제외한 하방위험 조정 수익 효율. 기준은 샤프지수와 동일',
    },
  ]

  const CASH_FLOW_ROWS = [
    { label: '입금액', value: fmt(cashFlow.deposits), desc: '전 계좌 합산 이체 입금 (계좌간 내부이동 포함)' },
    { label: '출금액', value: fmt(cashFlow.withdrawals), desc: '전 계좌 합산 이체 출금 (계좌간 내부이동 포함, 상쇄되어 순입출금엔 영향 없음)' },
    { label: '순입출금액', value: fmt(cashFlow.netTransfer), desc: '입금액 − 출금액' },
    { label: '수익금 (배당/이자)', value: fmt(cashFlow.dividendTotal), desc: '배당금/분배금/이자/이용료 등 손익성 입출금 합계' },
    { label: '수수료', value: fmt(cashFlow.feeTotal), desc: '전 계좌 합산 거래 수수료' },
    { label: '거래세', value: fmt(cashFlow.taxTotal), desc: '전 계좌 합산 거래내 세금 (납부는 +, 환급은 −)' },
    { label: '양도소득세', value: fmt(capitalGainsTax), desc: '세금납부내역(이자·배당·세금) 중 양도소득세 납부액' },
    { label: '종합소득세', value: fmt(comprehensiveIncomeTax), desc: '세금납부내역(이자·배당·세금) 중 종합소득세 납부액' },
  ]

  const EXPECTANCY_ROWS = !expectancy ? [] : [
    { label: '청산 거래수', value: `${expectancy.count}건`, desc: `매수/매도를 FIFO로 매칭한 청산 라운드트립 수 (승 ${expectancy.winCount} / 패 ${expectancy.lossCount})` },
    { label: '승률', value: `${(expectancy.winRate * 100).toFixed(1)}%`, desc: '이익으로 청산된 거래 비율' },
    { label: '평균 이익', value: fmt(expectancy.avgWin), desc: '이익 거래의 평균 손익금액(원) — 실현손익 기준' },
    { label: '평균 손실', value: fmt(expectancy.avgLoss), desc: '손실 거래의 평균 손익금액' },
    { label: '손익비', value: expectancy.profitRatio === null ? '-' : expectancy.profitRatio === Infinity ? '∞' : expectancy.profitRatio.toFixed(2), desc: '평균이익 ÷ |평균손실| (Profit Factor)' },
    { label: '기대값', value: fmt(expectancy.expectancy), desc: '승률×평균이익 + 패률×평균손실' },
    { label: '최대 연속 손실 횟수', value: `${expectancy.maxConsecutiveLosses}건`, desc: '청산 거래를 시간순으로 볼 때 손실이 연속된 최대 횟수' },
  ]

  const stockRowsOf = rows => rows.map(r => ({ label: `${r.name} (${r.code})`, value: fmt(r.pnl), desc: `거래건수 ${r.count}건` }))
  const TOP_STOCK_ROWS = stockRowsOf(topStocks)
  const BOTTOM_STOCK_ROWS = stockRowsOf(bottomStocks)

  const handleExport = () => {
    const toRows = (section, rows) => rows.map(r => ({ 구분: section, 지표: r.label, 값: r.value, 설명: r.desc }))
    const rows = [
      ...toRows('입출금 분석', CASH_FLOW_ROWS),
      ...toRows('성과 지표', METRICS),
      ...toRows('거래 기대값', EXPECTANCY_ROWS),
      ...toRows('종목별 손익 상위 5', TOP_STOCK_ROWS),
      ...toRows('종목별 손익 하위 5', BOTTOM_STOCK_ROWS),
    ]
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '성과분석')
    XLSX.writeFile(wb, `성과분석_${chartFrom}_${chartTo}.xlsx`)
  }

  const handleCopy = async () => {
    const toText = (section, rows) => `[${section}]\n` + rows.map(r => `${r.label}: ${r.value} (${r.desc})`).join('\n')
    const text = [
      `성과분석 — ${chartFrom} ~ ${chartTo}`,
      toText('입출금 분석', CASH_FLOW_ROWS),
      toText('성과 지표', METRICS),
      toText('거래 기대값', EXPECTANCY_ROWS),
      toText('종목별 손익 상위 5', TOP_STOCK_ROWS),
      toText('종목별 손익 하위 5', BOTTOM_STOCK_ROWS),
    ].join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">기간</span>
          <input type="date" value={chartFrom} min={evalDates[0]} max={evalDates.at(-1)} onChange={e => setChartFrom(e.target.value)} className="input input-sm" />
          <span className="tool-label">~</span>
          <input type="date" value={chartTo} min={evalDates[0]} max={evalDates.at(-1)} onChange={e => setChartTo(e.target.value)} className="input input-sm" />
        </div>
        <div className="tool-right">
          <button className="btn btn-outline btn-sm" onClick={handleCopy}>{copied ? '복사됨' : '클립보드 복사'}</button>
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>데이터 엑셀 다운로드</button>
        </div>
      </div>

      {compareData.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h3 className="section-title">총자산 변동 추이 (지수, 로그)</h3>
              <span className={cls(rawChangeRate)} style={{ fontSize: 13 }}>
                {pct(rawChangeRate / 100)} ({rawChangeAmt >= 0 ? '+' : ''}{fmt(rawChangeAmt)}원)
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={compareData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis scale="log" domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v.toFixed(0)} width={45} />
              <Tooltip content={<CompareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {compareSeries.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="section-header">
          <h3 className="section-title">입출금 분석 — {chartFrom} ~ {chartTo}</h3>
        </div>
        <div className="table-wrap">
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 200 }}>항목</th>
                <th className="r" style={{ width: 140 }}>금액</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="bold">입금액</td>
                <td className="r bold pos">{fmt(cashFlow.deposits)}</td>
                <td className="dim" style={{ fontSize: 12 }}>전 계좌 합산 이체 입금 (계좌간 내부이동 포함)</td>
              </tr>
              <tr>
                <td className="bold">출금액</td>
                <td className="r bold neg">{fmt(cashFlow.withdrawals)}</td>
                <td className="dim" style={{ fontSize: 12 }}>전 계좌 합산 이체 출금 (계좌간 내부이동 포함, 상쇄되어 순입출금엔 영향 없음)</td>
              </tr>
              <tr>
                <td className="bold">순입출금액</td>
                <td className={'r bold ' + cls(cashFlow.netTransfer)}>{fmt(cashFlow.netTransfer)}</td>
                <td className="dim" style={{ fontSize: 12 }}>입금액 − 출금액</td>
              </tr>
              <tr>
                <td className="bold">수익금 (배당/이자)</td>
                <td className="r bold pos">{fmt(cashFlow.dividendTotal)}</td>
                <td className="dim" style={{ fontSize: 12 }}>배당금/분배금/이자/이용료 등 손익성 입출금 합계</td>
              </tr>
              <tr>
                <td className="bold">수수료</td>
                <td className="r bold neg">{fmt(cashFlow.feeTotal)}</td>
                <td className="dim" style={{ fontSize: 12 }}>전 계좌 합산 거래 수수료</td>
              </tr>
              <tr>
                <td className="bold">거래세</td>
                <td className="r bold neg">{fmt(cashFlow.taxTotal)}</td>
                <td className="dim" style={{ fontSize: 12 }}>전 계좌 합산 거래내 세금 (납부는 +, 환급은 −)</td>
              </tr>
              <tr>
                <td className="bold">양도소득세</td>
                <td className="r bold neg">{fmt(capitalGainsTax)}</td>
                <td className="dim" style={{ fontSize: 12 }}>세금납부내역(이자·배당·세금) 중 양도소득세 납부액</td>
              </tr>
              <tr>
                <td className="bold">종합소득세</td>
                <td className="r bold neg">{fmt(comprehensiveIncomeTax)}</td>
                <td className="dim" style={{ fontSize: 12 }}>세금납부내역(이자·배당·세금) 중 종합소득세 납부액</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3 className="section-title">성과 지표 — {chartFrom} ~ {chartTo}</h3>
        </div>
        <div className="table-wrap">
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 200 }}>지표</th>
                <th className="r" style={{ width: 140 }}>값</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => (
                <tr key={m.label}>
                  <td className="bold">{m.label}</td>
                  <td className={'r bold ' + m.valCls}>{m.value}</td>
                  <td className="dim" style={{ fontSize: 12 }}>{m.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3 className="section-title">거래 기대값 (Mathematical Expectancy)</h3>
        </div>
        {!expectancy ? (
          <p className="dim">선택 기간에 청산된 거래가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>지표</th>
                  <th className="r" style={{ width: 140 }}>값</th>
                  <th>설명</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="bold">청산 거래수</td>
                  <td className="r bold">{expectancy.count}건</td>
                  <td className="dim" style={{ fontSize: 12 }}>매수/매도를 FIFO로 매칭한 청산 라운드트립 수 (승 {expectancy.winCount} / 패 {expectancy.lossCount})</td>
                </tr>
                <tr>
                  <td className="bold">승률</td>
                  <td className="r bold">{(expectancy.winRate * 100).toFixed(1)}%</td>
                  <td className="dim" style={{ fontSize: 12 }}>이익으로 청산된 거래 비율</td>
                </tr>
                <tr>
                  <td className="bold">평균 이익</td>
                  <td className="r bold pos">{fmt(expectancy.avgWin)}</td>
                  <td className="dim" style={{ fontSize: 12 }}>이익 거래의 평균 손익금액(원) — 실현손익(브로커 리포트, 수수료/세금 반영) 기준. 매칭되는 실현손익이 없는 극소수 건은 가격차×수량 근사치</td>
                </tr>
                <tr>
                  <td className="bold">평균 손실</td>
                  <td className="r bold neg">{fmt(expectancy.avgLoss)}</td>
                  <td className="dim" style={{ fontSize: 12 }}>손실 거래의 평균 손익금액</td>
                </tr>
                <tr>
                  <td className="bold">손익비</td>
                  <td className="r bold">{expectancy.profitRatio === null ? '-' : expectancy.profitRatio === Infinity ? '∞' : expectancy.profitRatio.toFixed(2)}</td>
                  <td className="dim" style={{ fontSize: 12 }}>평균이익 ÷ |평균손실| (Profit Factor) — 1 이상이어야 손익분기 이상, 1.5~2면 양호, 2 이상이면 우수한 편</td>
                </tr>
                <tr>
                  <td className="bold">기대값</td>
                  <td className={'r bold ' + (expectancy.expectancy >= 0 ? 'pos' : 'neg')}>{fmt(expectancy.expectancy)}</td>
                  <td className="dim" style={{ fontSize: 12 }}>승률×평균이익 + 패률×평균손실 — 거래 1건당 평균 기대손익, 양수면 장기적으로 우위</td>
                </tr>
                <tr>
                  <td className="bold">최대 연속 손실 횟수</td>
                  <td className="r bold neg">{expectancy.maxConsecutiveLosses}건</td>
                  <td className="dim" style={{ fontSize: 12 }}>청산 거래를 시간순으로 볼 때 손실이 연속된 최대 횟수 — 클수록 심리적/자금 관리 부담 큼</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-row" style={{ marginTop: 16 }}>
        {[
          { title: '종목별 손익 상위 5', rows: topStocks },
          { title: '종목별 손익 하위 5', rows: bottomStocks },
        ].map(({ title, rows }) => (
          <div key={title} className="card">
            <div className="section-header">
              <h3 className="section-title">{title}</h3>
            </div>
            {!rows.length ? (
              <p className="dim">선택 기간에 청산된 거래가 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>종목</th>
                      <th className="r" style={{ width: 140 }}>손익</th>
                      <th className="r" style={{ width: 90 }}>거래건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.code}>
                        <td>{r.name} ({r.code})</td>
                        <td className={'r bold ' + cls(r.pnl)}>{fmt(r.pnl)}</td>
                        <td className="r">{r.count}건</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
