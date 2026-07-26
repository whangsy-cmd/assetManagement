import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import {
  getAllHoldings, getAllCash, getAllSnapshots,
  deleteDocument, deleteDateData, deleteCollectionData, countCollection,
} from '../utils/firestore'

const TABS = ['보유종목', '예수금', '스냅샷']

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

// ── 삭제 확인 모달 ─────────────────────────────────────────
function DeleteModal({ title, count, requireConfirm, onConfirm, onCancel, loading }) {
  const [text, setText] = useState('')
  const canDelete = requireConfirm ? text === '삭제' : true
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>⚠️ {title}</h3>
        <p style={styles.modalCount}>
          <strong style={{ color: '#f87171' }}>{count}개</strong> 문서가 삭제됩니다.
        </p>
        {requireConfirm && (
          <>
            <p style={styles.modalGuide}>
              계속하려면 <strong style={{ color: '#f87171' }}>삭제</strong>를 입력하세요.
            </p>
            <input
              style={styles.modalInput}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="삭제"
              autoFocus
            />
          </>
        )}
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>취소</button>
          <button
            style={{ ...styles.modalDelBtn, opacity: canDelete ? 1 : 0.4, cursor: canDelete ? 'pointer' : 'not-allowed' }}
            onClick={() => canDelete && onConfirm()}
            disabled={!canDelete || loading}
            autoFocus={!requireConfirm}
          >
            {loading ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 날짜 검색 드롭다운 ──────────────────────────────────────
function DateSelect({ id, dates, value, onChange }) {
  const [query, setQuery] = useState(value)

  useEffect(() => { setQuery(value) }, [value])

  return (
    <>
      <input
        list={id}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          if (dates.includes(e.target.value)) onChange(e.target.value)
        }}
        onFocus={() => setQuery('')}
        onBlur={() => setQuery(value)}
        style={styles.dateInput}
        placeholder="날짜 검색..."
      />
      <datalist id={id}>
        {dates.map(d => <option key={d} value={d} />)}
      </datalist>
    </>
  )
}

// ── 보유종목 탭 ─────────────────────────────────────────────
function HoldingsTab() {
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
    if (modal.type === 'row') await deleteDocument(user.uid, 'holdings', modal.docId)
    else if (modal.type === 'date') await deleteDateData(user.uid, 'holdings', modal.date)
    else await deleteCollectionData(user.uid, 'holdings')
    setModal(null)
    await load()
    setDeleting(false)
  }

  const handleExport = async () => {
    const cashData = await getAllCash(user.uid)
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
    const cashRows = cashData.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목명: '예수금',
      코드: '',
      수량: '',
      매입금액: '',
      평가금액: r.amount,
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
            전체 엑셀 다운로드
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
              <th style={styles.th}>수량</th>
              <th style={styles.th}>매입금액</th>
              <th style={styles.th}>평가금액</th>
              <th style={styles.th}>평가손익</th>
              <th style={styles.th}>수익률</th>
              <th style={styles.th}></th>
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
                <td style={styles.td}>
                  <button style={styles.rowDel} onClick={() => setModal({ type: 'row', docId: row.docId, count: 1 })}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={modal.type === 'row' ? '종목 삭제' : modal.type === 'date' ? `${modal.date} 전체 삭제` : '보유종목 전체 삭제'}
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

// ── 예수금 탭 ───────────────────────────────────────────────
function CashTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    const rows = await getAllCash(user.uid)
    setData(rows)
    if (rows.length && !selectedDate) setSelectedDate(rows[0].date)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data.filter(d => d.date === selectedDate)

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'row') await deleteDocument(user.uid, 'cash', modal.docId)
    else if (modal.type === 'date') await deleteDateData(user.uid, 'cash', modal.date)
    else await deleteCollectionData(user.uid, 'cash')
    setModal(null)
    await load()
    setDeleting(false)
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!data.length) return <div style={styles.empty}>저장된 예수금 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>날짜 선택</span>
          <DateSelect id="cash-dates" dates={dates} value={selectedDate} onChange={setSelectedDate} />
        </div>
        <div style={styles.toolRight}>
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
              <th style={styles.th}>D+2 예수금</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.accountId}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.amount)}원</td>
                <td style={styles.td}>
                  <button style={styles.rowDel} onClick={() => setModal({ type: 'row', docId: row.docId, count: 1 })}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={modal.type === 'row' ? '예수금 삭제' : modal.type === 'date' ? `${modal.date} 전체 삭제` : '예수금 전체 삭제'}
          count={modal.count}
          requireConfirm={modal.type === 'all'}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}

// ── 스냅샷 탭 ───────────────────────────────────────────────
function SnapshotsTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await getAllSnapshots(user.uid)
      setData(rows)
    } catch (e) {
      setLoadError('데이터 로드 오류: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date))

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'row') await deleteDocument(user.uid, 'snapshots', modal.docId)
    else await deleteCollectionData(user.uid, 'snapshots')
    setModal(null)
    await load()
    setDeleting(false)
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (loadError) return <div style={{ color: '#f87171', padding: 20, fontSize: 13 }}>{loadError}<br /><button style={{ marginTop: 10, ...styles.rowDel }} onClick={load}>재시도</button></div>
  if (!data.length) return <div style={styles.empty}>저장된 스냅샷이 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.toolRight}>
          <button style={styles.allDel} onClick={() => setModal({ type: 'all', count: data.length })}>
            전체 삭제
          </button>
        </div>
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
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.date}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.domestic?.balance)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: (row.domestic?.change ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.domestic?.change)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.overseas?.balance)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: (row.overseas?.change ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.overseas?.change)}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.pension?.balance)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: (row.pension?.change ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.pension?.change)}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalBalance ?? row.netBalance)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: (row.totalChange ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.totalChange)}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: (row.totalChangeRate ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>{Number(row.totalChangeRate ?? 0).toFixed(2)}%</td>
                <td style={{ ...styles.td, textAlign: 'right', color: '#f87171' }}>{row.totalLoan > 0 ? fmt(row.totalLoan) : '-'}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, color: '#a78bfa' }}>{fmt(row.netBalance ?? row.totalBalance)}</td>
                <td style={styles.td}>
                  <button style={styles.rowDel} onClick={() => setModal({ type: 'row', docId: row.docId, count: 1 })}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={modal.type === 'row' ? '스냅샷 삭제' : '스냅샷 전체 삭제'}
          count={modal.count}
          requireConfirm={modal.type === 'all'}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}

// ── 메인 ────────────────────────────────────────────────────
export default function DataView() {
  const [tab, setTab] = useState(0)

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>데이터 조회</h2>

      <div style={styles.tabs}>
        {TABS.map((t, i) => (
          <button
            key={i}
            style={{ ...styles.tab, ...(i === tab ? styles.tabActive : {}) }}
            onClick={() => setTab(i)}
          >{t}</button>
        ))}
      </div>

      <div style={styles.content}>
        {tab === 0 && <HoldingsTab />}
        {tab === 1 && <CashTab />}
        {tab === 2 && <SnapshotsTab />}
      </div>
    </div>
  )
}

const styles = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 20 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #1e293b', paddingBottom: 0 },
  tab: { background: 'transparent', color: '#64748b', border: 'none', borderBottom: '2px solid transparent', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 600, marginBottom: -1 },
  tabActive: { color: '#f1f5f9', borderBottomColor: '#3b82f6' },
  content: { background: '#1e293b', borderRadius: 12, padding: '20px' },
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  empty: { color: '#64748b', padding: 40, textAlign: 'center' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  toolLabel: { color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },
  dateBtns: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  dateInput: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', fontSize: 13, width: 160, outline: 'none' },
  toolRight: { display: 'flex', gap: 8 },
  exportBtn: { background: 'transparent', color: '#4ade80', border: '1px solid #14532d', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  dateDel: { background: 'transparent', color: '#fb923c', border: '1px solid #7c2d12', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  allDel: { background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '9px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '9px 12px', whiteSpace: 'nowrap' },
  code: { background: '#0f172a', padding: '2px 5px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' },
  rowDel: { background: 'transparent', color: '#ef4444', border: '1px solid #7f1d1d', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalCard: { background: '#1e293b', borderRadius: 14, padding: '32px', width: '100%', maxWidth: 400, boxShadow: '0 25px 50px rgba(0,0,0,0.6)' },
  modalTitle: { color: '#fca5a5', fontSize: 18, fontWeight: 700, marginBottom: 12 },
  modalCount: { color: '#e2e8f0', fontSize: 15, marginBottom: 12 },
  modalGuide: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  modalInput: { width: '100%', background: '#0f172a', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 12px', color: '#f1f5f9', fontSize: 15, marginBottom: 20, boxSizing: 'border-box' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14 },
  modalDelBtn: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700 },
}
