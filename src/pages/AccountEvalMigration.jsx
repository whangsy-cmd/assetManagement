import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import {
  getAllHoldings, getAllCash, getAllSnapshots, saveAccountEval, getAllAccountEval,
  deleteCollectionData, deleteAccountData, deleteDocument,
} from '../utils/firestore'

const PENSION_MIGRATE_ACCOUNT_ID = '000-0000-0000'
const PENSION_MIGRATE_BEFORE = '2026-05-10' // 이 날짜 이전 스냅샷만 이전 (계좌 분리 전 연금 데이터)
const PENSION_FILL_UNTIL = '2026-05-01' // 금요일 공백 보정은 이 날짜까지만
const CHART_START_DATE = '2025-02-07'
const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#84cc16']

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

// Y축/툴팁용 축약 표기 (억/만)
function fmtAbbrev(n) {
  if (n === undefined || n === null) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return n.toLocaleString()
}

// 차트 스택 순서 (아래→위): 옵션계좌 2개 → 연금 등 나머지(계좌번호순) → 키움국내 → 키움해외
const CHART_OPTION_ACCOUNTS = new Set(['1611-0027', '5767-2099'])
const CHART_KIWOOM_KR_STOCK = '3058-4099'
const CHART_KIWOOM_US_STOCK = '5124-4860'

function chartAccountRank(accountId) {
  if (CHART_OPTION_ACCOUNTS.has(accountId)) return 0
  if (accountId === CHART_KIWOOM_KR_STOCK) return 2
  if (accountId === CHART_KIWOOM_US_STOCK) return 3
  return 1
}

// 계좌별 총액(totalAmt)을 날짜 기준으로 피벗해 스택 영역 차트 데이터 생성
// 예탁금 없거나 0인 (날짜,계좌)는 제외 — 해당 계좌는 그 날 그래프에 표시 안 함
function buildChartData(rows) {
  const filtered = rows.filter(r => r.date >= CHART_START_DATE && r.totalAmt)
  const accountIds = [...new Set(filtered.map(r => r.accountId))]
    .sort((a, b) => chartAccountRank(a) - chartAccountRank(b) || a.localeCompare(b))
  const byDateAccount = new Map()
  for (const r of filtered) byDateAccount.set(`${r.date}_${r.accountId}`, r.totalAmt)
  const dates = [...new Set(filtered.map(r => r.date))].sort()
  const data = dates.map(date => {
    const point = { date }
    for (const accountId of accountIds) {
      const v = byDateAccount.get(`${date}_${accountId}`)
      if (v) point[accountId] = v
    }
    return point
  })
  return { data, accountIds }
}

function AccountEvalTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0)
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>
      {payload.filter(p => p.value).map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>{p.dataKey}: {p.value.toLocaleString()}원</p>
      ))}
      <p style={{ color: '#f1f5f9', borderTop: '1px solid #334155', marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
        합계: {total.toLocaleString()}원
      </p>
    </div>
  )
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

// holdings+cash를 date_accountId 기준으로 합산해 계좌별 평가 행 생성
function buildRows(holdings, cash) {
  const evalByKey = new Map()
  for (const h of holdings) {
    const key = `${h.date}_${h.accountId}`
    evalByKey.set(key, (evalByKey.get(key) || 0) + (h.evalAmt || 0))
  }
  const rows = []
  for (const c of cash) {
    const key = `${c.date}_${c.accountId}`
    const evalAmt = evalByKey.get(key) || 0
    rows.push({
      date: c.date,
      accountId: c.accountId,
      evalAmt,
      cashAmt: c.amount || 0,
      totalAmt: evalAmt + (c.amount || 0),
    })
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))
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
      const built = buildRows(holdings, cash)
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

  const { data: chartData, accountIds: chartAccountIds } = buildChartData(rows)

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>계좌별 평가 테이블 생성</h2>
      <p style={styles.desc}>
        보유종목(holdings)+예수금(cash) 데이터를 날짜·계좌별로 합산해 <code style={styles.code}>accountEval</code> 컬렉션으로 저장합니다.
        기존 데이터를 다시 생성하면 같은 날짜·계좌 조합은 덮어씁니다.
      </p>

      {chartData.length > 0 && (
        <div style={styles.chartCard}>
          <div style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>총자산 변동 추이 (계좌별, {CHART_START_DATE}~)</h3>
            <div style={styles.legend}>
              {chartAccountIds.map((id, i) => (
                <span key={id} style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, background: CHART_COLORS[i % CHART_COLORS.length] }} />{id}
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={fmtAbbrev} width={60} />
              <Tooltip content={<AccountEvalTooltip />} />
              {chartAccountIds.map((id, i) => (
                <Area
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stackId="1"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeOpacity={0.5}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.5}
                  strokeWidth={1}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={styles.toolbar}>
        <button style={styles.genBtn} onClick={handleGenerate} disabled={generating}>
          {generating ? '생성 중...' : '계좌별 평가 테이블 생성'}
        </button>
        <button style={styles.pensionBtn} onClick={handleMigratePension} disabled={generating}>
          {generating ? '생성 중...' : `연금 스냅샷 이전 (~${PENSION_MIGRATE_BEFORE} 이전 → ${PENSION_MIGRATE_ACCOUNT_ID})`}
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
  container: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  desc: { color: '#64748b', fontSize: 13, margin: '8px 0 20px', lineHeight: 1.6 },
  code: { background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' },
  chartCard: { background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 16 },
  chartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  chartTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, margin: 0 },
  legend: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#94a3b8' },
  legendDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
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
