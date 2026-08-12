// 실현손익 탭 — 계좌/포맷별 실현손익 붙여넣기 등록 (종목 없는 계좌단위 손익도 지원)
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import {
  parseRealizedProfitCredit, parseRealizedProfitOverseas,
  parseRealizedProfitKrOptionAccount, parseRealizedProfitKrOptionAccount2,
  parseRealizedProfitMirae,
} from '../../utils/parsers'
import { getSectors, saveRealizedProfits, deleteDocument } from '../../utils/firestore'
import '../../common.css'

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
    <div className="card" style={{ margin: 0 }}>
      <div className="section-header">
        <h3 className="section-title">{title}</h3>
        {selectableAccounts ? (
          <select className="select input-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {selectableAccounts.length === 0 && <option value="">등록된 계좌 없음</option>}
            {selectableAccounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
          </select>
        ) : account ? (
          <span className="text-muted">{account.name} ({account.accountId})</span>
        ) : (
          <span className="neg" style={{ fontSize: 13 }}>⚠️ {missingMsg}</span>
        )}
      </div>

      {accountId && (
        <>
          <textarea
            className="textarea"
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />
          {error && <p className="text-error" style={{ marginTop: 8 }}>{error}</p>}
          {savedMsg && <p className="text-success" style={{ marginTop: 8 }}>{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label">파싱 결과 (동일 일자·종목 합산) — {rows.length}건</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>종목코드</th>
                  <th>종목명</th>
                  <th style={{ textAlign: 'right' }}>실현손익</th>
                  <th style={{ textAlign: 'right' }}>수수료</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.code || '-'}</td>
                    <td>{r.name || '-'}</td>
                    <td className={r.realizedProfit >= 0 ? 'pos' : 'neg'} style={{ textAlign: 'right' }}>{r.realizedProfit.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{r.fee.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
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
    if (!accountId || !date || realizedProfit === '') { setError('계좌/일자/실현손익은 필수입니다.'); return }
    setSaving(true)
    try {
      const val = Number(realizedProfit) || 0
      if (val === 0) {
        // 0 입력 시 등록 대신 해당 일자/계좌의 기존 실현손익 행 삭제
        await deleteDocument(user.uid, 'realizedProfits', `${date}_${accountId}`)
        setSavedMsg('✅ 삭제 완료')
      } else {
        await saveRealizedProfits(user.uid, [{ date, accountId, code: '', name: '', realizedProfit: val, fee: 0 }])
        setSavedMsg('✅ 등록 완료')
      }
      setDate(''); setRealizedProfit('')
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="section-header">
        <h3 className="section-title">직접 입력 (정해진 포맷 없는 계좌 1회성 등록)</h3>
      </div>
      <div style={styles.manualRow}>
        <select className="select input-sm" value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
        </select>
        <input className="input input-sm" style={{ width: 140 }} type="date" value={date} onChange={e => setDate(e.target.value)} />
        <input className="input input-sm" style={{ width: 140 }} placeholder="실현손익" type="number" value={realizedProfit} onChange={e => setRealizedProfit(e.target.value)} />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '등록 중...' : '등록'}
        </button>
      </div>
      {error && <p className="text-error" style={{ marginTop: 8 }}>{error}</p>}
      {savedMsg && <p className="text-success" style={{ marginTop: 8 }}>{savedMsg}</p>}
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
  manualRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
}
