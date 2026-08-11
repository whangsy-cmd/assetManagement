// 계좌별 조회 탭 (DataView) — 계좌별평가(accountEval) 원본을 계좌 단위로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllAccountEval, deleteDocument } from '../../utils/firestore'
import { fmt, styles } from './shared'

// ── 계좌평가 조회 탭 (계좌별평가 테이블 원본 조회) ────────────────
export default function AccountEvalTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')
  const [selectedDate, setSelectedDate] = useState('전체')

  useEffect(() => {
    setLoading(true)
    getAllAccountEval(user.uid).then(rows => { setData(rows); setLoading(false) })
  }, [])

  const accountIds = [...new Set(data.map(d => d.accountId))].sort()
  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data
    .filter(d => selectedAccount === '전체' || d.accountId === selectedAccount)
    .filter(d => selectedDate === '전체' || d.date === selectedDate)
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))

  const handleDeleteRow = async (row) => {
    if (!window.confirm(`${row.date} / ${row.accountId} 행을 삭제하시겠습니까?`)) return
    await deleteDocument(user.uid, 'accountEval', row.docId)
    setData(d => d.filter(r => r.docId !== row.docId))
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목평가금액: r.evalAmt,
      예수금: r.cashAmt,
      총액: r.totalAmt,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '계좌평가조회')
    XLSX.writeFile(wb, `계좌평가조회_${selectedAccount}_${selectedDate}.xlsx`)
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!data.length) return <div style={styles.empty}>저장된 계좌별평가 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>계좌 선택</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} style={styles.stockSelect}>
            <option value="전체">전체</option>
            {accountIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>날짜 선택</span>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={styles.stockSelect}>
            <option value="전체">전체</option>
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
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
              <th style={styles.th}>날짜</th>
              <th style={styles.th}>계좌</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>총액</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const groupStart = i === 0 || row.date !== sorted[i - 1].date
              return (
                <tr key={row.docId} style={{ ...styles.tr, borderTop: groupStart && i > 0 ? '2px solid #334155' : undefined }}>
                  <td style={styles.td}>{row.date}</td>
                  <td style={styles.td}>{row.accountId}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}원</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.cashAmt)}원</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalAmt)}원</td>
                  <td style={styles.td}>
                    <button style={styles.rowDel} onClick={() => handleDeleteRow(row)}>삭제</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
