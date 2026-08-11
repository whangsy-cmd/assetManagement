// 입출금내역 탭 — 계좌별 입출금내역 조회(API)/붙여넣기 등록
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import {
  parseMiraeCashFlows, parseKiwoomUsCashFlows,
  parseKiwoomKrFuturesCashFlows, parseKiwoomUsFuturesCashFlows,
} from '../../utils/parsers'
import { fetchKrCashFlows, transformKrCashFlows } from '../../utils/kiwoomApi'
import { getUsdKrwRate } from '../../utils/exchangeRate'
import { saveCashFlows, getLastCashFlowDate } from '../../utils/firestore'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00+09:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
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

export default function CashFlowsInputTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()

  const krAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name !== '선물옵션')
  const krAccountId = krAccount?.accountId || ''
  const usAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name !== '선물옵션')
  const krFuturesAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name === '선물옵션')
  const krFuturesAccountId = krFuturesAccount?.accountId || ''
  const usFuturesAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name === '선물옵션')
  const usFuturesAccountId = usFuturesAccount?.accountId || ''
  const miraeAccount = accounts.find(a => a.broker === 'mirae' && a.accountId === '001-99-014476')
  const miraeAccountId = miraeAccount?.accountId || ''
  const usAccountId = usAccount?.accountId || ''

  // 키움 국내 입출금내역
  const [cfLastDate, setCfLastDate] = useState(undefined) // undefined: 미확인, null: 저장내역 없음
  const [cfFrom, setCfFrom] = useState('')
  const [cfTo, setCfTo] = useState(TODAY)
  const [cfRows, setCfRows] = useState(null)
  const [cfFetching, setCfFetching] = useState(false)
  const [cfSaving, setCfSaving] = useState(false)
  const [cfError, setCfError] = useState('')
  const [cfSavedMsg, setCfSavedMsg] = useState('')

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

  return (
    <div>
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
        title="키움 해외 입출금내역 [2110]거래내역-1줄"
        account={usAccount}
        missingMsg="계좌 관리에서 키움 해외 계좌를 먼저 등록하세요"
        broker="kiwoom_us"
        parseFn={parseKiwoomUsCashFlows}
        placeholder="영웅문Global 입출금내역 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />

      {/* 키움 국내/해외 선물옵션 입출금내역 — 계좌관리에 이름 "선물옵션"으로 등록된 계좌 사용 */}
      <PasteCashFlowCard
        key={`kr-futures-cf-${krFuturesAccountId}`}
        title="키움 국내 선물옵션 입출금내역 [0582]입출금내역조회"
        account={krFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 국내 계좌를 먼저 등록하세요'
        broker="kiwoom_kr_futures"
        parseFn={parseKiwoomKrFuturesCashFlows}
        placeholder="입출금 명세 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />
      <PasteCashFlowCard
        key={`us-futures-cf-${usFuturesAccountId}`}
        title="키움 해외 선물옵션 입출금내역 [4571] 해외선옵 거래내역 상세조회"
        account={usFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 해외 계좌를 먼저 등록하세요'
        broker="kiwoom_us_futures"
        parseFn={parseKiwoomUsFuturesCashFlows}
        transform={convertOptionRowsToKrw}
        placeholder="입출금 명세 화면 Ctrl+A → Ctrl+C → 여기에 Ctrl+V"
      />
      <PasteCashFlowCard
        key={`mirae-cf-${miraeAccountId}`}
        title="미래에셋 입출금내역 [0968] 오픈뱅킹 거래내역"
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
  row: { marginBottom: 16 },
  label: { display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  accountBadge: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#94a3b8', fontSize: 14, marginBottom: 16 },
  dateInput: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 14 },
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  error: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  preview: { marginTop: 16 },
  previewTitle: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { color: '#e2e8f0', padding: '7px 10px', borderBottom: '1px solid #0f172a', whiteSpace: 'nowrap' },
  apiBtn: { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginRight: 10 },
  cfCard: { background: '#1e293b', borderRadius: 12, padding: '20px 24px', marginTop: 16 },
  cfLastDate: { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  cfHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  cfAccountInline: { color: '#94a3b8', fontSize: 13 },
  stepLabel: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, marginBottom: 20 },
}
