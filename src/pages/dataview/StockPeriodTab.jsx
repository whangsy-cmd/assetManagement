// 종목별 조회 탭 (DataView) — 종목 하나를 선택해 계좌 합산 기준 기간별 시계열 조회
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getAllHoldings } from '../../utils/firestore'
import { buildStockSeries } from '../../utils/holdingsAgg'
import { fmt, styles } from './shared'

// ── 종목별 조회 탭 ───────────────────────────────────────────
export default function StockPeriodTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    setLoading(true)
    getAllHoldings(user.uid).then(rows => { setData(rows); setLoading(false) })
  }, [])

  const byCode = buildStockSeries(data)
  const options = [...byCode.values()]
    .map(entry => {
      const dates = [...entry.byDate.keys()].sort()
      const latestEvalAmt = entry.byDate.get(dates.at(-1))?.evalAmt || 0
      return { code: entry.code, name: entry.name, latestEvalAmt }
    })
    .sort((a, b) => b.latestEvalAmt - a.latestEvalAmt)

  useEffect(() => {
    if (!selectedCode && options.length) setSelectedCode(options[0].code)
  }, [options.length])

  const entry = byCode.get(selectedCode)
  const allRows = entry
    ? [...entry.byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
    : []

  useEffect(() => {
    if (!entry) return
    const dates = [...entry.byDate.keys()].sort()
    setFromDate(dates[0])
    setToDate(dates.at(-1))
  }, [selectedCode])

  const filtered = allRows.filter(r => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!options.length) return <div style={styles.empty}>저장된 보유종목 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>종목 선택</span>
          <select value={selectedCode} onChange={e => setSelectedCode(e.target.value)} style={styles.stockSelect}>
            {options.map(o => (
              <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
            ))}
          </select>
          <span style={styles.toolLabel}>기간</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={styles.dateInput} />
          <span style={styles.toolLabel}>~</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={styles.dateInput} />
        </div>
      </div>

      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>모든 계좌 합산 기준입니다.</p>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>날짜</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>수량</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>매입금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>평가금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>평가손익</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>수익률</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const returnRate = row.purchaseAmt > 0 ? (row.gainLoss / row.purchaseAmt) * 100 : 0
              return (
                <tr key={row.date} style={styles.tr}>
                  <td style={styles.td}>{row.date}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.qty)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.purchaseAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: row.gainLoss >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.gainLoss)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: returnRate >= 0 ? '#4ade80' : '#f87171' }}>{returnRate.toFixed(2)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
