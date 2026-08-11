// 입출금내역 탭 (DataView) — 계좌별 입출금 원장 + 월별 순입출/순소득 집계
import { useEffect, useState, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllCashFlows, deleteDateData, deleteAccountData, deleteCollectionData } from '../../utils/firestore'
import DeleteModal from '../../components/DeleteModal'
import { fmt, DateSelect, styles } from './shared'

// ── 입출금내역 탭 ───────────────────────────────────────────
export default function CashFlowsTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const futuresAccountIds = new Set(accounts.filter(a => a.name === '선물옵션').map(a => a.accountId))
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedAccount, setSelectedAccount] = useState('')
  const [selectedMemo, setSelectedMemo] = useState('전체')
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
    .filter(d => selectedMemo === '전체' || d.memo === selectedMemo)
  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const accountIds = [...new Set(data.map(d => d.accountId))].sort()
  const memos = [...new Set(data.map(d => d.memo).filter(Boolean))].sort()

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
          <span style={styles.toolLabel}>적요 선택</span>
          <select value={selectedMemo} onChange={e => setSelectedMemo(e.target.value)} style={styles.stockSelect}>
            <option value="전체">전체</option>
            {memos.map(m => <option key={m} value={m}>{m}</option>)}
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
              <th style={{ ...styles.th, textAlign: 'right' }}>금액</th>
              <th style={styles.th}>적요</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>예수금잔고</th>
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
