// 거래내역 탭 — 브로커 거래내역조회 붙여넣기로 매매/입출금 등 전체 거래 통합 등록 (동일 일자/종목/거래종류는 합산)
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { parseKiwoomKrTransactions, parseKiwoomUsTransactions, parseMiraeTransactions, parseKiwoomKrFuturesTransactions, parseKiwoomUsFuturesTransactions } from '../../utils/parsers'
import { saveTransactions, getSectors } from '../../utils/firestore'
import '../../common.css'

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

// ── 붙여넣기 기반 거래내역 카드 (계좌 고정 or 선택박스) ──────
function PasteTxCard({ title, account, accounts, selectedAccountId, onSelectAccount, missingMsg, broker, parseFn, placeholder, nameToCode, sectorList, noCodeMatch }) {
  const { user } = useAuth()
  const accountId = account ? account.accountId : selectedAccountId
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  // 종목코드 없으면 이름→코드 정확매칭 시도, 실패하면 포함관계(부분매칭)로 재시도 — 매수/매도인데 못 찾으면 오류 표시
  const fillCode = (r) => {
    if (noCodeMatch) return r
    if (r.code) return r
    const stripped = r.name.replace(/\s+/g, '')
    const exact = nameToCode[stripped]
    if (exact) return { ...r, code: exact }
    const candidates = sectorList.filter(s => s.nameNoSpace && stripped.includes(s.nameNoSpace))
    const codes = [...new Set(candidates.map(c => c.code))]
    if (codes.length === 1) return { ...r, code: codes[0], name: candidates[0].name }
    if (!/매수|매도/.test(r.type)) return r
    if (codes.length > 1) return { ...r, codeError: true, ambiguous: candidates.map(c => c.name) }
    return { ...r, codeError: true }
  }

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    if (!accountId) { setError('계좌를 먼저 선택하세요.'); return }
    const parsed = parseFn(rawText)
    if (!parsed.length) { setError('파싱 결과가 없습니다. 화면 전체를 복사했는지 확인하세요.'); return }
    // 거래금액/수수료/세금/청산손익이 모두 0인 의미없는 거래는 등록에서 제외
    const aggregated = aggregateTransactions(parsed.map(r => fillCode({ ...r, accountId, broker })))
      .filter(r => r.amount || r.fee || r.tax || r.profit)
    if (!aggregated.length) { setError('거래금액/수수료/세금/청산손익이 모두 0인 데이터만 있습니다.'); return }
    setRows(aggregated)
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
      await saveTransactions(user.uid, rows)
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
        {account ? (
          <span className="text-muted">{account.name} ({account.accountId})</span>
        ) : accounts && accounts.length > 0 ? (
          <select value={selectedAccountId} onChange={e => onSelectAccount(e.target.value)} className="select input-sm">
            <option value="">계좌 선택</option>
            {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
          </select>
        ) : (
          <span className="neg" style={{ fontSize: 13 }}>⚠️ {missingMsg}</span>
        )}
      </div>

      {accountId && (
        <>
          <textarea
            className="textarea"
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />
          {error && <p className="text-error" style={{ marginBottom: 8 }}>{error}</p>}
          {savedMsg && <p className="text-success">{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label">파싱 결과 (합산 후) — {rows.length}건</p>
          <div className="table-wrap">
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
    <div className="card" style={{ margin: 0 }}>
      <div className="section-header">
        <h3 className="section-title">이체입금/출금 등록</h3>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className="select input-sm">
          <option value="">계좌 선택</option>
          {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
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
      <TransferEntryCard accounts={accounts} />
      <PasteTxCard
        key={`kr-tx-${krAccount?.accountId}`}
        title="키움 국내 거래내역"
        account={krAccount}
        missingMsg="계좌 관리에서 키움 국내 계좌를 먼저 등록하세요"
        broker="kiwoom_kr"
        parseFn={parseKiwoomKrTransactions}
        placeholder="[0489] 위탁종합계좌 거래내역]"
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
        placeholder="[2110] 해외주식 거래내역]"
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
        title="키움 국내 선물옵션 거래내역"
        account={krFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 국내 계좌를 먼저 등록하세요'
        broker="kiwoom_kr"
        parseFn={parseKiwoomKrFuturesTransactions}
        placeholder="[0581] 결제내역조회"
        noCodeMatch
      />
      <PasteTxCard
        key={`us-futures-tx-${usFuturesAccount?.accountId}`}
        title="키움 해외선물옵션 거래내역"
        account={usFuturesAccount}
        missingMsg='계좌 관리에서 이름이 "선물옵션"인 키움 해외 계좌를 먼저 등록하세요'
        broker="kiwoom_us"
        parseFn={parseKiwoomUsFuturesTransactions}
        placeholder="[4571] 해외선옵 거래내역 상세조회"
        noCodeMatch
      />
    </div>
  )
}

const styles = {
  trError: { background: 'rgba(248, 113, 113, 0.1)' },
}
