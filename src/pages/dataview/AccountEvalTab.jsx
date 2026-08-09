// 계좌별 조회 탭 (DataView) — 계좌별평가(accountEval) 원본을 계좌 단위로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllAccountEval } from '../../utils/firestore'
import { fmt, styles } from './shared'

// ── 계좌별 조회 탭 (계좌별평가 테이블 원본 조회) ────────────────
export default function AccountEvalTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')

  useEffect(() => {
    setLoading(true)
    getAllAccountEval(user.uid).then(rows => { setData(rows); setLoading(false) })
  }, [])

  const accountIds = [...new Set(data.map(d => d.accountId))].sort()
  const filtered = selectedAccount === '전체' ? data : data.filter(d => d.accountId === selectedAccount)
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))

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
    XLSX.utils.book_append_sheet(wb, ws, '계좌별조회')
    XLSX.writeFile(wb, `계좌별조회_${selectedAccount}.xlsx`)
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
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.date}</td>
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
