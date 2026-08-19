// 종목별 조회 탭 (DataView) — 종목 하나를 선택해 계좌 통합 거래내역을 기간별로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { getAllTransactions, getAllRealizedProfits } from '../../utils/firestore'
import { getPriceSeries, downloadMissingRange } from '../../utils/priceData'
import { fmt } from './shared'

function TradeDot({ cx, cy, payload }) {
  if (!payload.tradeType) return null
  const color = payload.tradeType === 'buy' ? '#22c55e' : payload.tradeType === 'sell' ? '#ef4444' : '#a855f7'
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#0f172a" strokeWidth={1} />
}

// range([low,high]) Bar의 x/y/width/height는 recharts가 이미 고가~저가 구간의 픽셀 좌표로 계산해줌 —
// 그 안에서 시가/종가 위치를 선형보간해 몸통(사각형)+꼬리(수직선)를 직접 그림
function Candle({ x, y, width, height, payload }) {
  const { open, high, low, close } = payload
  if (high == null || low == null || high === low) {
    return <line x1={x} x2={x + width} y1={y + height / 2} y2={y + height / 2} stroke="#64748b" strokeWidth={1} />
  }
  const up = close >= open
  const color = up ? '#22c55e' : '#ef4444'
  const scale = height / (high - low)
  const yOpen = y + (high - open) * scale
  const yClose = y + (high - close) * scale
  const bodyY = Math.min(yOpen, yClose)
  const bodyH = Math.max(Math.abs(yClose - yOpen), 1)
  const bodyX = x + width * 0.2
  const bodyW = width * 0.6
  return (
    <g>
      <line x1={x + width / 2} x2={x + width / 2} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={color} />
    </g>
  )
}

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0]?.payload
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>{label}</p>
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>시가 {fmt(p.open)} · 고가 {fmt(p.high)} · 저가 {fmt(p.low)}</p>
      <p style={{ color: '#3b82f6', margin: '2px 0' }}>종가: {fmt(p.close)}</p>
      {p.buyQty > 0 && <p style={{ color: '#22c55e', margin: '2px 0', fontWeight: 700 }}>매수 {fmt(p.buyQty)}주</p>}
      {p.sellQty > 0 && <p style={{ color: '#ef4444', margin: '2px 0', fontWeight: 700 }}>매도 {fmt(p.sellQty)}주</p>}
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>잔량 {fmt(p.qtyBalance)}주</p>
    </div>
  )
}

// ── 종목별 조회 탭 ───────────────────────────────────────────
export default function StockPeriodTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [profitMap, setProfitMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [priceSeries, setPriceSeries] = useState(null)
  const [priceLoading, setPriceLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([getAllTransactions(user.uid), getAllRealizedProfits(user.uid)]).then(([rows, realized]) => {
      const map = new Map()
      for (const r of realized) {
        const key = `${r.date}_${r.accountId}_${r.code}`
        map.set(key, (map.get(key) || 0) + (r.realizedProfit || 0))
      }
      setData(rows)
      setProfitMap(map)
      setLoading(false)
    })
  }, [])

  const stockRows = data.filter(r => r.code) // 종목코드 없는 입출금/선물옵션 결제 등은 제외

  const nameByCode = new Map()
  for (const r of stockRows) nameByCode.set(r.code, r.name || nameByCode.get(r.code))
  const options = [...nameByCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  useEffect(() => {
    if (!selectedCode && options.length) setSelectedCode(options[0].code)
  }, [options.length])

  const [symbolQuery, setSymbolQuery] = useState('')
  const [showSymbolList, setShowSymbolList] = useState(false)
  useEffect(() => {
    const opt = options.find(o => o.code === selectedCode)
    setSymbolQuery(opt ? `${opt.name} (${opt.code})` : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode])
  const symbolMatches = options.filter(o =>
    o.code.toLowerCase().includes(symbolQuery.trim().toLowerCase()) || (o.name || '').toLowerCase().includes(symbolQuery.trim().toLowerCase())
  )
  const selectSymbol = (code) => {
    setSelectedCode(code)
    setShowSymbolList(false)
  }

  // 종목 선택/기간이 정해지면 없는 구간을 키움에서 자동으로 받아온 뒤 가격 데이터 표시
  useEffect(() => {
    if (!selectedCode || !fromDate || !toDate) { setPriceSeries(null); return }
    let cancelled = false
    setPriceLoading(true)
    const codeName = options.find(o => o.code === selectedCode)?.name || selectedCode
    downloadMissingRange(user.uid, selectedCode, codeName, fromDate, toDate)
      .catch(() => {}) // 키움 미지원 종목 등은 무시하고 기존 캐시만 표시
      .then(() => getPriceSeries(user.uid, selectedCode))
      .then(series => { if (!cancelled) setPriceSeries(series) })
      .finally(() => { if (!cancelled) setPriceLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, selectedCode, fromDate, toDate])

  const allRows = stockRows.filter(r => r.code === selectedCode).sort((a, b) => b.date.localeCompare(a.date))

  useEffect(() => {
    if (!allRows.length) return
    const dates = allRows.map(r => r.date).sort()
    setFromDate(dates[0])
    setToDate(dates.at(-1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode])

  const filtered = allRows.filter(r => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))

  const tradeByDate = new Map()
  for (const r of filtered) {
    const entry = tradeByDate.get(r.date) || { buyQty: 0, sellQty: 0 }
    if (/매수/.test(r.type)) entry.buyQty += r.qty || 0
    else if (/매도/.test(r.type)) entry.sellQty += r.qty || 0
    else continue
    tradeByDate.set(r.date, entry)
  }

  // 전체 거래이력(기간 제한 없이)으로 날짜별 누적 보유잔량을 구해, 가격 데이터 날짜에 최근값으로 채워넣음(forward-fill)
  const ascRows = allRows.slice().sort((a, b) => a.date.localeCompare(b.date))
  const balanceByDate = new Map()
  let running = 0
  for (const r of ascRows) {
    if (/매수/.test(r.type)) running += r.qty || 0
    else if (/매도/.test(r.type)) running -= r.qty || 0
    else continue
    balanceByDate.set(r.date, running)
  }
  const txDatesAsc = [...balanceByDate.keys()].sort()

  const chartData = priceSeries
    ? (() => {
      const dates = Object.keys(priceSeries.prices).filter(d => (!fromDate || d >= fromDate) && (!toDate || d <= toDate)).sort()
      let txIdx = 0, qtyBalance = 0
      return dates.map(d => {
        while (txIdx < txDatesAsc.length && txDatesAsc[txIdx] <= d) { qtyBalance = balanceByDate.get(txDatesAsc[txIdx]); txIdx++ }
        const t = tradeByDate.get(d)
        const tradeType = t ? (t.buyQty > 0 && t.sellQty > 0 ? 'both' : t.buyQty > 0 ? 'buy' : 'sell') : null
        const close = priceSeries.prices[d]
        // 구버전 캐시(종가만 저장됨)나 CSV로 등록된 종목은 시가/고가/저가가 없을 수 있음 — 이땐 종가로 대체(납작한 캔들)
        const open = priceSeries.opens?.[d] ?? close
        const high = priceSeries.highs?.[d] ?? close
        const low = priceSeries.lows?.[d] ?? close
        return { date: d, open, high, low, close, range: [low, high], tradeType, buyQty: t?.buyQty || 0, sellQty: t?.sellQty || 0, qtyBalance }
      })
    })()
    : []

  // 거래 자체에 청산손익이 있으면 그 건은 청산손익을 실현손익으로 사용, 없으면 매도 거래에 한해 실현손익 리포트(profitMap) 조회
  // (배당금입금 등 매도 아닌 거래는 같은 일자·계좌·종목 키를 공유해도 실현손익과 무관하므로 제외 — 안 그러면 동일 실현손익이 여러 row에 중복 표시됨)
  const realizedOf = (r) => r.profit || (/매도/.test(r.type) ? profitMap.get(`${r.date}_${r.accountId}_${r.code}`) : undefined)
  let totalRealized = 0
  const matchedKeys = new Set()
  for (const r of filtered) {
    if (r.profit) {
      totalRealized += r.profit
    } else if (/매도/.test(r.type)) {
      const key = `${r.date}_${r.accountId}_${r.code}`
      if (!matchedKeys.has(key)) {
        matchedKeys.add(key)
        totalRealized += profitMap.get(key) || 0
      }
    }
  }

  const handleExport = () => {
    const rows = filtered.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      거래종류: r.type,
      통화: r.currency,
      수량: r.qty,
      거래금액: r.amount,
      수수료: r.fee,
      세금: r.tax,
      청산손익: r.profit,
      실현손익: realizedOf(r),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '종목별조회')
    XLSX.writeFile(wb, `종목별조회_${selectedCode}.xlsx`)
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!options.length) return <div className="empty">저장된 거래내역이 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">종목</span>
          <div style={{ position: 'relative', width: 260 }}>
            <input
              className="input input-sm"
              style={{ width: 260 }}
              value={symbolQuery}
              onChange={e => { setSymbolQuery(e.target.value); setShowSymbolList(true) }}
              onFocus={() => { setSymbolQuery(''); setShowSymbolList(true) }}
              onBlur={() => setTimeout(() => {
                setShowSymbolList(false)
                const opt = options.find(o => o.code === selectedCode)
                setSymbolQuery(opt ? `${opt.name} (${opt.code})` : '')
              }, 150)}
              placeholder="종목명 또는 코드 입력"
            />
            {showSymbolList && symbolMatches.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
                {symbolMatches.map(o => (
                  <div key={o.code}
                    onMouseDown={() => selectSymbol(o.code)}
                    style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, background: o.code === selectedCode ? '#1d4ed8' : 'transparent' }}
                  >
                    {o.name} ({o.code})
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="tool-label">기간</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
          <span className="tool-label">~</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
        </div>
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
        </div>
      </div>

      {priceLoading ? (
        <p className="dim" style={{ fontSize: 12, marginBottom: 16 }}>{selectedCode}: 키움에서 가격 데이터 가져오는 중...</p>
      ) : chartData.length > 0 ? (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="section-header">
            <h3 className="section-title">가격 추이 — {selectedCode}</h3>
            <span className="dim" style={{ fontSize: 12 }}>
              <span style={{ color: '#22c55e' }}>● 매수</span> &nbsp; <span style={{ color: '#ef4444' }}>● 매도</span> &nbsp; <span style={{ color: '#a855f7' }}>● 매수+매도</span>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 11 }} width={55} />
              <Tooltip content={<PriceTooltip />} />
              <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
              <Line type="monotone" dataKey="close" stroke="none" dot={<TradeDot />} activeDot={false} isAnimationActive={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="dim" style={{ fontSize: 12, marginBottom: 16 }}>{selectedCode}: 가격 데이터를 찾을 수 없습니다 (키움 미지원 종목일 수 있음 — 데이터 관리 &gt; 종목관리 탭에서 CSV로 직접 등록 가능).</p>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>모든 계좌 통합 거래내역입니다.</p>
        <p style={{ margin: 0 }}>
          실현손익 합계 <span className={'bold ' + (totalRealized > 0 ? 'pos' : totalRealized < 0 ? 'neg' : '')}>{fmt(totalRealized)}</span>
        </p>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>계좌</th>
              <th>거래종류</th>
              <th>통화</th>
              <th className="r">수량</th>
              <th className="r">거래금액</th>
              <th className="r">수수료</th>
              <th className="r">세금</th>
              <th className="r">청산손익</th>
              <th className="r">실현손익(원)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const rp = realizedOf(row)
              return (
                <tr key={row.docId}>
                  <td>{row.date}</td>
                  <td>{row.accountId}</td>
                  <td>{row.type}</td>
                  <td>{row.currency}</td>
                  <td className="r">{row.qty ? fmt(row.qty) : '-'}</td>
                  <td className="r">{fmt(row.amount)}</td>
                  <td className="r">{fmt(row.fee)}</td>
                  <td className="r">{fmt(row.tax)}</td>
                  <td className="r">{row.profit ? fmt(row.profit) : '-'}</td>
                  <td className={'r ' + (rp > 0 ? 'pos' : rp < 0 ? 'neg' : '')}>{rp != null ? fmt(rp) : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
