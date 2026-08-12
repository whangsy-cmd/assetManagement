// 실현손익 조회 탭 (DataView) — realizedProfits 원본을 계좌 단위로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllRealizedProfits, saveRealizedProfits, deleteDocument } from '../../utils/firestore'
import { fmt } from './shared'

export default function RealizedProfitTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')
  const [truncating, setTruncating] = useState(false)

  const load = () => getAllRealizedProfits(user.uid).then(rows => { setData(rows); setLoading(false) })

  useEffect(() => {
    setLoading(true)
    load()
  }, [])

  const presentIds = new Set(data.map(d => d.accountId))
  const accountIds = [
    ...accounts.map(a => a.accountId).filter(id => presentIds.has(id)),
    ...[...presentIds].filter(id => !accounts.some(a => a.accountId === id)).sort(),
  ]
  const filtered = selectedAccount === '전체' ? data : data.filter(d => d.accountId === selectedAccount)
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))

  const totalProfit = sorted.reduce((s, r) => s + (r.realizedProfit || 0), 0)
  const totalFee = sorted.reduce((s, r) => s + (r.fee || 0), 0)

  const decimalRows = sorted.filter(r => Math.trunc(r.realizedProfit) !== r.realizedProfit || Math.trunc(r.fee) !== r.fee)

  const handleTruncate = async () => {
    if (!decimalRows.length) return
    setTruncating(true)
    try {
      await saveRealizedProfits(user.uid, decimalRows.map(r => ({
        date: r.date, accountId: r.accountId, code: r.code || '', name: r.name || '',
        realizedProfit: Math.trunc(r.realizedProfit), fee: Math.trunc(r.fee),
      })))
      await load()
    } finally {
      setTruncating(false)
    }
  }

  const handleDeleteRow = async (row) => {
    if (!window.confirm(`${row.date} / ${row.accountId} / ${row.name || row.code || '-'} 행을 삭제하시겠습니까?`)) return
    await deleteDocument(user.uid, 'realizedProfits', row.docId)
    setData(d => d.filter(r => r.docId !== row.docId))
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      일자: r.date,
      계좌: r.accountId,
      종목코드: r.code || '',
      종목명: r.name || '',
      실현손익: r.realizedProfit,
      수수료: r.fee,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '실현손익조회')
    XLSX.writeFile(wb, `실현손익조회_${selectedAccount}.xlsx`)
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!data.length) return <div className="empty">저장된 실현손익 데이터가 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">계좌 선택</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            <option value="전체">전체</option>
            {accountIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
          <button className="btn btn-outline-orange btn-sm" onClick={handleTruncate} disabled={truncating || !decimalRows.length}>
            {truncating ? '절사 중...' : `원미만 절사 (${decimalRows.length}건)`}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>일자</th>
              <th>계좌</th>
              <th>종목코드</th>
              <th>종목명</th>
              <th className="r">실현손익</th>
              <th className="r">수수료</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.docId}>
                <td>{row.date}</td>
                <td>{row.accountId}</td>
                <td>{row.code || '-'}</td>
                <td>{row.name || '-'}</td>
                <td className={'r ' + (row.realizedProfit >= 0 ? 'pos' : 'neg')}>{fmt(row.realizedProfit)}</td>
                <td className="r">{fmt(row.fee)}</td>
                <td>
                  <button className="btn btn-outline-red btn-sm" onClick={() => handleDeleteRow(row)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="bold" colSpan={4}>합계</td>
              <td className={'r bold ' + (totalProfit >= 0 ? 'pos' : 'neg')}>{fmt(totalProfit)}</td>
              <td className="r bold">{fmt(totalFee)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
