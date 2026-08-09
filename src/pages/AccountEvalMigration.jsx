import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AccountEvalChart from '../components/AccountEvalChart'
import { buildAccountEvalRows, buildLoanEvalRow, LOAN_ACCOUNT_ID } from '../utils/holdingsAgg'
import {
  getAllHoldings, getAllCash, getAllSnapshots, saveAccountEval, getAllAccountEval, getLoans,
  deleteCollectionData, deleteAccountData, deleteDocument,
} from '../utils/firestore'

const PENSION_MIGRATE_ACCOUNT_ID = '000-0000-0000'
const PENSION_MIGRATE_BEFORE = '2026-05-10' // 이 날짜 이전 스냅샷만 이전 (계좌 분리 전 연금 데이터)
const PENSION_FILL_UNTIL = '2026-05-01' // 금요일 공백 보정은 이 날짜까지만
const CHART_START_DATE = '2025-02-07'

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

function isWeekend(dateStr) {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay()
  return day === 0 || day === 6
}

function isFriday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay() === 5
}

// 토요일→하루 전, 일요일→이틀 전 (직전 금요일)
function toPreviousFriday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 2 : 1))
  return d.toISOString().slice(0, 10)
}

export default function AccountEvalMigration() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [selectedAccount, setSelectedAccount] = useState('전체')

  const load = async () => {
    setLoading(true)
    const data = await getAllAccountEval(user.uid)
    setRows(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      const [holdings, cash] = await Promise.all([getAllHoldings(user.uid), getAllCash(user.uid)])
      const built = buildAccountEvalRows(holdings, cash)
      await saveAccountEval(user.uid, built)
      await load()
    } catch (e) {
      setError('생성 오류: ' + e.message)
    }
    setGenerating(false)
  }

  const handleMigratePension = async () => {
    setGenerating(true)
    setError('')
    try {
      const snapshots = await getAllSnapshots(user.uid)
      const relevant = snapshots.filter(s => s.date < PENSION_MIGRATE_BEFORE).sort((a, b) => a.date.localeCompare(b.date))
      const built = relevant.map(s => ({
        date: s.date,
        accountId: PENSION_MIGRATE_ACCOUNT_ID,
        evalAmt: s.pension?.balance || 0,
        cashAmt: 0,
        totalAmt: s.pension?.balance || 0,
      }))

      // 금요일인데 스냅샷이 없는 날은 직전 영업일(스냅샷) 자료로 채움 (PENSION_FILL_UNTIL까지만)
      if (relevant.length) {
        const byDate = new Map(relevant.map(s => [s.date, s]))
        let lastSnap = null
        const end = new Date(PENSION_FILL_UNTIL + 'T00:00:00Z')
        for (let t = new Date(relevant[0].date + 'T00:00:00Z'); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
          const iso = t.toISOString().slice(0, 10)
          const existing = byDate.get(iso)
          if (existing) { lastSnap = existing; continue }
          if (t.getUTCDay() === 5 && lastSnap) {
            built.push({
              date: iso,
              accountId: PENSION_MIGRATE_ACCOUNT_ID,
              evalAmt: lastSnap.pension?.balance || 0,
              cashAmt: 0,
              totalAmt: lastSnap.pension?.balance || 0,
            })
          }
        }
      }

      await saveAccountEval(user.uid, built)
      await load()
    } catch (e) {
      setError('연금 이전 오류: ' + e.message)
    }
    setGenerating(false)
  }

  const handleAddLoanToAll = async () => {
    const uniqueDates = [...new Set(rows.map(r => r.date))]
    if (!uniqueDates.length) { alert('계좌별평가 데이터가 없습니다.'); return }
    const loans = await getLoans(user.uid)
    const totalLoan = loans.reduce((s, l) => s + (l.amount || 0), 0)
    if (!totalLoan) { alert('등록된 대출금이 없습니다.'); return }
    if (!confirm(`전체 ${uniqueDates.length}개 날짜에 현재 대출금 합계 ${totalLoan.toLocaleString()}원을 일괄 등록할까요?\n대출금은 날짜별 이력이 없어 현재값을 모든 날짜에 동일하게 적용합니다.`)) return
    setGenerating(true)
    setError('')
    try {
      const loanRows = uniqueDates.map(date => buildLoanEvalRow(date, loans)).filter(Boolean)
      await saveAccountEval(user.uid, loanRows)
      await load()
    } catch (e) {
      setError('대출금 추가 오류: ' + e.message)
    }
    setGenerating(false)
  }

  const handleFixWeekendDates = async () => {
    const weekendRows = rows.filter(r => isWeekend(r.date))
    if (!weekendRows.length) { alert('토요일/일요일 날짜 데이터가 없습니다.'); return }
    if (!confirm(`${weekendRows.length}건의 주말 날짜를 직전 금요일로 수정할까요?`)) return
    setGenerating(true)
    setError('')
    try {
      const fixed = weekendRows.map(r => ({
        date: toPreviousFriday(r.date),
        accountId: r.accountId,
        evalAmt: r.evalAmt,
        cashAmt: r.cashAmt,
        totalAmt: r.totalAmt,
      }))
      await saveAccountEval(user.uid, fixed)
      for (const r of weekendRows) await deleteDocument(user.uid, 'accountEval', r.docId)
      await load()
    } catch (e) {
      setError('주말 날짜 수정 오류: ' + e.message)
    }
    setGenerating(false)
  }

  const handleDeleteNonFriday = async () => {
    const nonFridayRows = rows.filter(r => !isFriday(r.date))
    if (!nonFridayRows.length) { alert('금요일이 아닌 날짜 데이터가 없습니다.'); return }
    if (!confirm(`금요일이 아닌 날짜 ${nonFridayRows.length}건을 삭제할까요?`)) return
    setGenerating(true)
    setError('')
    try {
      for (const r of nonFridayRows) await deleteDocument(user.uid, 'accountEval', r.docId)
      await load()
    } catch (e) {
      setError('삭제 오류: ' + e.message)
    }
    setGenerating(false)
  }

  const handleDeleteAll = async () => {
    if (!confirm(`계좌별 평가 테이블 ${rows.length}건을 전체 삭제할까요?`)) return
    await deleteCollectionData(user.uid, 'accountEval')
    await load()
  }

  const handleDeleteAccount = async () => {
    if (selectedAccount === '전체') return
    const count = rows.filter(r => r.accountId === selectedAccount).length
    if (!confirm(`계좌 ${selectedAccount} 데이터 ${count}건을 삭제할까요?`)) return
    await deleteAccountData(user.uid, 'accountEval', selectedAccount)
    await load()
  }

  const accountIds = [...new Set(rows.map(r => r.accountId))].sort()
  const filtered = selectedAccount === '전체' ? rows : rows.filter(r => r.accountId === selectedAccount)

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>계좌별 평가 테이블 생성</h2>
      <p style={styles.desc}>
        보유종목(holdings)+예수금(cash) 데이터를 날짜·계좌별로 합산해 <code style={styles.code}>accountEval</code> 컬렉션으로 저장합니다.
        기존 데이터를 다시 생성하면 같은 날짜·계좌 조합은 덮어씁니다.
      </p>

      <AccountEvalChart
        rows={rows.filter(r => r.accountId !== LOAN_ACCOUNT_ID)}
        startDate={CHART_START_DATE}
        title={`총자산 변동 추이 (계좌별, ${CHART_START_DATE}~)`}
      />

      <div style={styles.toolbar}>
        <button style={styles.genBtn} onClick={handleGenerate} disabled={generating}>
          {generating ? '생성 중...' : '계좌별 평가 테이블 생성'}
        </button>
        <button style={styles.pensionBtn} onClick={handleMigratePension} disabled={generating}>
          {generating ? '생성 중...' : `연금 스냅샷 이전 (~${PENSION_MIGRATE_BEFORE} 이전 → ${PENSION_MIGRATE_ACCOUNT_ID})`}
        </button>
        <button style={styles.pensionBtn} onClick={handleAddLoanToAll} disabled={generating}>
          {generating ? '처리 중...' : '기존 자료에 대출금 추가'}
        </button>
        <button style={styles.pensionBtn} onClick={handleFixWeekendDates} disabled={generating}>
          {generating ? '처리 중...' : '주말 날짜 → 직전 금요일 수정'}
        </button>
        <button style={styles.delBtn} onClick={handleDeleteNonFriday} disabled={generating || !rows.length}>
          금요일 아닌 날짜 삭제
        </button>
        <div style={styles.toolRight}>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} style={styles.select}>
            <option value="전체">전체</option>
            {accountIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button style={styles.delBtn} onClick={handleDeleteAccount} disabled={selectedAccount === '전체' || !rows.length}>
            선택 계좌 삭제
          </button>
          <button style={styles.delAllBtn} onClick={handleDeleteAll} disabled={!rows.length}>
            전체 삭제
          </button>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {loading ? (
        <div style={styles.loading}>로딩 중...</div>
      ) : !rows.length ? (
        <div style={styles.empty}>저장된 계좌별 평가 데이터가 없습니다. 위 버튼으로 생성하세요.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>날짜</th>
                <th style={styles.th}>계좌</th>
                <th style={styles.th}>종목평가금액</th>
                <th style={styles.th}>예수금</th>
                <th style={styles.th}>총액</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
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
      )}
    </div>
  )
}

const styles = {
  container: { maxWidth: 1250, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  desc: { color: '#64748b', fontSize: 13, margin: '8px 0 20px', lineHeight: 1.6 },
  code: { background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  genBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  pensionBtn: { background: 'transparent', color: '#a78bfa', border: '1px solid #6d28d9', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  toolRight: { display: 'flex', gap: 8, alignItems: 'center' },
  select: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none' },
  delBtn: { background: 'transparent', color: '#fb923c', border: '1px solid #7c2d12', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  delAllBtn: { background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  empty: { color: '#64748b', padding: 40, textAlign: 'center' },
  tableWrap: { overflowX: 'auto', background: '#1e293b', borderRadius: 12, padding: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '9px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '9px 12px', whiteSpace: 'nowrap' },
}
