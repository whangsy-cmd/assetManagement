// 실현손익 탭 — 계좌/포맷별 실현손익 붙여넣기 등록 (종목 없는 계좌단위 손익도 지원)
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import {
  parseRealizedProfitCredit, parseRealizedProfitOverseas,
  parseRealizedProfitKrOptionAccount, parseRealizedProfitKrOptionAccount2,
  parseRealizedProfitMirae,
} from '../../utils/parsers'
import { getSectors, saveRealizedProfits } from '../../utils/firestore'

// 동일 일자+종목코드 여러 건은 실현손익/수수료를 합산해서 한 건으로 등록
function aggregate(rows) {
  const grouped = new Map()
  for (const r of rows) {
    const key = `${r.date}_${r.code || ''}`
    if (!grouped.has(key)) grouped.set(key, { ...r })
    else {
      const g = grouped.get(key)
      g.realizedProfit += r.realizedProfit
      g.fee += r.fee
    }
  }
  return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function RealizedProfitCard({ title, fixedAccount, missingMsg, selectableAccounts, parseFn, placeholder, needsCodeLookup, sectors, truncateAmounts }) {
  const { user } = useAuth()
  const [selectedId, setSelectedId] = useState(selectableAccounts?.[0]?.accountId || '')
  useEffect(() => {
    if (selectableAccounts && !selectedId && selectableAccounts.length) setSelectedId(selectableAccounts[0].accountId)
  }, [selectableAccounts, selectedId])
  const account = fixedAccount || selectableAccounts?.find(a => a.accountId === selectedId)
  const accountId = account?.accountId || ''
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    let parsed = parseFn(rawText)
    if (!parsed.length) { setError('파싱 결과가 없습니다. 포맷이 맞는지 확인하세요.'); setRows(null); return }
    if (needsCodeLookup) {
      const nameToCode = Object.fromEntries((sectors || []).map(s => [s.name, s.code]))
      parsed = parsed.map(r => (!r.code && r.name && nameToCode[r.name]) ? { ...r, code: nameToCode[r.name] } : r)
    }
    let aggregated = aggregate(parsed)
    if (truncateAmounts) aggregated = aggregated.map(r => ({ ...r, realizedProfit: Math.trunc(r.realizedProfit), fee: Math.trunc(r.fee) }))
    aggregated = aggregated.filter(r => r.realizedProfit !== 0)
    if (!aggregated.length) { setError('실현손익이 0이 아닌 데이터가 없습니다.'); setRows(null); return }
    setRows(aggregated)
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  const handleSave = async () => {
    if (!rows || !rows.length || !accountId) return
    setSaving(true)
    setError('')
    try {
      await saveRealizedProfits(user.uid, rows.map(r => ({ ...r, accountId })))
      setSavedMsg(`✅ ${rows.length}건 등록 완료`)
      setRows(null)
      setText('')
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeadRow}>
        <h3 style={styles.cardTitle}>{title}</h3>
        {selectableAccounts ? (
          <select style={styles.select} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {selectableAccounts.length === 0 && <option value="">등록된 계좌 없음</option>}
            {selectableAccounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
          </select>
        ) : account ? (
          <span style={styles.accountInline}>{account.name} ({account.accountId})</span>
        ) : (
          <span style={{ color: '#f87171', fontSize: 13 }}>⚠️ {missingMsg}</span>
        )}
      </div>

      {accountId && (
        <>
          <textarea
            style={styles.textarea}
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />
          {error && <p style={styles.error}>{error}</p>}
          {savedMsg && <p style={styles.saved}>{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={styles.preview}>
          <p style={styles.previewTitle}>파싱 결과 (동일 일자·종목 합산) — {rows.length}건</p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>일자</th>
                  <th style={styles.th}>종목코드</th>
                  <th style={styles.th}>종목명</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>실현손익</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>수수료</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={styles.td}>{r.code || '-'}</td>
                    <td style={styles.td}>{r.name || '-'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', color: r.realizedProfit >= 0 ? '#4ade80' : '#f87171' }}>{r.realizedProfit.toLocaleString()}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{r.fee.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}
    </div>
  )
}

// 정해진 붙여넣기 포맷이 없는 계좌의 1회성 등록용 수동 입력 카드 (일자 + 실현손익만)
function ManualEntryCard({ accounts }) {
  const { user } = useAuth()
  const [accountId, setAccountId] = useState(accounts[0]?.accountId || '')
  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].accountId)
  }, [accounts, accountId])
  const [date, setDate] = useState('')
  const [realizedProfit, setRealizedProfit] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const handleSave = async () => {
    setError('')
    setSavedMsg('')
    if (!accountId || !date || !realizedProfit) { setError('계좌/일자/실현손익은 필수입니다.'); return }
    setSaving(true)
    try {
      await saveRealizedProfits(user.uid, [{
        date, accountId, code: '', name: '',
        realizedProfit: Number(realizedProfit) || 0, fee: 0,
      }])
      setSavedMsg('✅ 등록 완료')
      setDate(''); setRealizedProfit('')
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeadRow}>
        <h3 style={styles.cardTitle}>직접 입력 (정해진 포맷 없는 계좌 1회성 등록)</h3>
      </div>
      <div style={styles.manualRow}>
        <select style={styles.select} value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
        </select>
        <input style={styles.manualInput} type="date" value={date} onChange={e => setDate(e.target.value)} />
        <input style={styles.manualInput} placeholder="실현손익" type="number" value={realizedProfit} onChange={e => setRealizedProfit(e.target.value)} />
        <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? '등록 중...' : '등록'}
        </button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {savedMsg && <p style={styles.saved}>{savedMsg}</p>}
    </div>
  )
}

export default function RealizedProfitTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [sectors, setSectors] = useState([])

  useEffect(() => { if (user) getSectors(user.uid).then(setSectors) }, [user])

  const findAcc = id => accounts.find(a => a.accountId === id)
  const miraeAccounts = accounts.filter(a => a.broker === 'mirae')

  return (
    <div>
      <RealizedProfitCard
        title="키움국내 실현손익 (3058-4099)"
        fixedAccount={findAcc('3058-4099')}
        missingMsg="계좌 관리에 3058-4099 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitCredit}
        placeholder="[0328] 일별 종목별 실현손익"
        needsCodeLookup
        sectors={sectors}
        truncateAmounts
      />
      <RealizedProfitCard
        title="키움해외 실현손익 (5124-4860)"
        fixedAccount={findAcc('5124-4860')}
        missingMsg="계좌 관리에 5124-4860 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitOverseas}
        placeholder="[2153] 해외주식 실현손익"
        needsCodeLookup
        sectors={sectors}
      />
      <RealizedProfitCard
        title="키움국내 옵션 계좌손익 (1611-0027)"
        fixedAccount={findAcc('1611-0027')}
        missingMsg="계좌 관리에 1611-0027 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitKrOptionAccount}
        placeholder="[0551] 일별 선물옵션 수익률현황"
      />
      <RealizedProfitCard
        title="키움해외 옵션 계좌손익 (5767-2099)"
        fixedAccount={findAcc('5767-2099')}
        missingMsg="계좌 관리에 5767-2099 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitKrOptionAccount2}
        placeholder="[4556] 해외선옵 원화추정 기간별손익현황"
      />
      <RealizedProfitCard
        title="미래에셋 실현손익"
        selectableAccounts={miraeAccounts}
        parseFn={parseRealizedProfitMirae}
        placeholder="[0674] 일자별 평가손익"
      />
      <ManualEntryCard accounts={accounts} />
    </div>
  )
}

const styles = {
  card: { background: '#1e293b', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  cardHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, margin: 0 },
  accountInline: { color: '#94a3b8', fontSize: 13 },
  select: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', color: '#f1f5f9', fontSize: 13 },
  manualRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  manualInput: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: '#f1f5f9', fontSize: 13, width: 140 },
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  error: { color: '#f87171', fontSize: 13, marginTop: 8 },
  saved: { color: '#4ade80', fontSize: 13, marginTop: 8 },
  preview: { marginTop: 16 },
  previewTitle: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { color: '#e2e8f0', padding: '7px 10px', borderBottom: '1px solid #0f172a', whiteSpace: 'nowrap' },
  saveBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 14, marginTop: 14 },
}
