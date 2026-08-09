// 보유종목 탭 (DataView) — 날짜별 보유종목 원본 조회/삭제, 보유종목+예수금 엑셀 다운로드
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllHoldings, getAllAccountEval, deleteDateData, deleteCollectionData } from '../../utils/firestore'
import { LOAN_ACCOUNT_ID } from '../../utils/holdingsAgg'
import DeleteModal from '../../components/DeleteModal'
import { fmt, DateSelect, styles } from './shared'

// ── 보유종목 탭 ─────────────────────────────────────────────
export default function HoldingsTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [modal, setModal] = useState(null) // { type: 'row'|'date'|'all', docId?, date?, count }
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    const rows = await getAllHoldings(user.uid)
    setData(rows)
    if (rows.length && !selectedDate) setSelectedDate(rows[0].date)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data.filter(d => d.date === selectedDate)

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

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!data.length) return <div style={styles.empty}>저장된 보유종목 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>날짜 선택</span>
          <DateSelect id="holdings-dates" dates={dates} value={selectedDate} onChange={setSelectedDate} />
        </div>
        <div style={styles.toolRight}>
          <button style={styles.exportBtn} onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
          <button style={styles.dateDel} onClick={() => setModal({ type: 'date', date: selectedDate, count: filtered.length })}>
            {selectedDate} 삭제
          </button>
          <button style={styles.allDel} onClick={() => setModal({ type: 'all', count: data.length })}>
            전체 삭제
          </button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>계좌</th>
              <th style={styles.th}>코드</th>
              <th style={styles.th}>종목명</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>수량</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>매입금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>평가금액</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>평가손익</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>수익률</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.accountId}</td>
                <td style={styles.td}><code style={styles.code}>{row.code}</code></td>
                <td style={styles.td}>{row.name}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.qty)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.purchaseAmt)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.gainLoss >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.gainLoss)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.returnRate >= 0 ? '#4ade80' : '#f87171' }}>{Number(row.returnRate).toFixed(2)}%</td>
              </tr>
            ))}
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
