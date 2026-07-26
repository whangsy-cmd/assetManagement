import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import {
  parseMiraeHoldings, parseMiraeCash,
  parseKiwoomKrHoldings, parseKiwoomKrCash,
  parseKiwoomUsHoldings, parseKiwoomUsCash,
} from '../utils/parsers'
import {
  fetchKrHoldings, fetchKrCash, fetchUsLedger, fetchUsCashDetail,
  transformKrHoldings, transformKrCash, transformUsHoldings, transformUsCash,
} from '../utils/kiwoomApi'
import { saveHoldings, saveCash, ensureSectors, createSnapshot, getSectors } from '../utils/firestore'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

// 키움 먼저, 미래에셋 마지막
const STEPS = [
  { broker: 'kiwoom_kr', kind: 'holdings', label: '키움 국내 보유종목', btn: '키움 국내 종목' },
  { broker: 'kiwoom_kr', kind: 'cash',     label: '키움 국내 예수금',   btn: '키움 국내 예수금' },
  { broker: 'kiwoom_us', kind: 'holdings', label: '키움 해외 보유종목', btn: '키움 해외 종목' },
  { broker: 'kiwoom_us', kind: 'cash',     label: '키움 해외 예수금',   btn: '키움 해외 예수금' },
  { broker: 'mirae',     kind: 'holdings', label: '미래에셋 보유종목',  btn: '미래에셋 종목' },
  { broker: 'mirae',     kind: 'cash',     label: '미래에셋 예수금',    btn: '미래에셋 예수금' },
]

// ── 미래에셋 종목코드 입력 UI ────────────────────────────────
function MiraeCodeInput({ rows, onConfirm }) {
  const [codes, setCodes] = useState(() =>
    Object.fromEntries(rows.map(r => [r.name, r.code === r.name ? '' : r.code]))
  )

  const allFilled = rows.every(r => {
    if (r.code !== r.name) return true // 이미 코드 있음
    return (codes[r.name] || '').trim() !== ''
  })

  const handleConfirm = () => {
    const updated = rows.map(r => ({
      ...r,
      code: r.code !== r.name ? r.code : codes[r.name].trim(),
    }))
    onConfirm(updated)
  }

  return (
    <div style={codeStyles.box}>
      <p style={codeStyles.title}>종목코드 확인</p>
      <p style={codeStyles.desc}>미래에셋 데이터에는 종목코드가 없습니다. 신규 종목은 코드를 직접 입력하세요.</p>
      <div style={codeStyles.tableWrap}>
        <table style={codeStyles.table}>
          <thead>
            <tr>
              <th style={codeStyles.th}>계좌</th>
              <th style={codeStyles.th}>종목명</th>
              <th style={codeStyles.th}>종목코드</th>
              <th style={codeStyles.th}>평가금액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isNew = r.code === r.name
              return (
                <tr key={i} style={codeStyles.tr}>
                  <td style={codeStyles.td}>{r.accountId}</td>
                  <td style={codeStyles.td}>{r.name}</td>
                  <td style={codeStyles.td}>
                    {isNew ? (
                      <input
                        style={{
                          ...codeStyles.input,
                          borderColor: codes[r.name]?.trim() ? '#22c55e' : '#ef4444',
                        }}
                        value={codes[r.name] || ''}
                        onChange={e => setCodes(c => ({ ...c, [r.name]: e.target.value }))}
                        placeholder="코드 입력"
                        autoFocus={i === 0}
                      />
                    ) : (
                      <code style={codeStyles.code}>{r.code}</code>
                    )}
                  </td>
                  <td style={codeStyles.td}>{r.evalAmt?.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        style={{ ...codeStyles.confirmBtn, opacity: allFilled ? 1 : 0.4, cursor: allFilled ? 'pointer' : 'not-allowed' }}
        onClick={handleConfirm}
        disabled={!allFilled}
      >
        확인 — 다음 단계로
      </button>
    </div>
  )
}

const codeStyles = {
  box: { marginTop: 20 },
  title: { color: '#f1f5f9', fontSize: 15, fontWeight: 600, marginBottom: 6 },
  desc: { color: '#94a3b8', fontSize: 13, marginBottom: 16 },
  tableWrap: { overflowX: 'auto', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '8px 10px', whiteSpace: 'nowrap' },
  input: { background: '#0f172a', border: '1px solid', borderRadius: 6, padding: '5px 8px', color: '#f1f5f9', fontSize: 13, width: 100 },
  code: { background: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', color: '#86efac' },
  confirmBtn: { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}

// ── 메인 ─────────────────────────────────────────────────────
export default function DataInput() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [step, setStep] = useState(4) // 키움 국내/해외는 백그라운드 자동조회, 미래에셋부터 시작
  const [date, setDate] = useState(TODAY)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState([])
  const [error, setError] = useState('')
  const [allDone, setAllDone] = useState(false)
  const [buffer, setBuffer] = useState({})
  const [apiFetching, setApiFetching] = useState(false)
  const [rawByStep, setRawByStep] = useState({})
  const [showRaw, setShowRaw] = useState(false)
  const [krLoading, setKrLoading] = useState(false) // 백그라운드 kr 조회 중
  const [usLoading, setUsLoading] = useState(false) // 백그라운드 us 조회 중

  // 미래에셋 코드 입력 대기 상태
  const [awaitingCodes, setAwaitingCodes] = useState(null)

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const autoAccount = accounts.find(a => a.broker === current.broker)
  const autoAccountId = autoAccount?.accountId || ''
  const krAccount = accounts.find(a => a.broker === 'kiwoom_kr')
  const krAccountId = krAccount?.accountId || ''
  const usAccount = accounts.find(a => a.broker === 'kiwoom_us')
  const usAccountId = usAccount?.accountId || ''
  const isApiStep = current.broker === 'kiwoom_kr' || current.broker === 'kiwoom_us'

  const parse = (rawText) => {
    setError('')
    setParsed(null)
    try {
      let result
      if (current.broker === 'mirae' && current.kind === 'holdings') {
        result = parseMiraeHoldings(rawText)
        result = result.map(r => ({ ...r, code: r.name, broker: 'mirae' }))
      } else if (current.broker === 'mirae' && current.kind === 'cash') {
        result = parseMiraeCash(rawText)
      } else if (current.broker === 'kiwoom_kr' && current.kind === 'holdings') {
        if (!autoAccountId) { setError('키움 국내 계좌가 등록되지 않았습니다.'); return null }
        result = parseKiwoomKrHoldings(rawText).map(r => ({ ...r, accountId: autoAccountId, broker: 'kiwoom_kr' }))
      } else if (current.broker === 'kiwoom_kr' && current.kind === 'cash') {
        if (!autoAccountId) { setError('키움 국내 계좌가 등록되지 않았습니다.'); return null }
        result = [{ accountId: autoAccountId, amount: parseKiwoomKrCash(rawText) }]
      } else if (current.broker === 'kiwoom_us' && current.kind === 'holdings') {
        if (!autoAccountId) { setError('키움 해외 계좌가 등록되지 않았습니다.'); return null }
        result = parseKiwoomUsHoldings(rawText).map(r => ({ ...r, accountId: autoAccountId, broker: 'kiwoom_us' }))
      } else if (current.broker === 'kiwoom_us' && current.kind === 'cash') {
        if (!autoAccountId) { setError('키움 해외 계좌가 등록되지 않았습니다.'); return null }
        result = [{ accountId: autoAccountId, amount: parseKiwoomUsCash(rawText) }]
      }
      if (!result || result.length === 0) {
        setError('파싱 결과가 없습니다. 텍스트를 확인하세요.')
        return null
      }
      return result
    } catch (e) {
      setError('파싱 오류: ' + e.message)
      return null
    }
  }

  // 미래에셋 holdings: 섹터에서 기존 코드 조회, 미등록 종목 있을 때만 코드 입력 UI로
  const handleMiraeHoldingsParsed = async (result) => {
    const sectors = await getSectors(user.uid)
    const nameToCode = Object.fromEntries(sectors.map(s => [s.name, s.code]))
    const mapped = result.map(r => ({
      ...r,
      code: nameToCode[r.name] || r.name,
    }))
    const hasUnknown = mapped.some(r => r.code === r.name)
    if (hasUnknown) {
      setParsed(mapped)
      setAwaitingCodes(mapped)
    } else {
      advance(mapped)
    }
  }

  const advance = (result) => {
    setBuffer(b => ({ ...b, [step]: result }))
    setParsed(result)
    setAwaitingCodes(null)
    setDone(d => [...d, step])
    if (isLast) {
      setAllDone(true)
    } else {
      setStep(s => s + 1)
      setText('')
      setParsed(null)
    }
  }

  const handlePaste = async (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(async () => {
      const result = parse(rawText)
      if (!result) return
      if (current.broker === 'mirae' && current.kind === 'holdings') {
        await handleMiraeHoldingsParsed(result)
      } else {
        advance(result)
      }
    }, 0)
  }

  const handleManualParse = async () => {
    const result = parse(text)
    if (!result) return
    if (current.broker === 'mirae' && current.kind === 'holdings') {
      await handleMiraeHoldingsParsed(result)
    } else {
      advance(result)
    }
  }

  const handleKiwoomApiFetch = async () => {
    if (!autoAccountId) { setError('계좌가 등록되지 않았습니다.'); return }
    setApiFetching(true)
    setError('')
    try {
      let raw, result
      if (current.broker === 'kiwoom_kr' && current.kind === 'holdings') {
        raw = await fetchKrHoldings(autoAccountId)
        setRawByStep(r => ({ ...r, [step]: raw }))
        if (raw.return_code !== undefined && raw.return_code !== 0)
          throw new Error(`[${raw.return_code}] ${raw.return_msg || '알 수 없는 오류'}`)
        result = transformKrHoldings(raw, autoAccountId)
      } else if (current.broker === 'kiwoom_kr' && current.kind === 'cash') {
        raw = await fetchKrCash(autoAccountId)
        setRawByStep(r => ({ ...r, [step]: raw }))
        if (raw.return_code !== undefined && raw.return_code !== 0)
          throw new Error(`[${raw.return_code}] ${raw.return_msg || '알 수 없는 오류'}`)
        result = transformKrCash(raw, autoAccountId)
      } else if (current.broker === 'kiwoom_us' && current.kind === 'holdings') {
        raw = await fetchUsLedger()
        setRawByStep(r => ({ ...r, [step]: raw }))
        if (raw.return_code !== undefined && raw.return_code !== 0)
          throw new Error(`[${raw.return_code}] ${raw.return_msg || '알 수 없는 오류'}`)
        result = transformUsHoldings(raw, autoAccountId)
      } else if (current.broker === 'kiwoom_us' && current.kind === 'cash') {
        raw = await fetchUsCashDetail()
        setRawByStep(r => ({ ...r, [step]: raw }))
        if (raw.return_code !== undefined && raw.return_code !== 0)
          throw new Error(`[${raw.return_code}] ${raw.return_msg || '알 수 없는 오류'}`)
        result = transformUsCash(raw, autoAccountId)
      }
      if (!result || result.length === 0) {
        setError('변환 결과가 비었습니다. 아래 raw 응답에서 필드명을 확인하세요.')
        return
      }
      // 결과를 버퍼에 저장하고 ✓ 표시만 — 스텝은 자동으로 넘기지 않음
      setBuffer(b => ({ ...b, [step]: result }))
      setParsed(result)
      setDone(d => {
        const next = d.includes(step) ? d : [...d, step]
        if (next.length === STEPS.length) setAllDone(true)
        return next
      })
    } catch (e) {
      setError('API 오류: ' + e.message)
    }
    setApiFetching(false)
  }

  // 마운트 시 kiwoom_us 백그라운드 자동조회 (step 2 보유종목: ust21070, step 3 예수금: ust21160)
  useEffect(() => {
    if (!usAccountId) return
    const run = async () => {
      setUsLoading(true)
      try {
        const fetchStep = async (stepIdx, fetcher, transformer) => {
          const raw = await fetcher(usAccountId)
          setRawByStep(r => ({ ...r, [stepIdx]: raw }))
          if (raw.return_code !== undefined && raw.return_code !== 0) return
          const result = transformer(raw, usAccountId)
          if (!result || result.length === 0) return
          setBuffer(b => ({ ...b, [stepIdx]: result }))
          setDone(d => d.includes(stepIdx) ? d : [...d, stepIdx])
        }
        await fetchStep(2, fetchUsLedger, transformUsHoldings)
        await fetchStep(3, fetchUsCashDetail, transformUsCash)
      } catch (_) {}
      setUsLoading(false)
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usAccountId])

  // 마운트 시 kiwoom_kr 백그라운드 자동조회 (step 0, 1)
  useEffect(() => {
    if (!krAccountId) return
    const run = async () => {
      setKrLoading(true)
      try {
        const fetchStep = async (stepIdx, fetcher, transformer) => {
          const raw = await fetcher(krAccountId)
          setRawByStep(r => ({ ...r, [stepIdx]: raw }))
          if (raw.return_code !== undefined && raw.return_code !== 0) return
          const result = transformer(raw, krAccountId)
          if (!result || result.length === 0) return
          setBuffer(b => ({ ...b, [stepIdx]: result }))
          setDone(d => d.includes(stepIdx) ? d : [...d, stepIdx])
        }
        await fetchStep(0, fetchKrHoldings, transformKrHoldings)
        await fetchStep(1, fetchKrCash, transformKrCash)
      } catch (_) {}
      setKrLoading(false)
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [krAccountId])

  const handleSaveAndSnapshot = async () => {
    setSaving(true)
    setError('')
    try {
      for (let i = 0; i < STEPS.length; i++) {
        const s = STEPS[i]
        const data = buffer[i]
        if (!data) continue
        if (s.kind === 'holdings') {
          await saveHoldings(user.uid, date, data)
          await ensureSectors(user.uid, data)
        } else {
          await saveCash(user.uid, date, data)
        }
      }
      await createSnapshot(user.uid, date)
      alert('✅ 저장 및 스냅샷 생성 완료!')
      setStep(4); setDone([]); setAllDone(false)
      setBuffer({}); setText(''); setParsed(null); setAwaitingCodes(null); setRawByStep({}); setShowRaw(false)
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  const goToStep = (i) => {
    setStep(i)
    setParsed(buffer[i] || null)
    setShowRaw(false)
    setAwaitingCodes(null)
    setText('')
    setError('')
    setAllDone(false)
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>데이터 입력</h2>

      <div style={styles.dateRow}>
        <label style={styles.label}>기준 날짜</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={styles.dateInput} />
      </div>

      <div style={styles.steps}>
        {STEPS.map((s, i) => (
          <div
            key={i}
            style={{
              ...styles.stepItem,
              ...(i === step && !allDone ? styles.stepActive : {}),
              ...(done.includes(i) ? styles.stepDone : {}),
            }}
            onClick={() => goToStep(i)}
          >
            {done.includes(i) ? '✓ ' : ((krLoading && s.broker === 'kiwoom_kr') || (usLoading && s.broker === 'kiwoom_us')) && !done.includes(i) ? '⏳ ' : ''}{s.btn}
          </div>
        ))}
      </div>

      {allDone ? (
        <div style={styles.allDoneCard}>
          <p style={styles.allDoneTitle}>✅ 6개 항목 파싱 완료</p>
          <p style={styles.allDoneDesc}>아래 버튼을 누르면 전체 데이터를 저장하고 스냅샷을 생성합니다.</p>
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.snapshotBtn} onClick={handleSaveAndSnapshot} disabled={saving}>
            {saving ? '저장 중...' : '저장 + 스냅샷 생성'}
          </button>
        </div>
      ) : (
        <div style={styles.card}>
          <h3 style={styles.stepLabel}>{current.label}</h3>

          {current.broker !== 'mirae' && (
            <div style={styles.accountBadge}>
              {autoAccount
                ? <span>계좌: <strong>{autoAccount.name}</strong> ({autoAccount.accountId})</span>
                : <span style={{ color: '#f87171' }}>⚠️ 계좌 관리에서 {current.broker === 'kiwoom_kr' ? '키움 국내' : '키움 해외'} 계좌를 먼저 등록하세요</span>
              }
            </div>
          )}

          {/* 키움 국내 / 키움 해외 종목 — API 자동조회 */}
          {isApiStep && !awaitingCodes && (
            <div>
              {apiFetching && (
                <div style={styles.apiLoading}>⏳ API 조회 중...</div>
              )}
              {error && (
                <div style={styles.errorBox}>
                  <p style={styles.error}>{error}</p>
                  <button style={styles.apiBtn} onClick={handleKiwoomApiFetch}>다시 시도</button>
                </div>
              )}
              {!apiFetching && !error && parsed && (
                <div style={styles.apiResultHeader}>
                  <span style={styles.apiResultLabel}>API 조회 완료 — {parsed.length}건</span>
                  <button style={styles.reloadBtn} onClick={handleKiwoomApiFetch}>↺ 새로고침</button>
                  <button style={styles.reloadBtn} onClick={() => setShowRaw(v => !v)}>
                    {showRaw ? '▲ raw 숨기기' : '▼ raw 보기'}
                  </button>
                </div>
              )}
              {showRaw && rawByStep[step] && (
                <div style={styles.rawBox}>
                  <pre style={styles.rawPre}>{JSON.stringify(rawByStep[step], null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          {/* 키움 해외 예수금 / 미래에셋 — 붙여넣기 */}
          {!isApiStep && !awaitingCodes && (
            <div style={styles.row}>
              <label style={styles.label}>
                HTS 복사 텍스트 붙여넣기
                <span style={styles.hint}> — Ctrl+V 시 자동 파싱</span>
              </label>
              <textarea
                style={styles.textarea}
                value={text}
                onChange={e => { setText(e.target.value); setParsed(null); setError('') }}
                onPaste={handlePaste}
                placeholder="HTS에서 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
                rows={8}
              />
              {error && (
                <div style={styles.errorBox}>
                  <p style={styles.error}>{error}</p>
                  {text.trim() && (
                    <button style={styles.parseBtn} onClick={handleManualParse}>수동으로 파싱</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 미래에셋 종목코드 입력 */}
          {awaitingCodes && (
            <MiraeCodeInput
              rows={awaitingCodes}
              onConfirm={advance}
            />
          )}

          {/* 일반 파싱 결과 미리보기 */}
          {parsed && !awaitingCodes && (
            <div style={styles.preview}>
              <p style={styles.previewTitle}>파싱 결과 — {parsed.length}건</p>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>{Object.keys(parsed[0]).map(k => <th key={k} style={styles.th}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {parsed.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={styles.td}>{typeof v === 'number' ? v.toLocaleString() : String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { maxWidth: 900, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 20 },
  dateRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  dateInput: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 14 },
  steps: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24 },
  stepItem: { background: '#1e293b', color: '#64748b', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', border: '1px solid transparent' },
  stepActive: { background: '#1d4ed8', color: '#fff', border: '1px solid #3b82f6' },
  stepDone: { background: '#14532d', color: '#86efac', border: '1px solid #22c55e' },
  card: { background: '#1e293b', borderRadius: 12, padding: '24px' },
  stepLabel: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, marginBottom: 20 },
  row: { marginBottom: 16 },
  label: { display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  hint: { color: '#475569', fontSize: 12 },
  accountBadge: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#94a3b8', fontSize: 14, marginBottom: 16 },
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  errorBox: { marginTop: 10 },
  error: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  parseBtn: { background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  preview: { marginTop: 16 },
  previewTitle: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { color: '#e2e8f0', padding: '7px 10px', borderBottom: '1px solid #0f172a', whiteSpace: 'nowrap' },
  allDoneCard: { background: '#0f2d1a', border: '1px solid #22c55e', borderRadius: 12, padding: '40px', textAlign: 'center' },
  allDoneTitle: { color: '#4ade80', fontSize: 20, fontWeight: 700, marginBottom: 10 },
  allDoneDesc: { color: '#94a3b8', fontSize: 14, marginBottom: 28 },
  snapshotBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 40px', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  rawBox: { marginTop: 16, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px 14px' },
  rawTitle: { color: '#94a3b8', fontSize: 12, marginBottom: 8 },
  rawPre: { color: '#86efac', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 300, overflowY: 'auto' },
  apiBox: { marginBottom: 20 },
  apiLoading: { color: '#94a3b8', fontSize: 14, padding: '20px 0' },
  apiResultHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  apiResultLabel: { color: '#4ade80', fontSize: 14, fontWeight: 600 },
  reloadBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', fontSize: 12, padding: '4px 10px', cursor: 'pointer' },
  apiBtn: { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginRight: 10 },
  apiHint: { color: '#475569', fontSize: 12 },
  divider: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 4 },
  dividerText: { color: '#334155', fontSize: 12, background: '#1e293b', padding: '0 8px', whiteSpace: 'nowrap' },
}
