// 계좌통합 조회 탭 (DataView) — 계좌별평가(accountEval)를 일자별 국내/해외/연금 합계로 집계
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllAccountEval } from '../../utils/firestore'
import { LOAN_ACCOUNT_ID, buildRowsByAccount, categorySumsAsOf, sumCategoryValues } from '../../utils/holdingsAgg'
import { fmt } from './shared'

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
    const totalBalance = sumCategoryValues(s)
    const totalLoan = loanAsOf(date)
    return { date, domestic: s.domestic, overseas: s.overseas, pension: s.pension, futures: s.futures || 0, totalBalance, totalLoan, netBalance: totalBalance - totalLoan }
  })
  for (let i = 0; i < summary.length; i++) {
    const prev = i > 0 ? summary[i - 1] : null
    summary[i].domesticChange = prev ? summary[i].domestic - prev.domestic : 0
    summary[i].overseasChange = prev ? summary[i].overseas - prev.overseas : 0
    summary[i].pensionChange = prev ? summary[i].pension - prev.pension : 0
    summary[i].futuresChange = prev ? summary[i].futures - prev.futures : 0
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
      선물옵션: r.futures,
      선물옵션증감: r.futuresChange,
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

  if (loading) return <div className="loading">로딩 중...</div>
  if (loadError) return <div className="neg" style={{ padding: 20, fontSize: 13 }}>{loadError}<br /><button className="btn btn-outline-red btn-sm" style={{ marginTop: 10 }} onClick={load}>재시도</button></div>
  if (!sorted.length) return <div className="empty">저장된 계좌별평가 데이터가 없습니다.</div>

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
          데이터 엑셀 다운로드
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>날짜</th>
              <th className="r">국내</th>
              <th className="r">증감</th>
              <th className="r">해외</th>
              <th className="r">증감</th>
              <th className="r">연금</th>
              <th className="r">증감</th>
              <th className="r">선물옵션</th>
              <th className="r">증감</th>
              <th className="r">총잔액</th>
              <th className="r">총증감</th>
              <th className="r">증가율</th>
              <th className="r">대출금</th>
              <th className="r">순자산</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td className="r">{fmt(row.domestic)}</td>
                <td className={'r ' + (row.domesticChange >= 0 ? 'pos' : 'neg')}>{fmt(row.domesticChange)}</td>
                <td className="r">{fmt(row.overseas)}</td>
                <td className={'r ' + (row.overseasChange >= 0 ? 'pos' : 'neg')}>{fmt(row.overseasChange)}</td>
                <td className="r">{fmt(row.pension)}</td>
                <td className={'r ' + (row.pensionChange >= 0 ? 'pos' : 'neg')}>{fmt(row.pensionChange)}</td>
                <td className="r">{fmt(row.futures)}</td>
                <td className={'r ' + (row.futuresChange >= 0 ? 'pos' : 'neg')}>{fmt(row.futuresChange)}</td>
                <td className="r bold">{fmt(row.totalBalance)}</td>
                <td className={'r ' + (row.totalChange >= 0 ? 'pos' : 'neg')}>{fmt(row.totalChange)}</td>
                <td className={'r ' + (row.totalChangeRate >= 0 ? 'pos' : 'neg')}>{Number(row.totalChangeRate ?? 0).toFixed(2)}%</td>
                <td className="r neg">{row.totalLoan > 0 ? fmt(row.totalLoan) : '-'}</td>
                <td className="r bold purple">{fmt(row.netBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
