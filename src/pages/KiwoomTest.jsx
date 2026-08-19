// 키움 REST API 호출 테스트 화면
import { useState } from 'react'
import {
  fetchKrHoldings, fetchKrCash, fetchUsLedger, fetchUsCashDetail,
  fetchKrCashFlows, fetchKrDailyChart, fetchUsDailyChart, fetchKrDailyQuote, fetchUsDailyQuote, kiwoomCall,
} from '../utils/kiwoomApi'
import '../common.css'

const SIMPLE_CALLS = [
  { label: '국내 보유종목 (kt00018)', kind: 'kr', path: '/api/dostk/acnt', apiId: 'kt00018', body: { qry_tp: '0', dmst_stex_tp: 'KRX' }, fn: fetchKrHoldings },
  { label: '국내 예수금 (kt00001)', kind: 'kr', path: '/api/dostk/acnt', apiId: 'kt00001', body: { qry_tp: '0', dmst_stex_tp: 'KRX' }, fn: fetchKrCash },
  { label: '해외 잔고 (ust21070)', kind: 'us', path: '/api/us/acnt', apiId: 'ust21070', body: { stex_tp: '', stk_cd: '' }, fn: fetchUsLedger },
  { label: '해외 예수금 (ust21160)', kind: 'us', path: '/api/us/acnt', apiId: 'ust21160', body: {}, fn: fetchUsCashDetail },
]

const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const monthAgo = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 86400000).toISOString().slice(0, 10)

export default function KiwoomTest() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const [flowFrom, setFlowFrom] = useState(monthAgo)
  const [flowTo, setFlowTo] = useState(today)

  const [chartMarket, setChartMarket] = useState('kr')
  const [chartCode, setChartCode] = useState('')
  const [chartFrom, setChartFrom] = useState(monthAgo)
  const [chartTo, setChartTo] = useState(today)

  const [quoteMarket, setQuoteMarket] = useState('kr')
  const [quoteCode, setQuoteCode] = useState('')

  const [rawKind, setRawKind] = useState('kr')
  const [rawPath, setRawPath] = useState('/api/dostk/acnt')
  const [rawApiId, setRawApiId] = useState('')
  const [rawBody, setRawBody] = useState('{\n  \n}')

  const runRaw = async () => {
    setLoading('커스텀')
    setError('')
    setResult(null)
    let body
    try {
      body = JSON.parse(rawBody)
    } catch (e) {
      setError('요청 JSON 파싱 실패: ' + e.message)
      setLoading('')
      return
    }
    try {
      const data = await kiwoomCall(rawKind, rawApiId, body, rawPath)
      setResult(data)
    } catch (e) {
      setError(e.message)
    }
    setLoading('')
  }

  // 프리셋 버튼도 커스텀 요청 필드에 실제 전송값을 채워서 보여준다
  const runWithRequest = async (label, kind, path, apiId, body, fn) => {
    setRawKind(kind)
    setRawPath(path)
    setRawApiId(apiId)
    setRawBody(JSON.stringify(body, null, 2))
    setLoading(label)
    setError('')
    setResult(null)
    try {
      const data = await fn()
      setResult(data)
    } catch (e) {
      setError(e.message)
    }
    setLoading('')
  }

  return (
    <div className="page">
      <h2 className="page-heading">키움 API 테스트</h2>
      <p className="text-muted" style={{ margin: '8px 0 20px' }}>버튼을 눌러 키움 API를 직접 호출하고 원본 응답을 확인합니다. CORS 오류는 브라우저 콘솔에도 표시됩니다.</p>

      <div className="card">
        <h4 className="section-label">계좌 조회</h4>
        <div style={styles.btnRow}>
          {SIMPLE_CALLS.map(({ label, kind, path, apiId, body, fn }) => (
            <button key={label} className="btn btn-outline-blue btn-sm" disabled={!!loading} onClick={() => runWithRequest(label, kind, path, apiId, body, fn)}>
              {loading === label ? '호출 중...' : label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h4 className="section-label">국내 입출금내역 (kt00015)</h4>
        <div style={styles.btnRow}>
          <input type="date" value={flowFrom} onChange={e => setFlowFrom(e.target.value)} className="input input-sm" />
          <span className="text-muted">~</span>
          <input type="date" value={flowTo} onChange={e => setFlowTo(e.target.value)} className="input input-sm" />
          <button
            className="btn btn-outline-blue btn-sm"
            disabled={!!loading}
            onClick={() => {
              const strt = flowFrom.replace(/-/g, ''), end = flowTo.replace(/-/g, '')
              const body = { strt_dt: strt, end_dt: end, tp: '1', stk_cd: '', crnc_cd: '', gds_tp: '0', frgn_stex_code: '', dmst_stex_tp: '%' }
              runWithRequest('입출금내역', 'kr', '/api/dostk/acnt', 'kt00015', body, () => fetchKrCashFlows(strt, end))
            }}
          >
            {loading === '입출금내역' ? '호출 중...' : '조회'}
          </button>
        </div>
      </div>

      <div className="card">
        <h4 className="section-label">일봉 차트 (ka10081 / usa06012)</h4>
        <div style={styles.btnRow}>
          <select value={chartMarket} onChange={e => setChartMarket(e.target.value)} className="select input-sm">
            <option value="kr">국내</option>
            <option value="us">해외</option>
          </select>
          <input placeholder="종목코드" value={chartCode} onChange={e => setChartCode(e.target.value)} className="input input-sm" />
          <input type="date" value={chartFrom} onChange={e => setChartFrom(e.target.value)} className="input input-sm" />
          <span className="text-muted">~</span>
          <input type="date" value={chartTo} onChange={e => setChartTo(e.target.value)} className="input input-sm" />
          <button
            className="btn btn-outline-blue btn-sm"
            disabled={!!loading || !chartCode}
            onClick={() => {
              const toDt = chartTo.replace(/-/g, '')
              const isKr = chartMarket === 'kr'
              const path = isKr ? '/api/dostk/chart' : '/api/us/chart'
              const apiId = isKr ? 'ka10081' : 'usa06012'
              const body = isKr
                ? { stk_cd: chartCode, base_dt: toDt, upd_stkpc_tp: '1' }
                : { stex_tp: 'ND', stk_cd: chartCode, strt_dt: toDt, upd_stkpc_tp: '1', exrt_appl_tp: '0' } // 해외는 ND→NY→NA 순 재시도, 여기엔 첫 시도값만 표시
              runWithRequest('차트', chartMarket, path, apiId, body, () => (isKr ? fetchKrDailyChart : fetchUsDailyChart)(chartCode, chartFrom, chartTo))
            }}
          >
            {loading === '차트' ? '호출 중...' : '조회'}
          </button>
        </div>
      </div>

      <div className="card">
        <h4 className="section-label">종목시세 (ka10086 / usa20590)</h4>
        <div style={styles.btnRow}>
          <select value={quoteMarket} onChange={e => setQuoteMarket(e.target.value)} className="select input-sm">
            <option value="kr">국내</option>
            <option value="us">해외</option>
          </select>
          <input placeholder="종목코드" value={quoteCode} onChange={e => setQuoteCode(e.target.value)} className="input input-sm" />
          <button
            className="btn btn-outline-blue btn-sm"
            disabled={!!loading || !quoteCode}
            onClick={() => {
              const toDt = today.replace(/-/g, '')
              const isKr = quoteMarket === 'kr'
              const path = isKr ? '/api/dostk/mrkcond' : '/api/us/mrkcond'
              const apiId = isKr ? 'ka10086' : 'usa20590'
              const body = isKr
                ? { stk_cd: quoteCode, qry_dt: toDt, indc_tp: '1' }
                : { stex_tp: 'ND', stk_cd: quoteCode, base_dt: toDt } // 해외는 ND→NY→NA 순 재시도, 여기엔 첫 시도값만 표시
              runWithRequest('종목시세', quoteMarket, path, apiId, body, () => (isKr ? fetchKrDailyQuote : fetchUsDailyQuote)(quoteCode, monthAgo, today))
            }}
          >
            {loading === '종목시세' ? '호출 중...' : '조회'}
          </button>
        </div>
      </div>

      <div className="card">
        <h4 className="section-label">커스텀 요청</h4>
        <div style={{ ...styles.btnRow, marginBottom: 8 }}>
          <select
            value={rawKind}
            onChange={e => {
              const kind = e.target.value
              setRawKind(kind)
              setRawPath(kind === 'kr' ? '/api/dostk/acnt' : '/api/us/acnt')
            }}
            className="select input-sm"
          >
            <option value="kr">국내</option>
            <option value="us">해외</option>
          </select>
          <input placeholder="path (예: /api/dostk/acnt)" value={rawPath} onChange={e => setRawPath(e.target.value)} className="input input-sm" style={{ width: 220 }} />
          <input placeholder="api-id (예: kt00018)" value={rawApiId} onChange={e => setRawApiId(e.target.value)} className="input input-sm" />
          <button className="btn btn-outline-blue btn-sm" disabled={!!loading || !rawApiId} onClick={runRaw}>
            {loading === '커스텀' ? '호출 중...' : '호출'}
          </button>
        </div>
        <textarea
          value={rawBody}
          onChange={e => setRawBody(e.target.value)}
          spellCheck={false}
          className="textarea"
          style={{ minHeight: 140, fontSize: 12 }}
        />
      </div>

      {error && <div style={styles.error}>에러: {error}</div>}

      {result !== null && (
        <div className="card">
          <div className="section-header">
            <h4 className="section-label">응답 ({Array.isArray(result) ? `${result.length}건` : '객체'})</h4>
            <button className="btn btn-outline btn-sm" onClick={handleCopy}>{copied ? '복사됨' : '클립보드 복사'}</button>
          </div>
          <pre style={styles.pre}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

const styles = {
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  error: { color: '#f87171', background: '#1e293b', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' },
  pre: { color: '#e2e8f0', fontSize: 12, overflow: 'auto', maxHeight: 500, margin: 0 },
}
