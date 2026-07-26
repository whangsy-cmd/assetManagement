import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

function parseNum(str) {
  return parseInt(String(str).replace(/,/g, '').trim(), 10) || 0
}

function fmt(n) {
  if (!n && n !== 0) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return n.toLocaleString()
}

function parseRate(str) {
  return parseFloat(String(str).replace('%', '').replace(/,/g, '').trim()) || 0
}

// 날짜\t연금\t연금증감\t연금증가율\t날짜\t한국주식\t한국증감\t한국증가율\t날짜\t미국주식\t미국증감\t미국증가율
function parseMigrationText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    if (cols.length < 11) continue
    const date = cols[0].replace(/\s*-\s*/g, '-').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue

    const pensionBalance  = parseNum(cols[1])
    const pensionChange   = parseNum(cols[2])
    const pensionRate     = parseRate(cols[3])
    const koreanBalance   = parseNum(cols[5])
    const koreanChange    = parseNum(cols[6])
    const koreanRate      = parseRate(cols[7])
    const usBalance       = parseNum(cols[9])
    const usChange        = parseNum(cols[10])
    const usRate          = parseRate(cols[11])

    const totalBalance = pensionBalance + koreanBalance + usBalance
    const totalChange  = pensionChange + koreanChange + usChange
    const prevTotal    = totalBalance - totalChange
    const totalChangeRate = prevTotal > 0 ? (totalChange / prevTotal) * 100 : 0

    rows.push({
      date,
      pension:  { balance: pensionBalance,  change: pensionChange,  changeRate: pensionRate },
      domestic: { balance: koreanBalance,   change: koreanChange,   changeRate: koreanRate },
      overseas: { balance: usBalance,       change: usChange,       changeRate: usRate },
      totalBalance,
      totalChange,
      totalChangeRate,
      totalLoan: 0,
      netBalance: totalBalance,
    })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export default function Migration() {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [loanAmount, setLoanAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(0)
  const [done, setDone] = useState(false)

  const loan = parseInt(String(loanAmount).replace(/,/g, ''), 10) || 0

  const handlePaste = (e) => {
    const raw = e.clipboardData.getData('text')
    if (!raw.trim()) return
    setTimeout(() => {
      tryParse(raw)
    }, 0)
  }

  const tryParse = (raw) => {
    setError('')
    setRows(null)
    setDone(false)
    setSaved(0)
    try {
      const parsed = parseMigrationText(raw)
      if (!parsed.length) {
        setError('파싱 결과가 없습니다. 형식을 확인하세요.')
        return
      }
      setRows(parsed)
    } catch (e) {
      setError('파싱 오류: ' + e.message)
    }
  }

  const handleSave = async () => {
    if (!rows?.length) return
    setSaving(true)
    setSaved(0)
    setError('')
    try {
      for (const row of rows) {
        await setDoc(doc(db, 'users', user.uid, 'snapshots', row.date), {
          ...row,
          totalLoan: loan,
          netBalance: row.totalBalance - loan,
          createdAt: serverTimestamp(),
        })
        setSaved(n => n + 1)
      }
      setDone(true)
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>과거 데이터 이전</h2>
      <p style={styles.desc}>
        엑셀에서 복사한 과거 주간 데이터를 아래에 붙여넣으세요.<br />
        <span style={styles.descSub}>날짜·연금·한국주식·미국주식 컬럼 포함 헤더행 포함 전체 선택 후 복사</span>
      </p>

      <div style={styles.loanRow}>
        <label style={styles.loanLabel}>대출금액</label>
        <input
          style={styles.loanInput}
          type="text"
          value={loanAmount}
          onChange={e => setLoanAmount(e.target.value)}
          placeholder="예: 50000000"
        />
        {loan > 0 && <span style={styles.loanHint}>{fmt(loan)}원 차감 적용됨</span>}
      </div>

      {!rows && (
        <div style={styles.pasteArea}>
          <textarea
            style={styles.textarea}
            value={text}
            onChange={e => setText(e.target.value)}
            onPaste={handlePaste}
            placeholder="여기에 Ctrl+V"
            rows={6}
          />
          {text.trim() && (
            <button style={styles.parseBtn} onClick={() => tryParse(text)}>파싱</button>
          )}
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {rows && !done && (
        <>
          <div style={styles.previewHeader}>
            <span style={styles.previewCount}>{rows.length}건 파싱됨</span>
            <button style={styles.resetBtn} onClick={() => { setRows(null); setText(''); setSaved(0) }}>다시 입력</button>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>날짜</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>연금</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>국내</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>해외</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>총잔액</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>총증감</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>증가율</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>순자산</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(r.pension.balance)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(r.domestic.balance)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(r.overseas.balance)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(r.totalBalance)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', color: r.totalChange >= 0 ? '#22c55e' : '#ef4444' }}>
                      {r.totalChange >= 0 ? '+' : ''}{fmt(r.totalChange)}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', color: r.totalChangeRate >= 0 ? '#22c55e' : '#ef4444' }}>
                      {r.totalChangeRate >= 0 ? '+' : ''}{r.totalChangeRate.toFixed(2)}%
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, color: '#a78bfa' }}>
                      {fmt(r.totalBalance - loan)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={styles.actions}>
            {saving && <span style={styles.progress}>{saved} / {rows.length} 저장 중...</span>}
            <button
              style={{ ...styles.saveBtn, opacity: saving ? 0.5 : 1 }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? `저장 중... (${saved}/${rows.length})` : `${rows.length}건 스냅샷 저장`}
            </button>
          </div>
        </>
      )}

      {done && (
        <div style={styles.doneCard}>
          <p style={styles.doneTitle}>✅ {saved}건 저장 완료</p>
          <p style={styles.doneDesc}>대시보드에서 총 자산 변동 추이를 확인하세요.</p>
          <button style={styles.resetBtn} onClick={() => { setRows(null); setText(''); setSaved(0); setDone(false) }}>
            추가 데이터 입력
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { maxWidth: 960, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 8 },
  desc: { color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 1.6 },
  descSub: { color: '#475569', fontSize: 12 },
  pasteArea: { marginBottom: 16 },
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  parseBtn: { marginTop: 10, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  previewHeader: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 },
  previewCount: { color: '#94a3b8', fontSize: 13 },
  resetBtn: { background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  tableWrap: { overflowX: 'auto', marginBottom: 20 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#1e293b', color: '#64748b', padding: '9px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '8px 12px', whiteSpace: 'nowrap' },
  actions: { display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end' },
  progress: { color: '#94a3b8', fontSize: 13 },
  saveBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  loanRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  loanLabel: { color: '#94a3b8', fontSize: 13, whiteSpace: 'nowrap' },
  loanInput: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, width: 160 },
  loanHint: { color: '#a78bfa', fontSize: 12 },
  doneCard: { background: '#0f2d1a', border: '1px solid #22c55e', borderRadius: 12, padding: 40, textAlign: 'center' },
  doneTitle: { color: '#4ade80', fontSize: 20, fontWeight: 700, marginBottom: 10 },
  doneDesc: { color: '#94a3b8', fontSize: 14, marginBottom: 24 },
}
