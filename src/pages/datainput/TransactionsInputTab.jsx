// 거래내역 탭 — 브로커 거래내역조회 붙여넣기로 매매/입출금 등 전체 거래 통합 등록 (동일 일자/종목/거래종류는 합산)
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { parseKiwoomKrTransactions, parseKiwoomUsTransactions, parseMiraeTransactions, parseKiwoomKrFuturesTransactions, parseKiwoomUsFuturesTransactions } from '../../utils/parsers'
import { saveTransactions, saveRealizedProfits, getSectors } from '../../utils/firestore'
import { getUsdKrwRate } from '../../utils/exchangeRate'
import { fetchKrTransactions, transformKrTransactions } from '../../utils/kiwoomApi'
import KiwoomDebugModal from '../../components/KiwoomDebugModal'
import '../../common.css'

const todayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgoIso = (n) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10)
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
// 6개월 "이내"는 6개월째 당일 미포함 — 시작일+6개월의 전날까지 (예: 시작일 27일 → 종료일 최대 다음+6개월째 26일)
const subDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const addDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// 브로커별 종목명 표기가 종목코드 관리에 등록된 공식명과 달라 매칭 안 되는 케이스 — 발견될 때마다 여기 추가
const NAME_ALIASES = {
  '키움증권키움레버리지전력TOP5상장지수증권제26호': '키움레버리지전력TOP5ETN',
}

// 동일 일자/종목/거래종류는 합산 — 단가는 합산 후 금액/수량으로 재계산
function aggregateTransactions(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.date}|${r.type}|${r.code || r.name}`
    const cur = map.get(key)
    if (!cur) { map.set(key, { ...r }); continue }
    cur.qty += r.qty
    cur.amount += r.amount
    cur.fee += r.fee
    cur.tax += r.tax
    cur.profit = (cur.profit || 0) + (r.profit || 0)
    if (cur.qty) cur.price = cur.amount / cur.qty
  }
  return [...map.values()]
}

// ── 붙여넣기 기반 거래내역 카드 (계좌 고정 or 선택박스). autoFetch 주어지면 화면 진입 시 API로 자동 조회해 같은 결과 테이블에 표시 ──
function PasteTxCard({ title, account, accounts, selectedAccountId, onSelectAccount, missingMsg, broker, parseFn, placeholder, nameToCode, sectorList, noCodeMatch, usdRate, autoFetch }) {
  const { user } = useAuth()
  const accountId = account ? account.accountId : selectedAccountId
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoFrom, setAutoFrom] = useState(daysAgoIso(14))
  const [autoTo, setAutoTo] = useState(todayIso)
  const [debugOpen, setDebugOpen] = useState(false)

  // 종목코드 없으면 이름→코드 정확매칭 시도, 실패하면 포함관계(부분매칭)로 재시도 — 매수/매도인데 못 찾으면 오류 표시
  const fillCode = (r) => {
    if (noCodeMatch) return r
    if (r.code) return r
    const stripped = NAME_ALIASES[r.name.replace(/\s+/g, '')] || r.name.replace(/\s+/g, '')
    const exact = nameToCode[stripped]
    if (exact) return { ...r, code: exact }
    const candidates = sectorList.filter(s => s.nameNoSpace && stripped.includes(s.nameNoSpace))
    // 여러 후보 매칭 시 가장 긴(구체적인) 종목명 우선 — "키움증권"(브로커사) 같은 짧은 이름이 "키움증권 키움 레버리지 전력 TOP5 ETN" 같은 발행사 접두 상품명에 오매칭되는 것 방지
    const maxLen = candidates.length ? Math.max(...candidates.map(c => c.nameNoSpace.length)) : 0
    const best = candidates.filter(c => c.nameNoSpace.length === maxLen)
    const codes = [...new Set(best.map(c => c.code))]
    if (codes.length === 1) return { ...r, code: codes[0], name: best[0].name }
    // 원화주문외화매수/매도 등 환전 주문은 "매수/매도"가 들어가도 주식 거래가 아니라 종목코드가 없는 게 정상
    if (!/매수|매도/.test(r.type) || /원화주문|외화주문/.test(r.type)) return r
    if (codes.length > 1) return { ...r, codeError: true, ambiguous: candidates.map(c => c.name) }
    return { ...r, codeError: true }
  }

  // parseFn(붙여넣기) 또는 autoFetch(API) 어느쪽에서 왔든 동일하게 합산/필터링해 같은 결과 테이블에 표시. 성공 여부를 반환(디버그 팝업 트리거용)
  const applyParsed = (parsed, emptyMsg) => {
    if (!parsed.length) { setError(parsed.notice ? `${emptyMsg} (API 안내: ${parsed.notice})` : emptyMsg); return false }
    const aggregated = aggregateTransactions(parsed.map(r => fillCode({ ...r, accountId, broker })))
      .filter(r => r.amount || r.fee || r.tax || r.profit)
    if (!aggregated.length) { setError('거래금액/수수료/세금/청산손익이 모두 0인 데이터만 있습니다.'); return false }
    setRows(aggregated)
    return true
  }

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    if (!accountId) { setError('계좌를 먼저 선택하세요.'); return }
    Promise.resolve(parseFn(rawText))
      .then(parsed => applyParsed(parsed, '파싱 결과가 없습니다. 화면 전체를 복사했는지 확인하세요.'))
      .catch(e => setError('파싱 오류: ' + e.message))
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  // API로 거래내역 자동 조회 — 붙여넣기와 동일한 결과 테이블에 표시, 저장은 여전히 수동 등록
  // 조회기간이 6개월 넘으면 오류 대신 시작일 기준 6개월로 자동 조정
  const runFetch = (from, to) => {
    if (!autoFetch || !accountId) return
    setError('')
    setSavedMsg('')
    const maxTo = subDay(addMonths(from, 6))
    const clampedTo = to > maxTo ? maxTo : to
    setAutoFrom(from)
    setAutoTo(clampedTo)
    setDebugOpen(false)
    setAutoLoading(true)
    autoFetch(from.replace(/-/g, ''), clampedTo.replace(/-/g, ''))
      .then(parsed => { if (!applyParsed(parsed, '해당 기간 신규 거래내역이 없습니다.')) setDebugOpen(true) })
      .catch(e => { setError('자동 조회 실패: ' + e.message); setDebugOpen(true) })
      .finally(() => setAutoLoading(false))
  }

  const runAutoFetch = () => runFetch(autoFrom, autoTo)

  // 현재 조회된 종료일 다음날부터 6개월(최대조회기간) 구간을 이어서 조회
  const handleNext = () => {
    const nextFrom = addDay(autoTo)
    const maxTo = subDay(addMonths(nextFrom, 6))
    runFetch(nextFrom, maxTo > todayIso() ? todayIso() : maxTo)
  }

  // 화면 진입 시 계좌 확정되면 기본 기간(최근 2주)으로 1회 자동 조회
  useEffect(() => {
    runAutoFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const handleSave = async () => {
    if (!rows || !rows.length) return
    setSaving(true)
    setError('')
    try {
      await saveTransactions(user.uid, rows)
      // 선물옵션 등 거래 자체에 실현손익(profit)이 찍히는 포맷은 실현손익도 같이 등록 — 별도 붙여넣기 불필요
      // realizedProfits는 항상 원화 기준이라 USD 거래는 환율로 환산해서 저장
      const realizedRows = rows
        .filter(r => r.profit !== undefined && r.profit !== 0)
        .map(r => {
          const toKrw = v => Math.trunc(r.currency === 'USD' ? v * (usdRate || 0) : v)
          return { date: r.date, accountId: r.accountId, code: r.code, name: r.name, realizedProfit: toKrw(r.profit), fee: toKrw(r.fee || 0) }
        })
      if (realizedRows.length) await saveRealizedProfits(user.uid, realizedRows)
      setSavedMsg(`✅ ${rows.length}건 등록 완료` + (realizedRows.length ? ` (실현손익 ${realizedRows.length}건 함께 등록)` : ''))
      setRows(null)
      setText('')
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="card card-flat">
      <div className="section-header">
        <h3 className="section-title">{title}</h3>
        {account ? (
          <span className="text-muted">{account.name} ({account.accountId})</span>
        ) : accounts && accounts.length > 0 ? (
          <select value={selectedAccountId} onChange={e => onSelectAccount(e.target.value)} className="select input-sm">
            <option value="">계좌</option>
            {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.accountId}</option>)}
          </select>
        ) : (
          <span className="neg" style={{ fontSize: 13 }}>⚠️ {missingMsg}</span>
        )}
      </div>

      {accountId && (
        <>
          {autoFetch && (
            <div className="date-row" style={{ marginBottom: 8 }}>
              <span className="tool-label">API 자동조회 기간</span>
              <input type="date" value={autoFrom} onChange={e => { const v = e.target.value; setAutoFrom(v); if (autoTo < v) setAutoTo(v) }} className="input input-sm" />
              <span className="tool-label">~</span>
              <input type="date" value={autoTo} onChange={e => setAutoTo(e.target.value < autoFrom ? autoFrom : e.target.value)} className="input input-sm" />
              <button className="btn btn-outline btn-sm" onClick={runAutoFetch} disabled={autoLoading}>
                {autoLoading ? '조회 중...' : '조회'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleNext} disabled={autoLoading || autoTo >= todayIso()}>
                다음
              </button>
              <span className="text-muted" style={{ fontSize: 12 }}>6개월 초과 시 시작일 기준 6개월로 자동 조정</span>
            </div>
          )}
          <textarea
            className="textarea"
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />
          {error && (
            <p className="text-error" style={{ marginBottom: 8 }}>
              {error}
              {autoFetch && <button className="btn btn-outline btn-sm" style={{ marginLeft: 8 }} onClick={() => setDebugOpen(true)}>요청/응답 보기</button>}
            </p>
          )}
          {savedMsg && <p className="text-success">{savedMsg}</p>}
          <KiwoomDebugModal open={debugOpen} onClose={() => setDebugOpen(false)} />
        </>
      )}

      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label">파싱 결과 (합산 후) — {rows.length}건</p>
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>거래종류</th>
                  <th>종목명</th>
                  <th>종목코드</th>
                  <th>통화</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>거래금액</th>
                  <th>수수료</th>
                  <th>세금</th>
                  <th>청산손익</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r.codeError ? styles.trError : undefined}>
                    <td>{r.date}</td>
                    <td>{r.type}</td>
                    <td>{r.name || '-'}</td>
                    <td>
                      {r.codeError
                        ? <span className="text-error" title={r.ambiguous ? r.ambiguous.join(', ') : ''}>
                            ⚠️ {r.ambiguous ? `복수후보 ${r.ambiguous.length}건` : '코드 없음'}
                          </span>
                        : (r.code || '-')}
                    </td>
                    <td>{r.currency}</td>
                    <td>{r.qty ? r.qty.toLocaleString() : '-'}</td>
                    <td>{r.price ? r.price.toLocaleString() : '-'}</td>
                    <td>{r.amount.toLocaleString()}</td>
                    <td>{r.fee.toLocaleString()}</td>
                    <td>{r.tax.toLocaleString()}</td>
                    <td>{r.profit ? r.profit.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-info" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}
    </div>
  )
}

const todayKst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

// ── 이체입금/이체출금 수기 등록 카드 ──────────────────────────
function TransferEntryCard({ accounts }) {
  const { user } = useAuth()
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(todayKst)
  const [type, setType] = useState('이체입금')
  const [currency, setCurrency] = useState('KRW')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const handleSave = async () => {
    setError('')
    setSavedMsg('')
    if (!accountId) { setError('계좌를 선택하세요.'); return }
    const amt = Number(String(amount).replace(/,/g, ''))
    if (!amt) { setError('금액을 입력하세요.'); return }
    setSaving(true)
    try {
      await saveTransactions(user.uid, [{
        accountId, date, type, name: '', code: '', currency,
        qty: 0, price: 0, amount: amt, fee: 0, tax: 0,
      }])
      setSavedMsg('✅ 등록 완료')
      setAmount('')
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="card card-flat">
      <div className="section-header">
        <h3 className="section-title">이체입금/출금 등록</h3>
      </div>
      <div className="form-row">
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className="select input-sm">
          <option value="">계좌 선택</option>
          {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.accountId}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input input-sm" />
        <select value={type} onChange={e => setType(e.target.value)} className="select input-sm">
          <option value="이체입금">이체입금</option>
          <option value="이체출금">이체출금</option>
        </select>
        <select value={currency} onChange={e => setCurrency(e.target.value)} className="select input-sm">
          <option value="KRW">원화</option>
          <option value="USD">달러</option>
        </select>
        <input
          className="input input-sm"
          style={{ width: 160 }}
          placeholder="금액"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />
        <button className="btn btn-info btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? '등록 중...' : '등록'}
        </button>
      </div>
      {error && <p className="text-error" style={{ marginTop: 8 }}>{error}</p>}
      {savedMsg && <p className="text-success" style={{ marginTop: 8 }}>{savedMsg}</p>}
    </div>
  )
}

export default function TransactionsInputTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const krAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name !== '선물옵션')
  const usAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name !== '선물옵션')
  const krFuturesAccount = accounts.find(a => a.broker === 'kiwoom_kr' && a.name === '선물옵션')
  const usFuturesAccount = accounts.find(a => a.broker === 'kiwoom_us' && a.name === '선물옵션')
  const miraeAccounts = accounts.filter(a => a.broker === 'mirae')
  const [miraeAccountId, setMiraeAccountId] = useState('')
  const [nameToCode, setNameToCode] = useState({})
  const [sectorList, setSectorList] = useState([])
  const [reloading, setReloading] = useState(false)
  const [usdRate, setUsdRate] = useState(null)

  // 키움 API로 국내 거래내역 조회(기간은 PasteTxCard에서 선택) — 붙여넣기 파싱 결과와 동일한 테이블에 표시, 저장은 등록 버튼으로 수동
  const fetchKrAuto = (from, to) => fetchKrTransactions(from, to).then(raw => {
    const rows = transformKrTransactions(raw)
    rows.notice = raw.notice
    return rows
  })

  useEffect(() => {
    if (miraeAccountId || !miraeAccounts.length) return
    const def = miraeAccounts.find(a => a.accountId === '010-9786-1102-1')
    if (def) setMiraeAccountId(def.accountId)
  }, [miraeAccounts, miraeAccountId])

  useEffect(() => {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    getUsdKrwRate(today).then(setUsdRate).catch(() => setUsdRate(null))
  }, [])

  const loadNameToCode = () => {
    if (!user) return
    return getSectors(user.uid).then(list => {
      const map = {}
      for (const s of list) map[(s.name || '').replace(/\s+/g, '')] = s.code
      setNameToCode(map)
      setSectorList(list.map(s => ({ code: s.code, name: s.name, nameNoSpace: (s.name || '').replace(/\s+/g, '') })))
    })
  }

  useEffect(() => { loadNameToCode() }, [user])

  const handleReload = async () => {
    setReloading(true)
    await loadNameToCode()
    setReloading(false)
  }

  return (
    <div>
      <button className="btn btn-outline btn-sm" onClick={handleReload} disabled={reloading}>
        {reloading ? '갱신 중...' : '↺ 종목코드 다시 불러오기'}
      </button>
      <PasteTxCard
        key={`kr-tx-${krAccount?.accountId}`}
        title="키움 국내 거래내역"
        account={krAccount}
        missingMsg="계좌 관리에서 키움 국내 계좌를 먼저 등록하세요"
        broker="kiwoom_kr"
        parseFn={parseKiwoomKrTransactions}
        autoFetch={krAccount ? fetchKrAuto : undefined}
        placeholder="[0489] 위탁종합계좌 거래내역"
        nameToCode={nameToCode}
        sectorList={sectorList}
      />
      <PasteTxCard
        key={`us-tx-${usAccount?.accountId}`}
        title="키움 해외 거래내역"
        account={usAccount}
        missingMsg="계좌 관리에서 키움 해외 계좌를 먼저 등록하세요"
        broker="kiwoom_us"
        parseFn={parseKiwoomUsTransactions}
        placeholder="[2110] 해외주식 거래내역"
        nameToCode={nameToCode}
        sectorList={sectorList}
      />
      <PasteTxCard
        key="mirae-tx"
        title="미래에셋 거래내역"
        accounts={miraeAccounts}
        selectedAccountId={miraeAccountId}
        onSelectAccount={setMiraeAccountId}
        missingMsg="계좌 관리에서 미래에셋 계좌를 먼저 등록하세요"
        broker="mirae"
        parseFn={parseMiraeTransactions}
        placeholder="[0650] 거래내역"
        nameToCode={nameToCode}
        sectorList={sectorList}
      />
      <PasteTxCard
        key={`kr-futures-tx-${krFuturesAccount?.accountId}`}
        title="키움 국내 선물옵션 거래내역/실현손익"
        account={krFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 국내 계좌를 먼저 등록하세요'
        broker="kiwoom_kr"
        parseFn={parseKiwoomKrFuturesTransactions}
        placeholder="[0581] 결제내역조회"
        noCodeMatch
      />
      <PasteTxCard
        key={`us-futures-tx-${usFuturesAccount?.accountId}`}
        title="키움 해외선물옵션 거래내역/실현손익"
        account={usFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 해외 계좌를 먼저 등록하세요'
        broker="kiwoom_us"
        parseFn={parseKiwoomUsFuturesTransactions}
        placeholder="[4571] 해외선옵 거래내역 상세조회(1줄)"
        noCodeMatch
        usdRate={usdRate}
      />
      <TransferEntryCard accounts={accounts} />
    </div>
  )
}

const styles = {
  trError: { background: 'rgba(248, 113, 113, 0.1)' },
}
