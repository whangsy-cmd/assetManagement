// 거래내역 탭 — 브로커 거래내역조회 붙여넣기로 매매/입출금 등 전체 거래 통합 등록 (동일 일자/종목/거래종류는 합산)
import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { parseKiwoomKrTransactions, parseKiwoomUsTransactions, parseMiraeTransactions, parseKiwoomKrFuturesTransactions, parseKiwoomUsFuturesTransactions } from '../../utils/parsers'
import { saveTransactions, getSectors } from '../../utils/firestore'

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
    setRows(aggregateTransactions(parsed.map(r => fillCode({ ...r, accountId, broker }))))
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
    <div style={styles.cfCard}>
      <div style={styles.cfHeadRow}>
        <h3 style={{ ...styles.stepLabel, marginBottom: 0 }}>{title}</h3>
        {account ? (
          <span style={styles.cfAccountInline}>{account.name} ({account.accountId})</span>
        ) : accounts && accounts.length > 0 ? (
          <select value={selectedAccountId} onChange={e => onSelectAccount(e.target.value)} style={styles.select}>
            <option value="">계좌 선택</option>
            {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name} ({a.accountId})</option>)}
          </select>
        ) : (
          <span style={{ color: '#f87171', fontSize: 13 }}>⚠️ {missingMsg}</span>
        )}
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
          {error && <p style={styles.error}>{error}</p>}
          {savedMsg && <p style={{ color: '#4ade80', fontSize: 13 }}>{savedMsg}</p>}
        </>
      )}

      {rows && (
        <div style={styles.preview}>
          <p style={styles.previewTitle}>파싱 결과 (합산 후) — {rows.length}건</p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>날짜</th>
                  <th style={styles.th}>거래종류</th>
                  <th style={styles.th}>종목명</th>
                  <th style={styles.th}>종목코드</th>
                  <th style={styles.th}>통화</th>
                  <th style={styles.th}>수량</th>
                  <th style={styles.th}>단가</th>
                  <th style={styles.th}>거래금액</th>
                  <th style={styles.th}>수수료</th>
                  <th style={styles.th}>세금</th>
                  <th style={styles.th}>청산손익</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r.codeError ? styles.trError : undefined}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={styles.td}>{r.type}</td>
                    <td style={styles.td}>{r.name || '-'}</td>
                    <td style={styles.td}>
                      {r.codeError
                        ? <span style={styles.error} title={r.ambiguous ? r.ambiguous.join(', ') : ''}>
                            ⚠️ {r.ambiguous ? `복수후보 ${r.ambiguous.length}건` : '코드 없음'}
                          </span>
                        : (r.code || '-')}
                    </td>
                    <td style={styles.td}>{r.currency}</td>
                    <td style={styles.td}>{r.qty ? r.qty.toLocaleString() : '-'}</td>
                    <td style={styles.td}>{r.price ? r.price.toLocaleString() : '-'}</td>
                    <td style={styles.td}>{r.amount.toLocaleString()}</td>
                    <td style={styles.td}>{r.fee.toLocaleString()}</td>
                    <td style={styles.td}>{r.tax.toLocaleString()}</td>
                    <td style={styles.td}>{r.profit ? r.profit.toLocaleString() : '-'}</td>
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
      <button style={styles.reloadBtn} onClick={handleReload} disabled={reloading}>
        {reloading ? '갱신 중...' : '↺ 종목코드 다시 불러오기'}
      </button>
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
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  error: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  preview: { marginTop: 16 },
  previewTitle: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { color: '#e2e8f0', padding: '7px 10px', borderBottom: '1px solid #0f172a', whiteSpace: 'nowrap' },
  trError: { background: 'rgba(248, 113, 113, 0.1)' },
  apiBtn: { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginRight: 10 },
  cfCard: { background: '#1e293b', borderRadius: 12, padding: '20px 24px', marginTop: 16 },
  cfHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  cfAccountInline: { color: '#94a3b8', fontSize: 13 },
  stepLabel: { color: '#f1f5f9', fontSize: 16, fontWeight: 600, marginBottom: 20 },
  select: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', color: '#f1f5f9', fontSize: 13 },
  reloadBtn: { background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 13, padding: '7px 14px', cursor: 'pointer' },
}
