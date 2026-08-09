// 계좌통합 조회 탭 (DataView) — 계좌별평가(accountEval)를 일자별 국내/해외/연금 합계로 집계
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllAccountEval } from '../../utils/firestore'
import { LOAN_ACCOUNT_ID, buildRowsByAccount, categorySumsAsOf } from '../../utils/holdingsAgg'
import { fmt, styles } from './shared'

// ── 계좌통합 조회 탭 (계좌별평가를 일자별로 합산) ───────────────
export default function SnapshotsTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [accountEval, setAccountEval] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await getAllAccountEval(user.uid)
      setAccountEval(rows)
    } catch (e) {
      setLoadError('데이터 로드 오류: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const accCatMap = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
  const evalRows = accountEval.filter(r => r.accountId !== LOAN_ACCOUNT_ID)
  const loanRows = accountEval.filter(r => r.accountId === LOAN_ACCOUNT_ID)

  const rowsByAccount = buildRowsByAccount(evalRows)

  const loanByDate = new Map(loanRows.map(r => [r.date, -(r.totalAmt || 0)]))
  const loanDates = [...loanByDate.keys()].sort()
  const loanAsOf = date => {
    let v = 0
    for (const d of loanDates) { if (d > date) break; v = loanByDate.get(d) }
    return v
  }

  const evalDates = [...new Set(evalRows.map(r => r.date))].sort()
  const summary = evalDates.map(date => {
    const s = categorySumsAsOf(rowsByAccount, date, accCatMap)
    const totalBalance = s.pension + s.domestic + s.overseas
    const totalLoan = loanAsOf(date)
    return { date, domestic: s.domestic, overseas: s.overseas, pension: s.pension, totalBalance, totalLoan, netBalance: totalBalance - totalLoan }
  })
  for (let i = 0; i < summary.length; i++) {
    const prev = i > 0 ? summary[i - 1] : null
    summary[i].domesticChange = prev ? summary[i].domestic - prev.domestic : 0
    summary[i].overseasChange = prev ? summary[i].overseas - prev.overseas : 0
    summary[i].pensionChange = prev ? summary[i].pension - prev.pension : 0
    summary[i].totalChange = prev ? summary[i].totalBalance - prev.totalBalance : 0
    summary[i].totalChangeRate = prev && prev.totalBalance ? (summary[i].totalChange / prev.totalBalance) * 100 : 0
  }

  const sorted = [...summary].sort((a, b) => b.date.localeCompare(a.date))

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      국내: r.domestic,
      국내증감: r.domesticChange,
      해외: r.overseas,
      해외증감: r.overseasChange,
      연금: r.pension,
      연금증감: r.pensionChange,
      총잔액: r.totalBalance,
      총증감: r.totalChange,
      '증가율(%)': Number(r.totalChangeRate ?? 0).toFixed(2),
      대출금: r.totalLoan,
      순자산: r.netBalance,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '계좌통합조회')
    XLSX.writeFile(wb, '계좌통합조회_전체.xlsx')
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (loadError) return <div style={{ color: '#f87171', padding: 20, fontSize: 13 }}>{loadError}<br /><button style={{ marginTop: 10, ...styles.rowDel }} onClick={load}>재시도</button></div>
  if (!sorted.length) return <div style={styles.empty}>저장된 계좌별평가 데이터가 없습니다.</div>

  return (
    <div>
      <div style={{ ...styles.toolbar, justifyContent: 'flex-end' }}>
        <button style={styles.exportBtn} onClick={handleExport}>
          데이터 엑셀 다운로드
        </button>
      </div>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>날짜</th>
              <th style={styles.th}>국내</th>
              <th style={styles.th}>증감</th>
              <th style={styles.th}>해외</th>
              <th style={styles.th}>증감</th>
              <th style={styles.th}>연금</th>
              <th style={styles.th}>증감</th>
              <th style={styles.th}>총잔액</th>
              <th style={styles.th}>총증감</th>
              <th style={styles.th}>증가율</th>
              <th style={styles.th}>대출금</th>
              <th style={styles.th}>순자산</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.date} style={styles.tr}>
                <td style={styles.td}>{row.date}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.domestic)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.domesticChange >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.domesticChange)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.overseas)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.overseasChange >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.overseasChange)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.pension)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.pensionChange >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.pensionChange)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalBalance)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.totalChange >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.totalChange)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.totalChangeRate >= 0 ? '#4ade80' : '#f87171' }}>{Number(row.totalChangeRate ?? 0).toFixed(2)}%</td>
                <td style={{ ...styles.td, textAlign: 'right', color: '#f87171' }}>{row.totalLoan > 0 ? fmt(row.totalLoan) : '-'}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, color: '#a78bfa' }}>{fmt(row.netBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
