// 일자별 계좌 탭 (DataView) — 선택 날짜의 계좌별평가(accountEval)를 계좌별로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllAccountEval } from '../../utils/firestore'
import { fmt, DateSelect, styles } from './shared'

// ── 일자별 계좌 탭 ───────────────────────────────────────────
export default function CashTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')

  const load = async () => {
    setLoading(true)
    const rows = await getAllAccountEval(user.uid)
    setData(rows)
    if (rows.length && !selectedDate) setSelectedDate([...new Set(rows.map(d => d.date))].sort().at(-1))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data.filter(d => d.date === selectedDate)

  const handleExport = () => {
    const rows = [...data].sort((a, b) =>
      b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId)
    ).map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목평가금액: r.evalAmt,
      예수금: r.cashAmt,
      총액: r.totalAmt,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '일자별계좌')
    XLSX.writeFile(wb, '일자별계좌_전체.xlsx')
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!data.length) return <div style={styles.empty}>저장된 계좌별평가 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>날짜 선택</span>
          <DateSelect id="cash-dates" dates={dates} value={selectedDate} onChange={setSelectedDate} />
        </div>
        <div style={styles.toolRight}>
          <button style={styles.exportBtn} onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>계좌</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>총액</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.accountId}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}원</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.cashAmt)}원</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalAmt)}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
