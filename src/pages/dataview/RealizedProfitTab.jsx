// 실현손익 조회 탭 (DataView) — realizedProfits 원본을 계좌 단위로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllRealizedProfits, saveRealizedProfits, deleteDocument, deleteDocumentsByIds } from '../../utils/firestore'
import { fmt } from './shared'

export default function RealizedProfitTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [truncating, setTruncating] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

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
  const filtered = data
    .filter(d => selectedAccount === '전체' || d.accountId === selectedAccount)
    .filter(d => (!fromDate || d.date >= fromDate) && (!toDate || d.date <= toDate))
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))

  const totalProfit = sorted.reduce((s, r) => s + (r.realizedProfit || 0), 0)

  const decimalRows = sorted.filter(r => Math.trunc(r.realizedProfit) !== r.realizedProfit || Math.trunc(r.fee) !== r.fee || Math.trunc(r.tax || 0) !== (r.tax || 0))

  const handleTruncate = async () => {
    if (!decimalRows.length) return
    setTruncating(true)
    try {
      await saveRealizedProfits(user.uid, decimalRows.map(r => ({
        date: r.date, accountId: r.accountId, code: r.code || '', name: r.name || '',
        realizedProfit: Math.trunc(r.realizedProfit), fee: Math.trunc(r.fee),
        ...(r.tax !== undefined && { tax: Math.trunc(r.tax) }),
        ...(r.sellAmount !== undefined && { sellAmount: r.sellAmount }),
        ...(r.exrt !== undefined && { exrt: r.exrt }),
        ...(r.liquidationProfit !== undefined && { liquidationProfit: r.liquidationProfit }),
        ...(r.qty !== undefined && { qty: r.qty }),
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

  // 계좌 선택 외에 기간(fromDate/toDate) 필터도 걸려있으면 그 범위만 삭제 — sorted(화면에 보이는 행) 기준
  const handleDeleteAccount = async () => {
    if (selectedAccount === '전체') return
    if (!window.confirm(`${selectedAccount} 계좌의 실현손익 데이터 ${sorted.length}건을 삭제하시겠습니까?`)) return
    setDeletingAccount(true)
    try {
      const docIds = sorted.map(r => r.docId)
      await deleteDocumentsByIds(user.uid, 'realizedProfits', docIds)
      const deleted = new Set(docIds)
      setData(d => d.filter(r => !deleted.has(r.docId)))
      setSelectedAccount('전체')
    } finally {
      setDeletingAccount(false)
    }
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      일자: r.date,
      계좌: r.accountId,
      종목코드: r.code || '',
      종목명: r.name || '',
      수량: r.qty ?? '',
      거래금액: r.sellAmount || '',
      청산손익: r.liquidationProfit ?? '',
      수수료: r.fee,
      세금: r.tax ?? '',
      적용환율: r.exrt ?? '',
      실현손익: r.realizedProfit,
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
          <span className="tool-label">계좌</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            <option value="전체">전체</option>
            {accountIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button className="btn btn-outline-red btn-sm" onClick={handleDeleteAccount} disabled={selectedAccount === '전체' || deletingAccount}>
            {deletingAccount ? '삭제 중...' : '계좌 전체 삭제'}
          </button>
          <span className="tool-label">기간</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
          <span className="tool-label">~</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="input input-sm" style={{ width: 160 }} />
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

      <div className="summary-bar" style={{ marginBottom: 12, padding: '8px 16px', justifyContent: 'flex-end' }}>
        <div className="summary-item" style={{ flex: 'none', flexDirection: 'row', gap: 6, alignItems: 'baseline' }}>
          <span className="summary-label">실현손익</span>
          <span className={`summary-item-val ${totalProfit >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 14 }}>{fmt(totalProfit)}</span>
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
              <th className="r">수량</th>
              <th className="r">거래금액</th>
              <th className="r">청산손익</th>
              <th className="r">적용환율</th>
              <th className="r">실현손익(원)</th>
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
                <td className="r">{row.qty !== undefined ? row.qty.toLocaleString() : '-'}</td>
                <td className="r">{row.sellAmount ? fmt(row.sellAmount) : '-'}</td>
                <td className="r">{row.liquidationProfit !== undefined ? row.liquidationProfit.toLocaleString() : '-'}</td>
                <td className="r">{row.exrt ? row.exrt.toLocaleString() : '-'}</td>
                <td className={'r ' + (row.realizedProfit >= 0 ? 'pos' : 'neg')}>{fmt(row.realizedProfit)}</td>
                <td>
                  <button className="btn btn-outline-red btn-sm" onClick={() => handleDeleteRow(row)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="bold" colSpan={8}>합계</td>
              <td className={'r bold ' + (totalProfit >= 0 ? 'pos' : 'neg')}>{fmt(totalProfit)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
