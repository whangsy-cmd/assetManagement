// 종목별 조회 탭 (DataView) — 종목 하나를 선택해 계좌 통합 거래내역을 기간별로 조회
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getAllTransactions, getAllRealizedProfits } from '../../utils/firestore'
import { fmt } from './shared'

// ── 종목별 조회 탭 ───────────────────────────────────────────
export default function StockPeriodTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [profitMap, setProfitMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

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

  const allRows = stockRows.filter(r => r.code === selectedCode).sort((a, b) => b.date.localeCompare(a.date))

  useEffect(() => {
    if (!allRows.length) return
    const dates = allRows.map(r => r.date).sort()
    setFromDate(dates[0])
    setToDate(dates.at(-1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode])

  const filtered = allRows.filter(r => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))
  const realizedOf = (r) => profitMap.get(`${r.date}_${r.accountId}_${r.code}`)
  const matchedKeys = new Set(filtered.map(r => `${r.date}_${r.accountId}_${r.code}`))
  const totalRealized = [...matchedKeys].reduce((s, k) => s + (profitMap.get(k) || 0), 0)

  if (loading) return <div className="loading">로딩 중...</div>
  if (!options.length) return <div className="empty">저장된 거래내역이 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">종목 선택</span>
          <select value={selectedCode} onChange={e => setSelectedCode(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            {options.map(o => (
              <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
            ))}
          </select>
          <span className="tool-label">기간</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
          <span className="tool-label">~</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
        </div>
      </div>

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
              <th className="r">실현손익</th>
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
