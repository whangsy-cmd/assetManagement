import { useEffect, useState, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import {
  getAllHoldings, getAllCash, getAllSnapshots, getAllCashFlows,
  deleteDateData, deleteAccountData, deleteCollectionData, countCollection, getAllDocsRaw,
} from '../utils/firestore'
import { buildStockSeries } from '../utils/holdingsAgg'

const TABS = ['보유종목', '계좌별 평가', '스냅샷', '입출금내역', '종목별 조회']

// 백업 대상 컬렉션. settings(키움 API 키 등 시크릿 포함)는 의도적으로 제외.
const BACKUP_COLLECTIONS = ['holdings', 'cash', 'snapshots', 'accounts', 'sectors', 'loans', 'incomeReports', 'priceSeries', 'cashFlows', 'optionMonthlyProfit', 'accountEval', 'tempAccountDailyBalance']

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

// 중첩 객체/배열은 복원 시 그대로 복구할 수 있도록 JSON 문자열로 넣는다. 감사용 타임스탬프는 제외.
function flattenDoc(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'createdAt' || k === 'updatedAt') continue
    out[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v
  }
  return out
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
    if (modal.type === 'date') {
      await deleteDateData(user.uid, 'holdings', modal.date)
      await deleteDateData(user.uid, 'cash', modal.date)
      await deleteDateData(user.uid, 'snapshots', modal.date)
    } else {
      await deleteCollectionData(user.uid, 'holdings')
      await deleteCollectionData(user.uid, 'cash')
      await deleteCollectionData(user.uid, 'snapshots')
    }
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
              <th style={styles.th}>수량</th>
              <th style={styles.th}>매입금액</th>
              <th style={styles.th}>평가금액</th>
              <th style={styles.th}>평가손익</th>
              <th style={styles.th}>수익률</th>
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

// ── 예수금 탭 ───────────────────────────────────────────────
function CashTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')

  const load = async () => {
    setLoading(true)
    const [rows, holdingRows] = await Promise.all([getAllCash(user.uid), getAllHoldings(user.uid)])
    setData(rows)
    setHoldings(holdingRows)
    if (rows.length && !selectedDate) setSelectedDate(rows[0].date)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data.filter(d => d.date === selectedDate)

  const evalAmtByAccount = new Map()
  for (const h of holdings) {
    const key = `${h.date}_${h.accountId}`
    evalAmtByAccount.set(key, (evalAmtByAccount.get(key) || 0) + (h.evalAmt || 0))
  }
  const evalAmtOf = row => evalAmtByAccount.get(`${row.date}_${row.accountId}`) || 0

  const handleExport = () => {
    const rows = [...data].sort((a, b) =>
      b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId)
    ).map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목평가금액: evalAmtOf(r),
      예수금: r.amount,
      총액: evalAmtOf(r) + r.amount,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '계좌별평가')
    XLSX.writeFile(wb, '계좌별평가_전체.xlsx')
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
              <th style={styles.th}>종목평가금액</th>
              <th style={styles.th}>예수금</th>
              <th style={styles.th}>총액</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.accountId}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(evalAmtOf(row))}원</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.amount)}원</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(evalAmtOf(row) + row.amount)}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 스냅샷 탭 ───────────────────────────────────────────────
function SnapshotsTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      국내: r.domestic?.balance,
      국내증감: r.domestic?.change,
      해외: r.overseas?.balance,
      해외증감: r.overseas?.change,
      연금: r.pension?.balance,
      연금증감: r.pension?.change,
      총잔액: r.totalBalance ?? r.netBalance,
      총증감: r.totalChange,
      '증가율(%)': Number(r.totalChangeRate ?? 0).toFixed(2),
      대출금: r.totalLoan,
      순자산: r.netBalance ?? r.totalBalance,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '스냅샷')
    XLSX.writeFile(wb, '스냅샷_전체.xlsx')
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (loadError) return <div style={{ color: '#f87171', padding: 20, fontSize: 13 }}>{loadError}<br /><button style={{ marginTop: 10, ...styles.rowDel }} onClick={load}>재시도</button></div>
  if (!data.length) return <div style={styles.empty}>저장된 스냅샷이 없습니다.</div>

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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 입출금내역 탭 ───────────────────────────────────────────
function CashFlowsTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const futuresAccountIds = new Set(accounts.filter(a => a.name === '선물옵션').map(a => a.accountId))
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [modal, setModal] = useState(null) // { type: 'date'|'account'|'all', date?, accountId?, count }
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await getAllCashFlows(user.uid)
      setData(rows)
      if (rows.length && !selectedDate) setSelectedDate(rows[0].date)
      if (!selectedAccount) setSelectedAccount('전체')
    } catch (e) {
      setLoadError('데이터 로드 오류: ' + e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''))
    .filter(d => selectedAccount === '전체' || d.accountId === selectedAccount)
  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const accountIds = [...new Set(data.map(d => d.accountId))].sort()

  // 순입출금(순이체) = 적요가 "이체"로 시작하는 행만 합산
  // 순소득 = "이체"로 시작하지 않고, 대체입금/대체출금/대체외화입금/대체외화출금 4가지도 아닌 나머지 전부 합산
  const EXCLUDE_INCOME_MEMO = ['대체입금', '대체출금', '대체외화입금', '대체외화출금', '환전정산입금']

  const transferMonthly = new Map() // `${월}_${통화}` → 순이체 합계
  const incomeMonthly = new Map() // `${월}_${통화}` → 순소득 합계
  for (const r of sorted) {
    if (futuresAccountIds.has(r.accountId)) continue
    const month = r.date.slice(0, 7)
    const currency = r.currency || 'KRW'
    const signed = r.ioType?.includes('출금') ? -r.amount : r.amount
    const key = `${month}_${currency}`
    const isTransfer = r.memo?.startsWith('이체')
    if (isTransfer) transferMonthly.set(key, (transferMonthly.get(key) || 0) + signed)
    if (!isTransfer && !EXCLUDE_INCOME_MEMO.includes(r.memo)) incomeMonthly.set(key, (incomeMonthly.get(key) || 0) + signed)
  }

  const currencies = [...new Set(sorted.map(d => d.currency || 'KRW'))].sort()
  const months = [...new Set([...transferMonthly.keys(), ...incomeMonthly.keys()].map(k => k.split('_')[0]))]
    .sort((a, b) => b.localeCompare(a))
  const monthlyRows = months.map(month => ({
    month,
    transfer: Object.fromEntries(currencies.map(c => [c, transferMonthly.get(`${month}_${c}`) || 0])),
    income: Object.fromEntries(currencies.map(c => [c, incomeMonthly.get(`${month}_${c}`) || 0])),
  }))

  const transferTotal = new Map() // 통화 → 누적 순이체
  for (const [key, sum] of transferMonthly) {
    const currency = key.split('_')[1]
    transferTotal.set(currency, (transferTotal.get(currency) || 0) + sum)
  }

  const incomeByCurrency = new Map() // 통화 → 누적 순소득
  for (const [key, sum] of incomeMonthly) {
    const currency = key.split('_')[1]
    incomeByCurrency.set(currency, (incomeByCurrency.get(currency) || 0) + sum)
  }

  const handleDelete = async () => {
    setDeleting(true)
    if (modal.type === 'date') {
      await deleteDateData(user.uid, 'cashFlows', modal.date)
    } else if (modal.type === 'account') {
      await deleteAccountData(user.uid, 'cashFlows', modal.accountId)
    } else {
      await deleteCollectionData(user.uid, 'cashFlows')
    }
    setModal(null)
    await load()
    setDeleting(false)
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      구분: r.ioType,
      금액: r.ioType?.includes('출금') ? -r.amount : r.amount,
      통화: r.currency || 'KRW',
      적요: r.memo,
      예수금잔고: r.balance,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '입출금내역')
    XLSX.writeFile(wb, '입출금내역_전체.xlsx')
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (loadError) return <div style={{ color: '#f87171', padding: 20, fontSize: 13 }}>{loadError}<br /><button style={{ marginTop: 10, ...styles.rowDel }} onClick={load}>재시도</button></div>
  if (!data.length) return <div style={styles.empty}>저장된 입출금내역이 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>날짜 선택</span>
          <DateSelect id="cashflows-dates" dates={dates} value={selectedDate} onChange={setSelectedDate} />
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
          <button style={styles.dateDel} onClick={() => setModal({ type: 'date', date: selectedDate, count: data.filter(d => d.date === selectedDate).length })}>
            {selectedDate} 삭제
          </button>
          {selectedAccount !== '전체' && (
            <button style={styles.dateDel} onClick={() => setModal({ type: 'account', accountId: selectedAccount, count: data.filter(d => d.accountId === selectedAccount).length })}>
              {selectedAccount} 삭제
            </button>
          )}
          <button style={styles.allDel} onClick={() => setModal({ type: 'all', count: data.length })}>
            전체 삭제
          </button>
        </div>
      </div>

      <div style={{ ...styles.tableWrap, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>월별 순입출금</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[...transferTotal.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, sum]) => {
              const unit = currency !== 'KRW' ? ` ${currency}` : '원'
              return (
                <span key={`t-${currency}`} style={{ fontSize: 13 }}>
                  누적 순입출({currency}) <b style={{ color: sum >= 0 ? '#4ade80' : '#f87171' }}>{sum >= 0 ? '+' : ''}{fmt(sum)}{unit}</b>
                </span>
              )
            })}
            {[...incomeByCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, sum]) => {
              const unit = currency !== 'KRW' ? ` ${currency}` : '원'
              return (
                <span key={`i-${currency}`} style={{ fontSize: 13 }}>
                  누적 순소득({currency}) <b style={{ color: sum >= 0 ? '#4ade80' : '#f87171' }}>{sum >= 0 ? '+' : ''}{fmt(sum)}{unit}</b>
                </span>
              )
            })}
          </div>
        </div>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>월</th>
              {currencies.map(c => (
                <Fragment key={c}>
                  <th style={{ ...styles.th, textAlign: 'right' }}>순입출({c})</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>순소득({c})</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthlyRows.map(r => (
              <tr key={r.month} style={styles.tr}>
                <td style={styles.td}>{r.month}</td>
                {currencies.map(c => (
                  <Fragment key={c}>
                    <td style={{ ...styles.td, textAlign: 'right', color: r.transfer[c] >= 0 ? '#4ade80' : '#f87171' }}>
                      {r.transfer[c] === 0 ? '-' : `${r.transfer[c] > 0 ? '+' : ''}${fmt(r.transfer[c])}`}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', color: r.income[c] >= 0 ? '#4ade80' : '#f87171' }}>
                      {r.income[c] === 0 ? '-' : `${r.income[c] > 0 ? '+' : ''}${fmt(r.income[c])}`}
                    </td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>날짜</th>
              <th style={styles.th}>계좌</th>
              <th style={styles.th}>구분</th>
              <th style={styles.th}>통화</th>
              <th style={styles.th}>금액</th>
              <th style={styles.th}>적요</th>
              <th style={styles.th}>예수금잔고</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.docId} style={styles.tr}>
                <td style={styles.td}>{row.date}{row.time && ` ${row.time}`}</td>
                <td style={styles.td}>{row.accountId}</td>
                <td style={{ ...styles.td, color: row.ioType?.includes('출금') ? '#f87171' : '#4ade80' }}>{row.ioType}</td>
                <td style={styles.td}>{row.currency || 'KRW'}</td>
                <td style={{ ...styles.td, textAlign: 'right', color: row.ioType?.includes('출금') ? '#f87171' : undefined }}>{row.ioType?.includes('출금') ? '-' : ''}{fmt(row.amount)}</td>
                <td style={styles.td}>{row.memo}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeleteModal
          title={
            modal.type === 'date' ? `${modal.date} 입출금내역 삭제`
              : modal.type === 'account' ? `${modal.accountId} 입출금내역 삭제`
              : '입출금내역 전체 삭제'
          }
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

// ── 종목별 조회 탭 ───────────────────────────────────────────
function StockPeriodTab() {
  const { user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCode, setSelectedCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    setLoading(true)
    getAllHoldings(user.uid).then(rows => { setData(rows); setLoading(false) })
  }, [])

  const byCode = buildStockSeries(data)
  const options = [...byCode.values()]
    .map(entry => {
      const dates = [...entry.byDate.keys()].sort()
      const latestEvalAmt = entry.byDate.get(dates.at(-1))?.evalAmt || 0
      return { code: entry.code, name: entry.name, latestEvalAmt }
    })
    .sort((a, b) => b.latestEvalAmt - a.latestEvalAmt)

  useEffect(() => {
    if (!selectedCode && options.length) setSelectedCode(options[0].code)
  }, [options.length])

  const entry = byCode.get(selectedCode)
  const allRows = entry
    ? [...entry.byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
    : []

  useEffect(() => {
    if (!entry) return
    const dates = [...entry.byDate.keys()].sort()
    setFromDate(dates[0])
    setToDate(dates.at(-1))
  }, [selectedCode])

  const filtered = allRows.filter(r => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))

  if (loading) return <div style={styles.loading}>로딩 중...</div>
  if (!options.length) return <div style={styles.empty}>저장된 보유종목 데이터가 없습니다.</div>

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={styles.dateRow}>
          <span style={styles.toolLabel}>종목 선택</span>
          <select value={selectedCode} onChange={e => setSelectedCode(e.target.value)} style={styles.stockSelect}>
            {options.map(o => (
              <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
            ))}
          </select>
          <span style={styles.toolLabel}>기간</span>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={styles.dateInput} />
          <span style={styles.toolLabel}>~</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={styles.dateInput} />
        </div>
      </div>

      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>모든 계좌 합산 기준입니다.</p>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>날짜</th>
              <th style={styles.th}>수량</th>
              <th style={styles.th}>매입금액</th>
              <th style={styles.th}>평가금액</th>
              <th style={styles.th}>평가손익</th>
              <th style={styles.th}>수익률</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const returnRate = row.purchaseAmt > 0 ? (row.gainLoss / row.purchaseAmt) * 100 : 0
              return (
                <tr key={row.date} style={styles.tr}>
                  <td style={styles.td}>{row.date}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.qty)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.purchaseAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: row.gainLoss >= 0 ? '#4ade80' : '#f87171' }}>{fmt(row.gainLoss)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: returnRate >= 0 ? '#4ade80' : '#f87171' }}>{returnRate.toFixed(2)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 메인 ────────────────────────────────────────────────────
export default function DataView() {
  const { user } = useAuth()
  const [tab, setTab] = useState(0)
  const [backingUp, setBackingUp] = useState(false)

  const handleFullBackup = async () => {
    setBackingUp(true)
    try {
      const wb = XLSX.utils.book_new()
      for (const col of BACKUP_COLLECTIONS) {
        const docs = await getAllDocsRaw(user.uid, col)
        const rows = docs.map(flattenDoc)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), col)
      }
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      XLSX.writeFile(wb, `백업_전체데이터_${today}.xlsx`)
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.headingRow}>
        <h2 style={styles.heading}>데이터 조회</h2>
        <button style={styles.backupBtn} onClick={handleFullBackup} disabled={backingUp}>
          {backingUp ? '백업 생성 중...' : '전체 백업 다운로드'}
        </button>
      </div>

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
        {tab === 3 && <CashFlowsTab />}
        {tab === 4 && <StockPeriodTab />}
      </div>
    </div>
  )
}

const styles = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  backupBtn: { background: 'transparent', color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
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
  stockSelect: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', fontSize: 13, maxWidth: 260, outline: 'none' },
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
