// 보유종목 탭 (DataView) — 날짜별 보유종목 원본 조회/삭제, 보유종목+예수금 엑셀 다운로드
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllHoldings, getAllAccountEval, getSectors, deleteDateData, deleteCollectionData } from '../../utils/firestore'
import { LOAN_ACCOUNT_ID } from '../../utils/holdingsAgg'
import DeleteModal from '../../components/DeleteModal'
import { fmt, DateSelect } from './shared'

// ── 보유종목 탭 ─────────────────────────────────────────────
export default function HoldingsTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [modal, setModal] = useState(null) // { type: 'row'|'date'|'all', docId?, date?, count }
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    const [rows, sec] = await Promise.all([getAllHoldings(user.uid), getSectors(user.uid)])
    setData(rows)
    setSectors(sec)
    if (rows.length && !selectedDate) setSelectedDate(rows[0].date)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sectorMap = Object.fromEntries(sectors.map(s => [s.code, s.sector || '미분류']))
  const sectorOf = row => sectorMap[row.code] || '미분류'

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data.filter(d => d.date === selectedDate)
    .sort((a, b) => a.accountId.localeCompare(b.accountId) || sectorOf(a).localeCompare(sectorOf(b)) || (a.name || '').localeCompare(b.name || ''))

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'date') {
      await deleteDateData(user.uid, 'holdings', modal.date)
    } else {
      await deleteCollectionData(user.uid, 'holdings')
    }
    setModal(null)
    await load()
    setDeleting(false)
  }

  const handleExport = async () => {
    const evalData = await getAllAccountEval(user.uid)
    const holdingRows = data.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목명: r.name,
      코드: r.code,
      수량: r.qty,
      매입금액: r.purchaseAmt,
      평가금액: r.evalAmt,
      평가손익: r.gainLoss,
      '수익률(%)': Number(r.returnRate).toFixed(2),
    }))
    const cashRows = evalData.filter(r => r.accountId !== LOAN_ACCOUNT_ID).map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목명: '예수금',
      코드: '',
      수량: '',
      매입금액: '',
      평가금액: r.cashAmt,
      평가손익: '',
      '수익률(%)': '',
    }))
    const rows = [...holdingRows, ...cashRows].sort((a, b) =>
      b.날짜.localeCompare(a.날짜) || a.계좌.localeCompare(b.계좌) || a.종목명.localeCompare(b.종목명)
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '보유현황')
    XLSX.writeFile(wb, '보유종목_예수금_전체.xlsx')
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!data.length) return <div className="empty">저장된 보유종목 데이터가 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">날짜</span>
          <DateSelect id="holdings-dates" dates={dates} value={selectedDate} onChange={setSelectedDate} />
        </div>
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
          <button className="btn btn-outline-orange btn-sm" onClick={() => setModal({ type: 'date', date: selectedDate, count: filtered.length })}>
            {selectedDate} 삭제
          </button>
          <button className="btn btn-outline-red btn-sm" onClick={() => setModal({ type: 'all', count: data.length })}>
            전체 삭제
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>계좌</th>
              <th>코드</th>
              <th>종목명</th>
              <th>섹터</th>
              <th className="r">수량</th>
              <th className="r">매입금액</th>
              <th className="r">평가금액</th>
              <th className="r">평가손익</th>
              <th className="r">수익률</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => {
              const groupStart = i === 0 || row.accountId !== filtered[i - 1].accountId
              return (
                <tr key={row.docId} style={{ borderTop: groupStart && i > 0 ? '2px solid #334155' : undefined }}>
                  <td>{row.accountId}</td>
                  <td><code className="code-chip">{row.code}</code></td>
                  <td>{row.name}</td>
                  <td>{sectorOf(row)}</td>
                  <td className="r">{fmt(row.qty)}</td>
                  <td className="r">{fmt(row.purchaseAmt)}</td>
                  <td className="r">{fmt(row.evalAmt)}</td>
                  <td className={'r ' + (row.gainLoss >= 0 ? 'pos' : 'neg')}>{fmt(row.gainLoss)}</td>
                  <td className={'r ' + (row.returnRate >= 0 ? 'pos' : 'neg')}>{Number(row.returnRate).toFixed(2)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={modal.type === 'date' ? `${modal.date} 전체 삭제` : '보유종목 전체 삭제'}
          requireConfirm={modal.type === 'all'}
          count={modal.count}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}
