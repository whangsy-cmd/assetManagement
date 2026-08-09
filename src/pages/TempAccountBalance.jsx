import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  saveTempAccountBalance, getAllTempAccountBalance,
  getAllAccountEval, saveAccountEval,
  deleteCollectionData, deleteAccountData,
} from '../utils/firestore'

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

function parseNum(s) {
  return parseInt(String(s ?? '').replace(/["\s,]/g, ''), 10) || 0
}

// 계좌번호는 리포트 포맷별로 고정 (계좌를 직접 입력받지 않고 포맷 선택으로 결정)
const FORMATS = [
  {
    key: 'kiwoom_kr_stock',
    label: '키움국내 (3058-4099)',
    accountId: '3058-4099',
    // 예탁자산→총액, 유가증권 평가금→종목평가금액, 차액→예수금
    parseRow: cols => {
      const totalAmt = parseNum(cols[1]) // 예탁자산
      const evalAmt = parseNum(cols[2])  // 유가증권 평가금
      return { evalAmt, cashAmt: totalAmt - evalAmt, totalAmt }
    },
  },
  {
    key: 'kiwoom_us_stock',
    label: '키움해외 (5124-4860)',
    accountId: '5124-4860',
    // 예탁자산→예탁금, 유가증권 평가금→종목평가금액, 차액→예수금
    parseRow: cols => {
      const totalAmt = parseNum(cols[1]) // 예탁자산
      const evalAmt = parseNum(cols[2])  // 유가증권 평가금
      return { evalAmt, cashAmt: totalAmt - evalAmt, totalAmt }
    },
  },
  {
    key: 'kiwoom_kr_option',
    label: '키움국내옵션 (1611-0027)',
    accountId: '1611-0027',
    // 예탁자산=종목평가금액=예탁자산, 예수금=0
    parseRow: cols => {
      const totalAmt = parseNum(cols[1]) // 예탁자산
      return { evalAmt: totalAmt, cashAmt: 0, totalAmt }
    },
  },
  {
    key: 'kiwoom_us_option',
    label: '키움해외옵션 (5767-2099)',
    accountId: '5767-2099',
    // 예수금→예수금, 옵션평가차금(전일)→종목평가금액, 예수금+옵션평가차금(전일)→예탁자산
    parseRow: cols => {
      const cashAmt = parseNum(cols[1]) // 예수금
      const evalAmt = parseNum(cols[3]) // 옵션평가차금(전일)
      return { evalAmt, cashAmt, totalAmt: cashAmt + evalAmt }
    },
  },
]

const HOLIDAY_FIX_ACCOUNT = '3058-4099'

// 일자\t예탁자산\t... 형식 (나머지 컬럼은 무시)
// 날짜가 빈 서브행은 date 정규식에 안 걸려 자동 스킵됨
function parseDailyBalanceText(text, format) {
  const lines = text.trim().split('\n')
  const rows = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 2) continue
    const dateRaw = cols[0].trim()
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw)) continue
    const date = dateRaw.replace(/\//g, '-')
    const row = { date, ...format.parseRow(cols) }
    if (row.totalAmt < 100000) continue // 예탁자산 10만원 미만은 제외 (미개설/청산 구간 노이즈)
    rows.push(row)
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export default function TempAccountBalance() {
  const { user } = useAuth()
  const [formatKey, setFormatKey] = useState(FORMATS[0].key)
  const format = FORMATS.find(f => f.key === formatKey)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')

  const [joined, setJoined] = useState(null)
  const [joining, setJoining] = useState(false)
  const [registering, setRegistering] = useState(false)

  const load = async () => {
    setLoading(true)
    setRows(await getAllTempAccountBalance(user.uid))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const tryParse = (raw) => {
    setError('')
    setPreview(null)
    const parsed = parseDailyBalanceText(raw, format)
    if (!parsed.length) {
      setError('파싱 결과가 없습니다. 형식을 확인하세요.')
      return
    }
    setPreview(parsed)
  }

  const handlePaste = (e) => {
    const raw = e.clipboardData.getData('text')
    if (!raw.trim()) return
    setTimeout(() => tryParse(raw), 0)
  }

  const handleSave = async () => {
    if (!preview?.length) return
    setSaving(true)
    setError('')
    try {
      await saveTempAccountBalance(user.uid, preview.map(r => ({ ...r, accountId: format.accountId })))
      setPreview(null)
      setText('')
      await load()
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  // 3058-4099 계좌: 데이터 범위 내 금요일 중 공휴일 등으로 자료 없는 날을 직전 영업일 데이터로 채운다
  const handleFillHolidayFridays = async () => {
    const accRows = rows.filter(r => r.accountId === HOLIDAY_FIX_ACCOUNT).sort((a, b) => a.date.localeCompare(b.date))
    if (!accRows.length) { alert(`${HOLIDAY_FIX_ACCOUNT} 데이터가 없습니다.`); return }
    const byDate = new Map(accRows.map(r => [r.date, r]))
    const toFill = []
    let lastRow = null
    const end = new Date(accRows[accRows.length - 1].date + 'T00:00:00Z')
    for (let t = new Date(accRows[0].date + 'T00:00:00Z'); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
      const iso = t.toISOString().slice(0, 10)
      const existing = byDate.get(iso)
      if (existing) { lastRow = existing; continue }
      if (t.getUTCDay() === 5 && lastRow) {
        toFill.push({ date: iso, accountId: HOLIDAY_FIX_ACCOUNT, evalAmt: lastRow.evalAmt, cashAmt: lastRow.cashAmt, totalAmt: lastRow.totalAmt })
      }
    }
    if (!toFill.length) { alert('보정할 공휴일 금요일이 없습니다.'); return }
    if (!confirm(`${HOLIDAY_FIX_ACCOUNT} 계좌의 공휴일 금요일 ${toFill.length}건을 직전 영업일 데이터로 채울까요?\n${toFill.map(r => r.date).join(', ')}`)) return
    setSaving(true)
    setError('')
    try {
      await saveTempAccountBalance(user.uid, toFill)
      await load()
    } catch (e) {
      setError('공휴일 보정 오류: ' + e.message)
    }
    setSaving(false)
  }

  const handleDeleteAll = async () => {
    if (!confirm(`임시계좌일별잔고 ${rows.length}건을 전체 삭제할까요?`)) return
    await deleteCollectionData(user.uid, 'tempAccountDailyBalance')
    await load()
  }

  const handleDeleteAccount = async () => {
    if (selectedAccount === '전체') return
    const count = rows.filter(r => r.accountId === selectedAccount).length
    if (!confirm(`계좌 ${selectedAccount} 데이터 ${count}건을 삭제할까요?`)) return
    await deleteAccountData(user.uid, 'tempAccountDailyBalance', selectedAccount)
    await load()
  }

  // 계좌별평가 테이블에 있는 날짜 기준으로 임시계좌잔고를 조인. 계좌별평가에 없는 날짜의 임시계좌잔고는 버린다.
  // (같은 날짜·계좌 조합이면 임시계좌잔고 값이 우선)
  const handleJoin = async () => {
    setJoining(true)
    setError('')
    try {
      const [evalRows, tempRows] = await Promise.all([getAllAccountEval(user.uid), getAllTempAccountBalance(user.uid)])
      const evalDates = new Set(evalRows.map(r => r.date))
      const combined = new Map()
      for (const r of evalRows) {
        combined.set(`${r.date}_${r.accountId}`, { date: r.date, accountId: r.accountId, evalAmt: r.evalAmt, cashAmt: r.cashAmt, totalAmt: r.totalAmt, source: '기존' })
      }
      for (const r of tempRows) {
        if (!evalDates.has(r.date)) continue // 계좌별평가에 없는 날짜는 버림
        combined.set(`${r.date}_${r.accountId}`, { date: r.date, accountId: r.accountId, evalAmt: r.evalAmt, cashAmt: r.cashAmt, totalAmt: r.totalAmt, source: '임시' })
      }
      setJoined([...combined.values()].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId)))
    } catch (e) {
      setError('조인 오류: ' + e.message)
    }
    setJoining(false)
  }

  const handleRegisterJoined = async () => {
    if (!joined?.length) return
    setRegistering(true)
    setError('')
    try {
      await saveAccountEval(user.uid, joined.map(({ date, accountId, evalAmt, cashAmt, totalAmt }) => ({ date, accountId, evalAmt, cashAmt, totalAmt })))
      setJoined(null)
    } catch (e) {
      setError('등록 오류: ' + e.message)
    }
    setRegistering(false)
  }

  const accountIds = [...new Set(rows.map(r => r.accountId))].sort()
  const filtered = selectedAccount === '전체' ? rows : rows.filter(r => r.accountId === selectedAccount)

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>임시계좌일별잔고</h2>
      <p style={styles.desc}>
        증권사 리포트를 붙여넣어 계좌별 일별 잔고를 임시 저장합니다. 계좌번호는 리포트 포맷에 따라 고정됩니다.<br />
        <span style={styles.descSub}>
          키움국내: 예탁자산→총액, 유가증권 평가금→종목평가금액, 차액→예수금 · 키움국내옵션: 예탁자산→총액=종목평가금액, 예수금=0
        </span>
      </p>

      <div style={styles.accountRow}>
        <label style={styles.accountLabel}>리포트 포맷</label>
        <select style={styles.accountInput} value={formatKey} onChange={e => { setFormatKey(e.target.value); setPreview(null); setText('') }}>
          {FORMATS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>

      {!preview && (
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

      {preview && (
        <>
          <div style={styles.previewHeader}>
            <span style={styles.previewCount}>{preview.length}건 파싱됨 (계좌: {format.accountId})</span>
            <button style={styles.resetBtn} onClick={() => { setPreview(null); setText('') }}>다시 입력</button>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>날짜</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>예탁자산</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(r => (
                  <tr key={r.date} style={styles.tr}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(r.evalAmt)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(r.cashAmt)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(r.totalAmt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={styles.actions}>
            <button style={{ ...styles.saveBtn, opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : `${preview.length}건 저장`}
            </button>
          </div>
        </>
      )}

      <h3 style={styles.subheading}>저장된 데이터</h3>
      <div style={styles.toolbar}>
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
        <button style={styles.holidayBtn} onClick={handleFillHolidayFridays} disabled={saving}>
          {HOLIDAY_FIX_ACCOUNT} 공휴일 금요일 보정
        </button>
      </div>

      {loading ? (
        <div style={styles.loading}>로딩 중...</div>
      ) : !rows.length ? (
        <div style={styles.empty}>저장된 데이터가 없습니다.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>날짜</th>
                <th style={styles.th}>계좌</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>예탁자산</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.docId} style={styles.tr}>
                  <td style={styles.td}>{row.date}</td>
                  <td style={styles.td}>{row.accountId}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.cashAmt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalAmt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={styles.subheading}>계좌별평가 조인</h3>
      <p style={styles.desc}>
        임시계좌잔고에 있는 날짜 기준으로 계좌별평가 테이블과 합쳐서 보여줍니다. 등록하면 계좌별평가 테이블(accountEval)에 반영됩니다.
      </p>
      <div style={styles.toolbar}>
        <button style={styles.parseBtn} onClick={handleJoin} disabled={joining}>
          {joining ? '조인 중...' : '계좌별평가 조인'}
        </button>
        {joined && (
          <button style={{ ...styles.saveBtn, padding: '9px 24px', fontSize: 13, opacity: registering ? 0.5 : 1 }} onClick={handleRegisterJoined} disabled={registering}>
            {registering ? '등록 중...' : `조인결과등록 (${joined.length}건)`}
          </button>
        )}
      </div>

      {joined && (
        !joined.length ? (
          <div style={styles.empty}>조인 결과가 없습니다. 임시계좌잔고 데이터를 먼저 저장하세요.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>날짜</th>
                  <th style={styles.th}>계좌</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>종목평가금액</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>예수금</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>예탁자산</th>
                  <th style={styles.th}>출처</th>
                </tr>
              </thead>
              <tbody>
                {joined.map(row => (
                  <tr key={`${row.date}_${row.accountId}`} style={styles.tr}>
                    <td style={styles.td}>{row.date}</td>
                    <td style={styles.td}>{row.accountId}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.evalAmt)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(row.cashAmt)}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{fmt(row.totalAmt)}</td>
                    <td style={{ ...styles.td, color: row.source === '임시' ? '#a78bfa' : '#64748b' }}>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

const styles = {
  container: { maxWidth: 1250, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  desc: { color: '#94a3b8', fontSize: 14, margin: '8px 0 20px', lineHeight: 1.6 },
  descSub: { color: '#475569', fontSize: 12 },
  accountRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  accountLabel: { color: '#94a3b8', fontSize: 13, whiteSpace: 'nowrap' },
  accountInput: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, width: 200 },
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
  actions: { display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', marginBottom: 32 },
  saveBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  subheading: { color: '#f1f5f9', fontSize: 16, fontWeight: 700, marginBottom: 12 },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 },
  select: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none' },
  delBtn: { background: 'transparent', color: '#fb923c', border: '1px solid #7c2d12', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  delAllBtn: { background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  holidayBtn: { background: 'transparent', color: '#a78bfa', border: '1px solid #6d28d9', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  empty: { color: '#64748b', padding: 40, textAlign: 'center' },
}
