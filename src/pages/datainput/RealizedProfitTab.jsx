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
import { fetchKrRealizedProfit, transformKrRealizedProfit, fetchUsRealizedProfit, transformUsRealizedProfit } from '../../utils/kiwoomApi'
import KiwoomDebugModal from '../../components/KiwoomDebugModal'
import '../../common.css'

const todayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgoIso = (n) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10)
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
// N개월 "이내"는 N개월째 당일 미포함 — 시작일+N개월의 전날까지 (예: 시작일 27일 → 종료일 최대 다음+N개월째 26일)
const subDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const addDay = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

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
      if (r.sellAmount !== undefined) g.sellAmount = (g.sellAmount || 0) + r.sellAmount
      if (r.tax !== undefined) g.tax = (g.tax || 0) + r.tax
      if (r.liquidationProfit !== undefined) g.liquidationProfit = (g.liquidationProfit || 0) + r.liquidationProfit
      if (r.qty !== undefined) g.qty = (g.qty || 0) + r.qty
    }
  }
  return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function RealizedProfitCard({ title, fixedAccount, missingMsg, selectableAccounts, parseFn, placeholder, needsCodeLookup, sectors, truncateAmounts, autoFetch }) {
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
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoFrom, setAutoFrom] = useState(daysAgoIso(14))
  const [autoTo, setAutoTo] = useState(todayIso)
  const [debugOpen, setDebugOpen] = useState(false)

  // parseFn(붙여넣기) 또는 autoFetch(API) 어느쪽에서 왔든 동일하게 합산/필터링해 같은 결과 테이블에 표시. 성공 여부를 반환(디버그 팝업 트리거용)
  const applyParsed = (parsed, emptyMsg) => {
    if (!parsed.length) { setError(parsed.notice ? `${emptyMsg} (API 안내: ${parsed.notice})` : emptyMsg); setRows(null); return false }
    let rows = parsed
    if (needsCodeLookup) {
      const nameToCode = Object.fromEntries((sectors || []).map(s => [s.name, s.code]))
      rows = rows.map(r => (!r.code && r.name && nameToCode[r.name]) ? { ...r, code: nameToCode[r.name] } : r)
    }
    let aggregated = aggregate(rows)
    if (truncateAmounts) aggregated = aggregated.map(r => ({
      ...r,
      realizedProfit: Math.trunc(r.realizedProfit),
      fee: Math.trunc(r.fee),
      ...(r.tax !== undefined && { tax: Math.trunc(r.tax) }),
    }))
    aggregated = aggregated.filter(r => r.realizedProfit !== 0)
    if (!aggregated.length) { setError('실현손익이 0이 아닌 데이터가 없습니다.'); setRows(null); return false }
    setRows(aggregated)
    return true
  }

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    Promise.resolve(parseFn(rawText))
      .then(parsed => applyParsed(parsed, '파싱 결과가 없습니다. 포맷이 맞는지 확인하세요.'))
      .catch(e => setError('파싱 오류: ' + e.message))
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  // API로 실현손익 자동 조회 — 붙여넣기와 동일한 결과 테이블에 표시, 저장은 여전히 수동 등록
  // ka10073/ust21530 모두 조회기간 최대 3개월 — 넘으면 오류 대신 시작일 기준 3개월로 자동 조정
  const runFetch = (from, to) => {
    if (!autoFetch || !accountId) return
    setError('')
    setSavedMsg('')
    const maxTo = subDay(addMonths(from, 3))
    const clampedTo = to > maxTo ? maxTo : to
    setAutoFrom(from)
    setAutoTo(clampedTo)
    setDebugOpen(false)
    setAutoLoading(true)
    autoFetch(from.replace(/-/g, ''), clampedTo.replace(/-/g, ''))
      .then(parsed => { if (!applyParsed(parsed, '해당 기간 신규 실현손익이 없습니다.')) setDebugOpen(true) })
      .catch(e => { setError('자동 조회 실패: ' + e.message); setDebugOpen(true) })
      .finally(() => setAutoLoading(false))
  }

  const runAutoFetch = () => runFetch(autoFrom, autoTo)

  // 현재 조회된 종료일 다음날부터 3개월(최대조회기간) 구간을 이어서 조회
  const handleNext = () => {
    const nextFrom = addDay(autoTo)
    const maxTo = subDay(addMonths(nextFrom, 3))
    runFetch(nextFrom, maxTo > todayIso() ? todayIso() : maxTo)
  }

  // 화면 진입 시 계좌 확정되면 기본 기간(최근 2주)으로 1회 자동 조회
  useEffect(() => {
    runAutoFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

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
    <div className="card card-flat">
      <div className="section-header">
        <h3 className="section-title">{title}</h3>
        {selectableAccounts ? (
          <select className="select input-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {selectableAccounts.length === 0 && <option value="">등록된 계좌 없음</option>}
            {selectableAccounts.map(a => <option key={a.accountId} value={a.accountId}>{a.accountId}</option>)}
          </select>
        ) : account ? (
          <span className="text-muted">{account.name} ({account.accountId})</span>
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
              <span className="text-muted" style={{ fontSize: 12 }}>3개월 초과 시 시작일 기준 3개월로 자동 조정</span>
            </div>
          )}
          <textarea
            className="textarea"
            value={text}
            onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={4}
          />
          {error && (
            <p className="text-error" style={{ marginTop: 8 }}>
              {error}
              {autoFetch && <button className="btn btn-outline btn-sm" style={{ marginLeft: 8 }} onClick={() => setDebugOpen(true)}>요청/응답 보기</button>}
            </p>
          )}
          {savedMsg && <p className="text-success" style={{ marginTop: 8 }}>{savedMsg}</p>}
          <KiwoomDebugModal open={debugOpen} onClose={() => setDebugOpen(false)} />
        </>
      )}

      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label">파싱 결과 (동일 일자·종목 합산) — {rows.length}건</p>
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>종목코드</th>
                  <th>종목명</th>
                  <th style={{ textAlign: 'right' }}>수량</th>
                  <th style={{ textAlign: 'right' }}>거래금액</th>
                  <th style={{ textAlign: 'right' }}>청산손익</th>
                  <th style={{ textAlign: 'right' }}>수수료</th>
                  <th style={{ textAlign: 'right' }}>세금</th>
                  <th style={{ textAlign: 'right' }}>적용환율</th>
                  <th style={{ textAlign: 'right' }}>실현손익(원)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.code || '-'}</td>
                    <td>{r.name || '-'}</td>
                    <td style={{ textAlign: 'right' }}>{r.qty !== undefined ? r.qty.toLocaleString() : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{r.sellAmount !== undefined ? r.sellAmount.toLocaleString() : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{r.liquidationProfit !== undefined ? r.liquidationProfit.toLocaleString() : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{r.fee.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{r.tax !== undefined ? r.tax.toLocaleString() : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{r.exrt !== undefined ? r.exrt.toLocaleString() : '-'}</td>
                    <td className={r.realizedProfit >= 0 ? 'pos' : 'neg'} style={{ textAlign: 'right' }}>{r.realizedProfit.toLocaleString()}</td>
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
    <div className="card card-flat">
      <div className="section-header">
        <h3 className="section-title">직접 입력 (정해진 포맷 없는 계좌 1회성 등록)</h3>
      </div>
      <div className="form-row">
        <select className="select input-sm" value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.accountId}</option>)}
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

  // 키움 API(ka10073/ust21530)로 실현손익 조회(기간은 RealizedProfitCard에서 선택)
  const fetchKrRealizedAuto = (from, to) => fetchKrRealizedProfit(from, to).then(async raw => {
    const rows = await transformKrRealizedProfit(raw)
    rows.notice = raw.notice
    return rows
  })
  const fetchUsRealizedAuto = (from, to) => fetchUsRealizedProfit(from, to).then(async raw => {
    const rows = await transformUsRealizedProfit(raw)
    rows.notice = raw.notice
    return rows
  })

  return (
    <div>
      <RealizedProfitCard
        title="키움국내 실현손익 (3058-4099)"
        fixedAccount={findAcc('3058-4099')}
        missingMsg="계좌 관리에 3058-4099 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitCredit}
        autoFetch={findAcc('3058-4099') ? fetchKrRealizedAuto : undefined}
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
        autoFetch={findAcc('5124-4860') ? fetchUsRealizedAuto : undefined}
        placeholder="[2153] 해외주식 실현손익"
        needsCodeLookup
        sectors={sectors}
      />
      <RealizedProfitCard
        title="미래에셋 실현손익"
        selectableAccounts={miraeAccounts}
        parseFn={parseRealizedProfitMirae}
        placeholder="[0615] 기간 종목별 매매일지 상세"
        needsCodeLookup
        sectors={sectors}
      />
      <RealizedProfitCard
        title="키움국내 옵션 계좌손익 (1611-0027)"
        fixedAccount={findAcc('1611-0027')}
        missingMsg="계좌 관리에 1611-0027 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitKrOptionAccount}
        placeholder="[0580] 매매내역 조회"
      />
      <RealizedProfitCard
        title="키움해외 옵션 계좌손익 (5767-2099)"
        fixedAccount={findAcc('5767-2099')}
        missingMsg="계좌 관리에 5767-2099 계좌를 먼저 등록하세요"
        parseFn={parseRealizedProfitKrOptionAccount2}
        placeholder="[4571] 해외선옵 거래내역 상세조회(1줄)"
      />
      <ManualEntryCard accounts={accounts} />
    </div>
  )
}
