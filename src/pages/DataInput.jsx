// 데이터 입력 화면 — 브로커 리포트 붙여넣기로 보유종목/예수금/입출금 등록, 계좌별평가(accountEval) 생성
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import {
  parseMiraeHoldings, parseMiraeCash, parseMiraeCashFlows,
  parseKiwoomKrHoldings, parseKiwoomKrCash,
  parseKiwoomUsHoldings, parseKiwoomUsCash, parseKiwoomUsCashFlows,
  parseKiwoomKrFuturesCashFlows, parseKiwoomUsFuturesCashFlows,
} from '../utils/parsers'
import {
  fetchKrHoldings, fetchKrCash, fetchUsLedger, fetchUsCashDetail,
  transformKrHoldings, transformKrCash, transformUsHoldings, transformUsCash,
  fetchKrCashFlows, transformKrCashFlows,
} from '../utils/kiwoomApi'
import { getUsdKrwRate } from '../utils/exchangeRate'
import { buildAccountEvalRows, buildLoanEvalRow } from '../utils/holdingsAgg'
import {
  saveHoldings, ensureSectors, saveAccountEval, getSectors, getLoans,
  saveCashFlows, getLastCashFlowDate,
} from '../utils/firestore'
import '../common.css'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00+09:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

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

// 선물옵션 계좌는 USD를 구분해서 보지 않고 등록 시점에 날짜별 환율로 환산해 KRW로만 저장
async function convertOptionRowsToKrw(rows) {
  const out = []
  for (const r of rows) {
    if (r.currency === 'KRW') { out.push(r); continue }
    const rate = await getUsdKrwRate(r.date)
    const { rate: _drop, ...rest } = r
    out.push({
      ...rest,
      amount: Math.round(r.amount * rate),
      balance: r.balance ? Math.round(r.balance * rate) : r.balance,
      currency: 'KRW',
    })
  }
  return out
}

// ── 붙여넣기 기반 입출금내역 카드 (해외 계좌 / 선물옵션 계좌 공용) ──
function PasteCashFlowCard({ title, account, missingMsg, broker, parseFn, placeholder, transform }) {
  const { user } = useAuth()
  const accountId = account?.accountId || ''
  const [lastDate, setLastDate] = useState(undefined)
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    if (!accountId) return
    getLastCashFlowDate(user.uid, accountId).then(setLastDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const parseText = async (rawText) => {
    setError('')
    setSavedMsg('')
    let parsed = parseFn(rawText).map(r => ({ ...r, accountId, broker }))
    if (!parsed.length) { setError('파싱 결과가 없습니다. 화면 전체를 복사했는지 확인하세요.'); return }
    if (transform) {
      setParsing(true)
      try {
        parsed = await transform(parsed)
      } catch (e) {
        setError('환율 조회 오류: ' + e.message)
        setParsing(false)
        return
      }
      setParsing(false)
    }
    setRows(parsed)
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  const handleSave = async () => {
    if (!rows || !rows.length) return
    setSaving(true)
    setError('')
    try {
      await saveCashFlows(user.uid, rows)
      setSavedMsg(`✅ ${rows.length}건 등록 완료`)
      setRows(null)
      setText('')
      setLastDate(await getLastCashFlowDate(user.uid, accountId))
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div style={styles.cfCard}>
      <div style={styles.cfHeadRow}>
        <h3 style={{ ...styles.stepLabel, marginBottom: 0 }}>{title}</h3>
        {account
          ? <span style={styles.cfAccountInline}>{account.name} ({account.accountId}){lastDate !== undefined && ` · ${lastDate ? `마지막 ${lastDate}` : '저장 내역 없음'}`}</span>
          : <span style={{ color: '#f87171', fontSize: 13 }}>⚠️ {missingMsg}</span>
        }
      </div>

      {accountId && (
        <>
          <textarea
            style={styles.textarea}
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />

          {parsing && <p style={{ color: '#94a3b8', fontSize: 13 }}>환율 조회 중...</p>}
          {error && <p style={styles.error}>{error}</p>}
          {savedMsg && <p style={{ color: '#4ade80', fontSize: 13 }}>{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={styles.preview}>
          <p style={styles.previewTitle}>조회 결과 — {rows.length}건</p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>날짜</th>
                  <th style={styles.th}>구분</th>
                  <th style={styles.th}>금액</th>
                  <th style={styles.th}>통화</th>
                  <th style={styles.th}>적요</th>
                  <th style={styles.th}>잔고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={styles.td}>{r.ioType}</td>
                    <td style={styles.td}>{r.amount.toLocaleString()}</td>
                    <td style={styles.td}>{r.currency}</td>
                    <td style={styles.td}>{r.memo}</td>
                    <td style={styles.td}>{r.balance !== undefined ? r.balance.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button style={{ ...styles.apiBtn, marginTop: 14 }} onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}
    </div>
  )
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

  // 키움 국내 입출금내역
  const [cfLastDate, setCfLastDate] = useState(undefined) // undefined: 미확인, null: 저장내역 없음
  const [cfFrom, setCfFrom] = useState('')
  const [cfTo, setCfTo] = useState(TODAY)
  const [cfRows, setCfRows] = useState(null)
  const [cfFetching, setCfFetching] = useState(false)
  const [cfSaving, setCfSaving] = useState(false)
  const [cfError, setCfError] = useState('')
  const [cfSavedMsg, setCfSavedMsg] = useState('')

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const autoAccount = accounts.find(a => a.broker === current.broker && a.name !== '선물옵션')
  const autoAccountId = autoAccount?.accountId || ''
  const krAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name !== '선물옵션')
  const krAccountId = krAccount?.accountId || ''
  const usAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name !== '선물옵션')
  const usAccountId = usAccount?.accountId || ''
  const krFuturesAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name === '선물옵션')
  const krFuturesAccountId = krFuturesAccount?.accountId || ''
  const usFuturesAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name === '선물옵션')
  const usFuturesAccountId = usFuturesAccount?.accountId || ''
  const miraeAccount = accounts.find(a => a.broker === 'mirae' && a.accountId === '001-99-014476')
  const miraeAccountId = miraeAccount?.accountId || ''
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

  // 마운트 시 키움 국내 입출금내역 마지막 저장일 조회 → 조회 시작일 기본값 설정
  useEffect(() => {
    if (!krAccountId) return
    getLastCashFlowDate(user.uid, krAccountId).then(last => {
      setCfLastDate(last)
      setCfFrom(last ? addDaysISO(last, 1) : addDaysISO(TODAY, -7))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [krAccountId])

  const handleFetchCashFlows = async () => {
    if (!krAccountId) { setCfError('키움 국내 계좌가 등록되지 않았습니다.'); return }
    if (cfFrom > cfTo) { setCfError('시작일이 종료일보다 늦습니다.'); return }
    setCfFetching(true)
    setCfError('')
    setCfSavedMsg('')
    try {
      const raw = await fetchKrCashFlows(cfFrom.replace(/-/g, ''), cfTo.replace(/-/g, ''))
      const result = transformKrCashFlows(raw, krAccountId)
      setCfRows(result)
    } catch (e) {
      setCfError('API 오류: ' + e.message)
    }
    setCfFetching(false)
  }

  const handleSaveCashFlows = async () => {
    if (!cfRows || !cfRows.length) return
    setCfSaving(true)
    setCfError('')
    try {
      await saveCashFlows(user.uid, cfRows)
      setCfSavedMsg(`✅ ${cfRows.length}건 등록 완료`)
      setCfRows(null)
      const last = await getLastCashFlowDate(user.uid, krAccountId)
      setCfLastDate(last)
      setCfFrom(last ? addDaysISO(last, 1) : cfFrom)
    } catch (e) {
      setCfError('저장 오류: ' + e.message)
    }
    setCfSaving(false)
  }

  const handleSaveAndSnapshot = async () => {
    setSaving(true)
    setError('')
    try {
      const holdingsForDate = []
      const cashForDate = []
      for (let i = 0; i < STEPS.length; i++) {
        const s = STEPS[i]
        const data = buffer[i]
        if (!data) continue
        if (s.kind === 'holdings') {
          await saveHoldings(user.uid, date, data)
          await ensureSectors(user.uid, data)
          holdingsForDate.push(...data.map(r => ({ ...r, date })))
        } else {
          cashForDate.push(...data.map(r => ({ ...r, date })))
        }
      }
      const evalRows = buildAccountEvalRows(holdingsForDate, cashForDate)
      const loanRow = buildLoanEvalRow(date, await getLoans(user.uid))
      await saveAccountEval(user.uid, loanRow ? [...evalRows, loanRow] : evalRows)
      alert('✅ 저장 및 계좌별 평가 등록 완료!')
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
    <div className="page">
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
          <p style={styles.allDoneDesc}>아래 버튼을 누르면 전체 데이터를 저장하고 계좌별 평가 테이블에 등록합니다.</p>
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.snapshotBtn} onClick={handleSaveAndSnapshot} disabled={saving}>
            {saving ? '저장 중...' : '저장 + 계좌별평가 등록'}
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

      {/* 키움 국내 입출금내역 — 별도 섹션, 주간 스냅샷 흐름과 무관하게 기간 조회 */}
      <div style={styles.cfCard}>
        <h3 style={styles.stepLabel}>키움 국내 입출금내역</h3>

        <div style={styles.accountBadge}>
          {krAccount
            ? <span>계좌: <strong>{krAccount.name}</strong> ({krAccount.accountId})</span>
            : <span style={{ color: '#f87171' }}>⚠️ 계좌 관리에서 키움 국내 계좌를 먼저 등록하세요</span>
          }
        </div>

        {krAccountId && (
          <>
            <p style={styles.cfLastDate}>
              {cfLastDate === undefined ? '마지막 저장일 확인 중...'
                : cfLastDate ? `마지막 저장일: ${cfLastDate}`
                : '저장된 입출금내역이 없습니다.'}
            </p>

            <div style={styles.row}>
              <input type="date" value={cfFrom} onChange={e => setCfFrom(e.target.value)} style={styles.dateInput} />
              <span style={{ color: '#64748b', margin: '0 8px' }}>~</span>
              <input type="date" value={cfTo} onChange={e => setCfTo(e.target.value)} style={styles.dateInput} />
              <button style={{ ...styles.apiBtn, marginLeft: 12 }} onClick={handleFetchCashFlows} disabled={cfFetching}>
                {cfFetching ? '조회 중...' : '조회'}
              </button>
            </div>

            {cfError && <p style={styles.error}>{cfError}</p>}
            {cfSavedMsg && <p style={{ color: '#4ade80', fontSize: 13 }}>{cfSavedMsg}</p>}

            {cfRows && (
              <div style={styles.preview}>
                <p style={styles.previewTitle}>조회 결과 — {cfRows.length}건</p>
                {cfRows.length > 0 && (
                  <>
                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>날짜</th>
                            <th style={styles.th}>구분</th>
                            <th style={styles.th}>금액</th>
                            <th style={styles.th}>적요</th>
                            <th style={styles.th}>예수금잔고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cfRows.map((r, i) => (
                            <tr key={i}>
                              <td style={styles.td}>{r.date}</td>
                              <td style={styles.td}>{r.ioType}</td>
                              <td style={styles.td}>{r.amount.toLocaleString()}</td>
                              <td style={styles.td}>{r.memo}</td>
                              <td style={styles.td}>{r.balance.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button style={{ ...styles.apiBtn, marginTop: 14 }} onClick={handleSaveCashFlows} disabled={cfSaving}>
                      {cfSaving ? '등록 중...' : '등록'}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 키움 해외 입출금내역 — 입출금내역 화면 복사 붙여넣기 */}
      <PasteCashFlowCard
        key={`us-cf-${usAccountId}`}
        title="키움 해외 입출금내역"
        account={usAccount}
        missingMsg="계좌 관리에서 키움 해외 계좌를 먼저 등록하세요"
        broker="kiwoom_us"
        parseFn={parseKiwoomUsCashFlows}
        placeholder="영웅문Global 입출금내역 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />

      {/* 키움 국내/해외 선물옵션 입출금내역 — 계좌관리에 이름 "선물옵션"으로 등록된 계좌 사용 */}
      <PasteCashFlowCard
        key={`kr-futures-cf-${krFuturesAccountId}`}
        title="키움 국내 선물옵션 입출금내역"
        account={krFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 국내 계좌를 먼저 등록하세요'
        broker="kiwoom_kr_futures"
        parseFn={parseKiwoomKrFuturesCashFlows}
        placeholder="입출금 명세 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />
      <PasteCashFlowCard
        key={`us-futures-cf-${usFuturesAccountId}`}
        title="키움 해외 선물옵션 입출금내역"
        account={usFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 해외 계좌를 먼저 등록하세요'
        broker="kiwoom_us_futures"
        parseFn={parseKiwoomUsFuturesCashFlows}
        transform={convertOptionRowsToKrw}
        placeholder="입출금 명세 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />
      <PasteCashFlowCard
        key={`mirae-cf-${miraeAccountId}`}
        title="미래에셋 입출금내역"
        account={miraeAccount}
        missingMsg="계좌 관리에서 계좌번호 001-99-014476인 미래에셋 계좌를 먼저 등록하세요"
        broker="mirae"
        parseFn={parseMiraeCashFlows}
        placeholder="이체내역 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />
    </div>
  )
}

const styles = {
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
  cfCard: { background: '#1e293b', borderRadius: 12, padding: '20px 24px', marginTop: 16 },
  cfLastDate: { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  cfHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  cfAccountInline: { color: '#94a3b8', fontSize: 13 },
}
