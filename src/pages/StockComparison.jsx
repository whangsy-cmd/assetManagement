// 종목 비교 — 저장된 종목 시세와 계좌통합 총자산의 순수 운용수익(TWR, 입출금/대출증감 제외)을 같은 기준(시작일=100)으로 비교
import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import { getSavedSymbols, getPriceSeries } from '../utils/priceData'
import { getAllAccountEval, getAllTransactions } from '../utils/firestore'
import { getUsdKrwRate } from '../utils/exchangeRate'
import { LOAN_ACCOUNT_ID, buildDailySummary } from '../utils/holdingsAgg'
import { buildTransferEvents, buildLoanTransferEvents, computeTWR } from '../utils/finance'
import { fmt, sgn, pc } from '../utils/format'
import InputField, { numInputStyle } from '../components/InputField'
import '../common.css'

const NET_WORTH_LABEL = '총자산(TWR)'

// 날짜순 정렬된 series(Map<date, value>)에서 targetDate 이전(포함) 최근값을 찾음 — 스냅샷 주기가 다른 두 시계열을 같은 x축에 올리기 위한 forward-fill
function valueAtOrBefore(sortedDates, valueOf, targetDate) {
  let result
  for (const d of sortedDates) {
    if (d > targetDate) break
    result = valueOf(d)
  }
  return result
}

// netIndexByDate: TWR 조정 지수(입출금/대출증감 제외 순수 운용수익, 시작=1) — 등락률(%) 산출용
// netRawByDate: 실제 총자산(원) — 툴팁 표시용, 등락률 계산에는 쓰지 않음
function buildComparisonData(stockPrices, netIndexByDate, netRawByDate, fromDate, toDate) {
  const stockDates = Object.keys(stockPrices).filter(d => d >= fromDate && d <= toDate).sort()
  const netDates = [...netIndexByDate.keys()].filter(d => d >= fromDate && d <= toDate).sort()
  if (!stockDates.length || !netDates.length) return null

  const startDate = stockDates[0] > netDates[0] ? stockDates[0] : netDates[0]
  const stockBase = valueAtOrBefore(stockDates, d => stockPrices[d], startDate)
  const netBase = valueAtOrBefore(netDates, d => netIndexByDate.get(d), startDate)

  const unionDates = [...new Set([...stockDates, ...netDates])].filter(d => d >= startDate).sort()
  const chartData = unionDates.map(date => {
    const stockVal = valueAtOrBefore(stockDates, d => stockPrices[d], date)
    const netVal = valueAtOrBefore(netDates, d => netIndexByDate.get(d), date)
    const netRawVal = valueAtOrBefore(netDates, d => netRawByDate.get(d), date)
    return {
      date,
      [NET_WORTH_LABEL]: (netVal / netBase) * 100,
      stockPct: (stockVal / stockBase) * 100,
      stockRaw: stockVal,
      netRaw: netRawVal,
    }
  })

  let lowPoint = chartData[0]
  for (const p of chartData) if (p.stockPct < lowPoint.stockPct) lowPoint = p

  return {
    chartData,
    fromDate: startDate,
    toDate: unionDates.at(-1),
    stockFinalPct: chartData.at(-1).stockPct - 100,
    netFinalPct: chartData.at(-1)[NET_WORTH_LABEL] - 100,
    lowDate: lowPoint.date,
    riseFromLowPct: (chartData.at(-1).stockPct / lowPoint.stockPct - 1) * 100,
  }
}

function CompareTooltip({ active, payload, label, stockLabel, isUsd, usdRate }) {
  if (!active || !payload || !payload.length) return null
  const stockP = payload.find(p => p.dataKey === 'stockPct')
  const netP = payload.find(p => p.dataKey === NET_WORTH_LABEL)
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>
      {stockP && (
        <p style={{ color: stockP.color, margin: '2px 0' }}>
          {stockLabel}: {stockP.value.toFixed(1)}% ({fmt(isUsd ? stockP.payload.stockRaw * (usdRate || 0) : stockP.payload.stockRaw)}원)
        </p>
      )}
      {netP && (
        <p style={{ color: netP.color, margin: '2px 0' }}>
          {NET_WORTH_LABEL}: {netP.value.toFixed(1)}% ({fmt(netP.payload.netRaw)}원)
        </p>
      )}
    </div>
  )
}

export default function StockComparison() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [savedSymbols, setSavedSymbols] = useState([])
  const [accountEval, setAccountEval] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stockPrices, setStockPrices] = useState(null)
  const [usdRate, setUsdRate] = useState(null)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([getSavedSymbols(user.uid), getAllAccountEval(user.uid), getAllTransactions(user.uid)]).then(([symbols, evalRows, txRows]) => {
      setSavedSymbols(symbols)
      setAccountEval(evalRows)
      setTransactions(txRows)
      setLoading(false)
    })
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    getUsdKrwRate(today).then(setUsdRate).catch(() => setUsdRate(null))
  }, [user])

  // 총자산(계좌통합)의 순수 운용수익(TWR) 지수 — 입출금/대출증감 제외, 성과분석 탭과 동일 정의로 재사용
  const { netIndexByDate, netRawByDate, netDatesSorted } = useMemo(() => {
    if (!accountEval.length) return { netIndexByDate: new Map(), netRawByDate: new Map(), netDatesSorted: [] }
    const accCatMap = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
    const evalRows = accountEval.filter(r => r.accountId !== LOAN_ACCOUNT_ID)
    const loanRows = accountEval.filter(r => r.accountId === LOAN_ACCOUNT_ID)
    const summary = buildDailySummary(evalRows, loanRows, accCatMap)
    const dates = summary.map(s => s.date)
    const transferEvents = [...buildTransferEvents(transactions, usdRate), ...buildLoanTransferEvents(loanRows)]
    const twr = computeTWR(dates, summary.map(s => s.totalBalance), transferEvents)
    return {
      netIndexByDate: new Map(dates.map((d, i) => [d, twr ? twr.index[i] : 1])),
      netRawByDate: new Map(summary.map(s => [s.date, s.totalBalance])),
      netDatesSorted: dates,
    }
  }, [accountEval, transactions, accounts, usdRate])

  const symbol = savedSymbols.find(s => s.code === selectedCode)

  useEffect(() => {
    if (!user || !selectedCode) { setStockPrices(null); return }
    getPriceSeries(user.uid, selectedCode).then(series => setStockPrices(series?.prices || null))
  }, [user, selectedCode])

  // 종목 선택이 바뀌면 종목 데이터와 총자산 데이터가 겹치는 구간으로 기간 초기값 설정
  useEffect(() => {
    if (!symbol || !netDatesSorted.length) return
    const from = symbol.minDate > netDatesSorted[0] ? symbol.minDate : netDatesSorted[0]
    const to = symbol.maxDate < netDatesSorted.at(-1) ? symbol.maxDate : netDatesSorted.at(-1)
    setDateFrom(from)
    setDateTo(to)
  }, [selectedCode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePick = (e) => {
    const s = savedSymbols.find(s => s.code === e.target.value)
    setSelectedCode(s?.code || '')
    setSelectedName(s?.name || '')
  }

  const result = useMemo(() => {
    if (!stockPrices || !dateFrom || !dateTo || !netIndexByDate.size) return null
    return buildComparisonData(stockPrices, netIndexByDate, netRawByDate, dateFrom, dateTo)
  }, [stockPrices, netIndexByDate, netRawByDate, dateFrom, dateTo])

  const stockLabel = selectedName || selectedCode

  if (!user) return null
  if (loading) return <div className="loading">로딩 중...</div>

  return (
    <div>
      {!savedSymbols.length ? (
        <p className="dim">저장된 종목이 없습니다. 시뮬레이션 &gt; 종목관리 탭에서 먼저 가격 데이터를 받아오세요.</p>
      ) : !netIndexByDate.size ? (
        <p className="dim">저장된 계좌별평가 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="form-row" style={{ gap: 20, alignItems: 'flex-end' }}>
              <InputField label="종목">
                <select value={selectedCode} onChange={handlePick} style={{ ...numInputStyle, width: 220 }}>
                  <option value="">종목...</option>
                  {savedSymbols.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                </select>
              </InputField>
              <InputField label="시작일">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={numInputStyle} />
              </InputField>
              <InputField label="종료일">
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={numInputStyle} />
              </InputField>
            </div>
            {symbol && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{symbol.code} 보유 구간: {symbol.minDate} ~ {symbol.maxDate}</p>}
          </div>

          {!selectedCode ? (
            <p className="dim">종목을 선택하세요.</p>
          ) : !result ? (
            <p className="text-error">선택한 기간에 겹치는 데이터가 없습니다.</p>
          ) : (
            <div className="card">
              <div className="section-header">
                <h3 className="section-title">결과 — {result.fromDate} ~ {result.toDate}</h3>
              </div>
              <div className="summary-bar" style={{ marginBottom: 12 }}>
                <div className="summary-item">
                  <span className="summary-label">{stockLabel} 등락률</span>
                  <span className={`summary-item-val ${pc(result.stockFinalPct)}`}>{sgn(result.stockFinalPct)}{result.stockFinalPct.toFixed(1)}%</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">{stockLabel} 최저점 대비 상승률</span>
                  <span className={`summary-item-val ${pc(result.riseFromLowPct)}`}>{sgn(result.riseFromLowPct)}{result.riseFromLowPct.toFixed(1)}%</span>
                  <span className="summary-sub">최저점 {result.lowDate}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">{NET_WORTH_LABEL} 등락률</span>
                  <span className={`summary-item-val ${pc(result.netFinalPct)}`}>{sgn(result.netFinalPct)}{result.netFinalPct.toFixed(1)}%</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={result.chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(0, 7)} />
                  <YAxis scale="log" domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v.toFixed(0)} width={45} />
                  <Tooltip content={<CompareTooltip stockLabel={stockLabel} isUsd={symbol?.market === 'US'} usdRate={usdRate} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="stockPct" name={stockLabel} stroke="#ef4444" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey={NET_WORTH_LABEL} stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
