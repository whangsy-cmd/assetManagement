// 종목별 조회 탭 (DataView) — 종목 하나를 선택해 계좌 통합 거래내역을 기간별로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
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
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
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
