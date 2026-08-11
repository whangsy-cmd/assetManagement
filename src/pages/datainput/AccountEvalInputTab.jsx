// 계좌평가 등록 탭 — 미래에셋 계좌 일별자산현황 붙여넣기로 계좌별평가(accountEval) 등록
// 단일계좌 포맷(조회일자 헤더): 당일자산총액=종목평가금액=총액, 예수금 0, 선택된 계좌로 등록
// 계좌별 일괄 포맷(일자+계좌번호 헤더): D+2원화예수금=예수금, 순자산총액=총액, 평가금액=종목평가금액, 행의 계좌번호로 등록(계좌 선택 무관)
// 계좌평가에 (계좌 무관) 데이터가 하나도 없는 날짜는 제외.
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { parseMiraeAccountEval, parseMiraeAccountEvalMulti } from '../../utils/parsers'
import { getAllAccountEval, saveAccountEval } from '../../utils/firestore'

export default function AccountEvalInputTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const miraeAccounts = accounts.filter(a => a.broker === 'mirae')

  const [accountId, setAccountId] = useState('')
  useEffect(() => {
    if (!accountId && miraeAccounts.length) setAccountId(miraeAccounts[0].accountId)
  }, [miraeAccounts, accountId])

  const [existingDates, setExistingDates] = useState(new Set())
  useEffect(() => {
    if (!user) return
    getAllAccountEval(user.uid).then(rows => {
      setExistingDates(new Set(rows.map(r => r.date)))
    })
  }, [user])

  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [skippedCount, setSkippedCount] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const rowKey = r => `${r.date}_${r.accountId}`

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    const multi = parseMiraeAccountEvalMulti(rawText)
    let parsed
    if (multi.length) {
      parsed = multi
    } else {
      const single = parseMiraeAccountEval(rawText)
      if (!single.length) { setError('파싱 결과가 없습니다. 포맷이 맞는지 확인하세요.'); setRows(null); return }
      parsed = single.map(r => ({ date: r.date, accountId, evalAmt: r.totalAmt, cashAmt: 0, totalAmt: r.totalAmt }))
    }
    const matched = parsed.filter(r => existingDates.has(r.date))
    setSkippedCount(parsed.length - matched.length)
    if (!matched.length) { setError('계좌평가에 데이터가 있는 날짜가 없습니다.'); setRows(null); return }
    setRows(matched)
    setSelected(new Set(matched.map(rowKey)))
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  const toggleRow = (key) => {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    if (!rows) return
    const toSave = rows.filter(r => selected.has(rowKey(r)))
    if (!toSave.length) return
    setSaving(true)
    setError('')
    try {
      await saveAccountEval(user.uid, toSave.map(r => ({
        date: r.date, accountId: r.accountId, evalAmt: r.evalAmt, cashAmt: r.cashAmt, totalAmt: r.totalAmt,
      })))
      setSavedMsg(`✅ ${toSave.length}건 등록 완료`)
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
        <h3 style={styles.cardTitle}>미래에셋 계좌평가 등록</h3>
        <select style={styles.select} value={accountId} onChange={e => setAccountId(e.target.value)}>
          {miraeAccounts.length === 0 && <option value="">등록된 미래에셋 계좌 없음</option>}
          {miraeAccounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
        </select>
      </div>

      {accountId && (
        <>
          <textarea
            style={styles.textarea}
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
            onPaste={handlePaste}
            placeholder="일별자산현황 (조회일자 · 전일자산총액 · 당일자산총액 · ...) 또는 계좌별 일괄 (일자 · 계좌번호 · 계좌유형 · D+2원화예수금 · 순자산총액 · 평가금액)"
            rows={4}
          />
          {error && <p style={styles.error}>{error}</p>}
          {savedMsg && <p style={styles.saved}>{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={styles.preview}>
          <p style={styles.previewTitle}>
            계좌평가에 데이터 있는 날짜만 표시 — {rows.length}건 매칭{skippedCount ? `, ${skippedCount}건 제외` : ''}
          </p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}></th>
                  <th style={styles.th}>일자</th>
                  <th style={styles.th}>계좌</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>총액</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={rowKey(r)}>
                    <td style={styles.td}>
                      <input type="checkbox" checked={selected.has(rowKey(r))} onChange={() => toggleRow(rowKey(r))} />
                    </td>
                    <td style={styles.td}>{r.date}</td>
                    <td style={styles.td}>{r.accountId}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{r.evalAmt.toLocaleString()}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{r.cashAmt.toLocaleString()}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{r.totalAmt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving || !selected.size}>
            {saving ? '등록 중...' : `선택 ${selected.size}건 등록`}
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  card: { background: '#1e293b', borderRadius: 12, padding: '20px 24px', marginBottom: 16 },
  cardHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, margin: 0 },
  select: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', color: '#f1f5f9', fontSize: 13 },
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
