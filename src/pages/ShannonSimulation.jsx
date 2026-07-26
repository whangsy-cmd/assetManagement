import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { getSavedSymbols, getPriceSeries, downloadMissingRange, addDays, parseCsvPrices, saveCsvPrices } from '../utils/priceData'
import { deleteDocument } from '../utils/firestore'
import '../common.css'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const DEFAULT_FROM = addDays(TODAY, -365 * 3)

function sgn(v) { return v >= 0 ? '+' : '' }
function pc(v) { return v >= 0 ? 'pos' : 'neg' }

// ── 셰넌 리밸런싱 시뮬레이션 (순수 함수) ────────────────────
// 안전자산은 현금이든 종목이든 연 배당률을 월 1회(월 넘어갈 때) 복리로 반영한다.
// riskyAlone/safeAlone: 각 자산에 100% 투자했을 때 단독 성과(1.0 기준 배수) — 비교용.
function simulateTwoAsset(dates, riskyCloseOf, safeCloseOf, safeAnnualDividendPct, targetSafePct, band, initial) {
  let riskyVal = initial * (100 - targetSafePct) / 100
  let safeVal = initial * targetSafePct / 100
  let riskyAlone = 1, safeAlone = 1
  const monthlyDiv = Math.pow(1 + safeAnnualDividendPct / 100, 1 / 12) - 1
  let curMonth = dates[0].slice(0, 7)
  const path = [{ date: dates[0], total: riskyVal + safeVal, riskyAlone, safeAlone, rebalanced: false }]
  let rebalanceCount = 0
  for (let i = 1; i < dates.length; i++) {
    const riskyRet = riskyCloseOf(dates[i]) / riskyCloseOf(dates[i - 1]) - 1
    const safePriceRet = safeCloseOf ? (safeCloseOf(dates[i]) / safeCloseOf(dates[i - 1]) - 1) : 0
    riskyVal *= (1 + riskyRet); safeVal *= (1 + safePriceRet)
    riskyAlone *= (1 + riskyRet); safeAlone *= (1 + safePriceRet)

    const dateMonth = dates[i].slice(0, 7)
    if (dateMonth !== curMonth) {
      safeVal *= (1 + monthlyDiv); safeAlone *= (1 + monthlyDiv)
      curMonth = dateMonth
    }

    const total = riskyVal + safeVal
    const curSafePct = total > 0 ? (safeVal / total) * 100 : 0
    let rebalanced = false
    if (Math.abs(curSafePct - targetSafePct) > band) {
      safeVal = total * targetSafePct / 100
      riskyVal = total * (100 - targetSafePct) / 100
      rebalanceCount++
      rebalanced = true
    }
    path.push({ date: dates[i], total, riskyAlone, safeAlone, rebalanced })
  }
  return { path, rebalanceCount }
}

function RebalanceDot({ cx, cy, payload }) {
  if (!payload.rebalanced) return null
  return <circle cx={cx} cy={cy} r={4} fill="#f59e0b" stroke="#78350f" strokeWidth={1} />
}

function maxDrawdown(series) {
  let peak = series[0], dd = 0
  for (const v of series) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return dd
}

export default function ShannonSimulation() {
  const { user } = useAuth()
  const [tab, setTab] = useState('sim')
  const [savedSymbols, setSavedSymbols] = useState([])
  const [symbolsLoading, setSymbolsLoading] = useState(true)

  const refreshSymbols = async () => {
    if (!user) return
    setSymbolsLoading(true)
    setSavedSymbols(await getSavedSymbols(user.uid))
    setSymbolsLoading(false)
  }

  useEffect(() => { refreshSymbols() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [user])

  if (!user) return null

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">셰넌의 법칙 시뮬레이션</h2>
        <span className="page-heading-sub">2개 종목(현금 포함) 리밸런싱 수익률 시뮬레이션</span>
      </div>

      <div className="toggle-group" style={{ marginBottom: 12 }}>
        <button className={`toggle-btn${tab === 'sim' ? ' active' : ''}`} onClick={() => setTab('sim')}>시뮬레이션</button>
        <button className={`toggle-btn${tab === 'symbols' ? ' active' : ''}`} onClick={() => setTab('symbols')}>종목관리</button>
      </div>

      {tab === 'symbols'
        ? <SymbolManageTab user={user} savedSymbols={savedSymbols} symbolsLoading={symbolsLoading} refreshSymbols={refreshSymbols} />
        : <SimulationTab user={user} savedSymbols={savedSymbols} />
      }
    </div>
  )
}

// ── 종목관리 탭 ───────────────────────────────────────────────
function SymbolManageTab({ user, savedSymbols, symbolsLoading, refreshSymbols }) {
  const [dlCode, setDlCode] = useState('')
  const [dlName, setDlName] = useState('')
  const [dlFrom, setDlFrom] = useState(DEFAULT_FROM)
  const [dlTo, setDlTo] = useState(TODAY)
  const [dlStatus, setDlStatus] = useState({ loading: false, msg: '', error: '' })

  const [csvCode, setCsvCode] = useState('')
  const [csvName, setCsvName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvStatus, setCsvStatus] = useState({ loading: false, msg: '', error: '' })

  const handleDownload = async () => {
    if (!dlCode.trim()) return
    setDlStatus({ loading: true, msg: '', error: '' })
    try {
      const { added, total } = await downloadMissingRange(user.uid, dlCode.trim(), dlName.trim(), dlFrom, dlTo)
      setDlStatus({ loading: false, msg: added > 0 ? `${added}건 추가 저장 (총 ${total}건)` : `이미 최신 상태 (총 ${total}건)`, error: '' })
      refreshSymbols()
    } catch (e) {
      setDlStatus({ loading: false, msg: '', error: e.message })
    }
  }

  const handleDeleteSymbol = async (code) => {
    if (!window.confirm(`${code} 가격 데이터를 삭제할까요?`)) return
    await deleteDocument(user.uid, 'priceSeries', code)
    refreshSymbols()
  }

  const handleCsvFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result))
      if (!csvCode.trim()) {
        const base = file.name.replace(/\.csv$/i, '')
        setCsvCode(base.split(/[_\s]/)[0].toUpperCase())
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCsvImport = async () => {
    if (!csvCode.trim() || !csvText.trim()) return
    setCsvStatus({ loading: true, msg: '', error: '' })
    try {
      const rows = parseCsvPrices(csvText)
      const { added, total } = await saveCsvPrices(user.uid, csvCode.trim(), csvName.trim(), rows)
      setCsvStatus({ loading: false, msg: `${added}건 반영 (총 ${total}건)`, error: '' })
      setCsvText('')
      refreshSymbols()
    } catch (e) {
      setCsvStatus({ loading: false, msg: '', error: e.message })
    }
  }

  return (
    <div className="card">
      <div className="section-header">
        <h3 className="section-title">저장된 종목 목록</h3>
        <button className="toggle-btn" onClick={refreshSymbols}>↺ 새로고침</button>
      </div>

      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <InputField label="종목코드"><input placeholder="예: 069500, AAPL" value={dlCode} onChange={e => setDlCode(e.target.value.trim())} style={{ ...numInputStyle, width: 130 }} /></InputField>
          <InputField label="종목명"><input placeholder="종목명" value={dlName} onChange={e => setDlName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="시작일"><input type="date" value={dlFrom} onChange={e => setDlFrom(e.target.value)} style={numInputStyle} /></InputField>
          <InputField label="종료일"><input type="date" value={dlTo} onChange={e => setDlTo(e.target.value)} style={numInputStyle} /></InputField>
          <button className="toggle-btn active" onClick={handleDownload} disabled={dlStatus.loading || !dlCode}>
            {dlStatus.loading ? '다운로드 중...' : '가격 데이터 다운로드'}
          </button>
        </div>
        {dlStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{dlStatus.msg}</p>}
        {dlStatus.error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{dlStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          이미 저장된 구간은 건너뛰고 없는 구간만 내려받습니다. 6자리 숫자 코드는 국내(키움 ka10081), 그 외는 미국 종목(키움 usa06012)으로 조회합니다. 키움이 지원하지 않는 종목(레버리지 ETF 등)은 아래 CSV 가져오기를 이용하세요.
        </p>
      </div>

      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>CSV 파일 가져오기</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'flex-end' }}>
          <InputField label="종목코드"><input placeholder="예: SOXL" value={csvCode} onChange={e => setCsvCode(e.target.value.trim())} style={{ ...numInputStyle, width: 130 }} /></InputField>
          <InputField label="종목명"><input placeholder="종목명" value={csvName} onChange={e => setCsvName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="CSV 파일">
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{ ...numInputStyle, width: 220, padding: '4px 6px' }} />
          </InputField>
        </div>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={'파일을 선택하면 내용이 여기 표시됩니다. 직접 붙여넣기도 가능: date,close\n2024-01-02,187.15\n...'}
          rows={5}
          style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: 8, color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
        />
        <button className="toggle-btn active" onClick={handleCsvImport} disabled={csvStatus.loading || !csvCode || !csvText}>
          {csvStatus.loading ? '가져오는 중...' : 'CSV 가져오기'}
        </button>
        {csvStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{csvStatus.msg}</p>}
        {csvStatus.error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{csvStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          Shannon/fetch_stock.py로 로컬에서 받은 결과(예: <code>python fetch_stock.py SOXL 2022-01-01 2024-12-31</code> 실행 후 출력된 date,close CSV)를 붙여넣으면 됩니다.
        </p>
      </div>

      {symbolsLoading ? (
        <p className="dim">불러오는 중...</p>
      ) : savedSymbols.length === 0 ? (
        <p className="dim">저장된 가격 데이터가 없습니다. 위에서 종목을 다운로드하세요.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>코드</th><th>이름</th><th>시장</th><th className="r">구간</th><th className="r">건수</th><th></th></tr>
            </thead>
            <tbody>
              {savedSymbols.map(s => (
                <tr key={s.code}>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td className="dim">{s.market}</td>
                  <td className="r dim">{s.minDate} ~ {s.maxDate}</td>
                  <td className="r">{s.count}</td>
                  <td className="r"><button className="toggle-btn" style={{ color: '#f87171', borderColor: '#7f1d1d' }} onClick={() => handleDeleteSymbol(s.code)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 시뮬레이션 탭 ─────────────────────────────────────────────
function SimulationTab({ user, savedSymbols }) {
  const [riskyAsset, setRiskyAsset] = useState({ code: '', name: '' })
  const [safeAsset, setSafeAsset] = useState({ mode: 'cash', code: '', name: '현금', dividendRate: 3.5 })
  const [targetSafePct, setTargetSafePct] = useState(30)
  const [band, setBand] = useState(10)
  const [initialAmount, setInitialAmount] = useState(10000000)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [simResult, setSimResult] = useState(null)
  const [simError, setSimError] = useState('')
  const [simLoading, setSimLoading] = useState(false)

  const riskySym = savedSymbols.find(s => s.code === riskyAsset.code)
  const safeSym = safeAsset.mode === 'ticker' ? savedSymbols.find(s => s.code === safeAsset.code) : null
  const availMin = safeSym ? (riskySym?.minDate > safeSym.minDate ? riskySym.minDate : safeSym.minDate) : riskySym?.minDate
  const availMax = safeSym ? (riskySym?.maxDate < safeSym.maxDate ? riskySym.maxDate : safeSym.maxDate) : riskySym?.maxDate

  // 자산 선택이 바뀌면 등록된 데이터가 겹치는 구간으로 기간 초기값 설정
  useEffect(() => {
    if (availMin && availMax) { setDateFrom(availMin); setDateTo(availMax) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskyAsset.code, safeAsset.code, safeAsset.mode])

  const pickAsset = (setter) => (e) => {
    const sym = savedSymbols.find(s => s.code === e.target.value)
    setter(prev => (sym ? { ...prev, code: sym.code, name: sym.name } : { ...prev, code: '', name: '' }))
  }

  const handleSimulate = async () => {
    setSimError(''); setSimResult(null)
    if (!riskyAsset.code) {
      setSimError('위험자산(자산 A)을 선택하세요.')
      return
    }
    setSimLoading(true)
    try {
      const seriesByCode = {}
      let dateSet = null

      const riskyS = await getPriceSeries(user.uid, riskyAsset.code)
      if (!riskyS) throw new Error(`${riskyAsset.code}: 저장된 가격 데이터가 없습니다.`)
      seriesByCode[riskyAsset.code] = riskyS.prices
      dateSet = Object.keys(riskyS.prices).filter(d => d >= dateFrom && d <= dateTo).sort()

      if (safeAsset.mode === 'ticker' && safeAsset.code) {
        const safeS = await getPriceSeries(user.uid, safeAsset.code)
        if (!safeS) throw new Error(`${safeAsset.code}: 저장된 가격 데이터가 없습니다.`)
        seriesByCode[safeAsset.code] = safeS.prices
        const safeDates = Object.keys(safeS.prices)
        dateSet = dateSet.filter(d => safeDates.includes(d))
      }

      if (dateSet.length < 2) throw new Error('시뮬레이션 가능한 거래일이 부족합니다. 데이터 구간이나 기간을 확인하세요.')

      const riskyCloseOf = (date) => seriesByCode[riskyAsset.code][date]
      const safeCloseOf = (safeAsset.mode === 'ticker' && safeAsset.code)
        ? (date => seriesByCode[safeAsset.code][date])
        : null

      const { path, rebalanceCount } = simulateTwoAsset(
        dateSet, riskyCloseOf, safeCloseOf, safeAsset.dividendRate, targetSafePct, band, initialAmount
      )

      const rebalSeries = path.map(p => p.total / initialAmount)
      const riskySeries = path.map(p => p.riskyAlone)
      const safeSeries = path.map(p => p.safeAlone)
      const days = (new Date(dateSet.at(-1)) - new Date(dateSet[0])) / 86400000
      const years = days / 365

      const riskyLabel = riskyAsset.name || riskyAsset.code
      const safeLabel = safeAsset.mode === 'cash' ? '현금' : (safeAsset.name || safeAsset.code)

      setSimResult({
        riskyLabel, safeLabel,
        chartData: path.map((p, i) => ({
          date: p.date, 리밸런싱: rebalSeries[i], [riskyLabel]: riskySeries[i], [safeLabel]: safeSeries[i],
          rebalanced: p.rebalanced,
        })),
        rebalFinal: rebalSeries.at(-1),
        riskyFinal: riskySeries.at(-1),
        safeFinal: safeSeries.at(-1),
        rebalCAGR: years > 0 ? Math.pow(rebalSeries.at(-1), 1 / years) - 1 : 0,
        riskyCAGR: years > 0 ? Math.pow(riskySeries.at(-1), 1 / years) - 1 : 0,
        safeCAGR: years > 0 ? Math.pow(safeSeries.at(-1), 1 / years) - 1 : 0,
        rebalMDD: maxDrawdown(rebalSeries),
        riskyMDD: maxDrawdown(riskySeries),
        safeMDD: maxDrawdown(safeSeries),
        rebalanceCount,
        fromDate: dateSet[0],
        toDate: dateSet.at(-1),
        days: dateSet.length,
      })
    } catch (e) {
      setSimError(e.message)
    }
    setSimLoading(false)
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>자산 설정</div>
        {savedSymbols.length === 0 ? (
          <p className="dim">저장된 종목이 없습니다. 종목관리 탭에서 먼저 가격 데이터를 받아오세요.</p>
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={boxStyle}>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>자산 A — 위험자산 (고정)</div>
              <select value={riskyAsset.code} onChange={pickAsset(setRiskyAsset)} style={{ ...numInputStyle, width: '100%' }}>
                <option value="">종목 선택...</option>
                {savedSymbols.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
              {riskySym && <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>보유 구간: {riskySym.minDate} ~ {riskySym.maxDate}</p>}
            </div>

            <div style={boxStyle}>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>자산 B — 안전자산</div>
              <div className="toggle-group" style={{ marginBottom: 10 }}>
                <button className={`toggle-btn${safeAsset.mode === 'cash' ? ' active' : ''}`} onClick={() => setSafeAsset(a => ({ ...a, mode: 'cash', code: '', name: '현금' }))}>현금</button>
                <button className={`toggle-btn${safeAsset.mode === 'ticker' ? ' active' : ''}`} onClick={() => setSafeAsset(a => ({ ...a, mode: 'ticker', code: '', name: '' }))}>종목코드</button>
              </div>
              {safeAsset.mode === 'ticker' && (
                <>
                  <select value={safeAsset.code} onChange={pickAsset(setSafeAsset)} style={{ ...numInputStyle, width: '100%', marginBottom: 8 }}>
                    <option value="">종목 선택...</option>
                    {savedSymbols.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                  </select>
                  {safeSym && <p className="dim" style={{ fontSize: 12, marginTop: -4, marginBottom: 8 }}>보유 구간: {safeSym.minDate} ~ {safeSym.maxDate}</p>}
                </>
              )}
              <InputField label="연 배당률(%) — 매월 복리 반영">
                <input type="number" step="0.1" value={safeAsset.dividendRate}
                  onChange={e => setSafeAsset(a => ({ ...a, dividendRate: Number(e.target.value) }))} style={numInputStyle} />
              </InputField>
            </div>
          </div>
        )}
        <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
          자산 A는 항상 위험자산, 자산 B는 항상 안전자산입니다. 안전자산은 현금이든 종목이든 지정한 연 배당률을 매월 복리로 반영합니다(종목이면 가격변동 + 월배당).
        </p>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>시뮬레이션 설정</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <InputField label="시작일">
            <input type="date" value={dateFrom} min={availMin} max={availMax} onChange={e => setDateFrom(e.target.value)} style={numInputStyle} />
          </InputField>
          <InputField label="종료일">
            <input type="date" value={dateTo} min={availMin} max={availMax} onChange={e => setDateTo(e.target.value)} style={numInputStyle} />
          </InputField>
          <InputField label="초기 투자금">
            <input type="number" value={initialAmount} onChange={e => setInitialAmount(Number(e.target.value))} style={{ ...numInputStyle, width: 130 }} />
          </InputField>
          <InputField label="목표 안전자산 비중(%)">
            <input type="number" value={targetSafePct} onChange={e => setTargetSafePct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="리밸런싱 밴드(±%p)">
            <input type="number" value={band} onChange={e => setBand(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <button className="toggle-btn active" onClick={handleSimulate} disabled={simLoading}>
            {simLoading ? '계산 중...' : '시뮬레이션 실행'}
          </button>
        </div>
        {availMin && availMax && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>선택한 자산의 등록 데이터 구간: {availMin} ~ {availMax}</p>}
        {simError && <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{simError}</p>}
      </div>

      {simResult && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">결과 — {simResult.fromDate} ~ {simResult.toDate} ({simResult.days}거래일)</h3>
          </div>
          <div className="summary-bar" style={{ marginBottom: 12 }}>
            <div className="summary-item">
              <span className="summary-label">리밸런싱 최종배수</span>
              <span className={`summary-item-val ${pc(simResult.rebalFinal - 1)}`}>{simResult.rebalFinal.toFixed(2)}x</span>
              <span className="summary-sub">CAGR {sgn(simResult.rebalCAGR)}{(simResult.rebalCAGR * 100).toFixed(1)}% / MDD {(simResult.rebalMDD * 100).toFixed(1)}%</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">{simResult.riskyLabel} 단독</span>
              <span className={`summary-item-val ${pc(simResult.riskyFinal - 1)}`}>{simResult.riskyFinal.toFixed(2)}x</span>
              <span className="summary-sub">CAGR {sgn(simResult.riskyCAGR)}{(simResult.riskyCAGR * 100).toFixed(1)}% / MDD {(simResult.riskyMDD * 100).toFixed(1)}%</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">{simResult.safeLabel} 단독</span>
              <span className={`summary-item-val ${pc(simResult.safeFinal - 1)}`}>{simResult.safeFinal.toFixed(2)}x</span>
              <span className="summary-sub">CAGR {sgn(simResult.safeCAGR)}{(simResult.safeCAGR * 100).toFixed(1)}% / MDD {(simResult.safeMDD * 100).toFixed(1)}%</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">리밸런싱 횟수</span>
              <span className="summary-item-val">{simResult.rebalanceCount}회</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={simResult.chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(0, 7)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v.toFixed(1) + 'x'} width={45} />
              <Tooltip contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }} formatter={v => v.toFixed(3) + 'x'} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey={simResult.riskyLabel} stroke="#ef4444" strokeWidth={1.2} dot={false} />
              <Line type="monotone" dataKey={simResult.safeLabel} stroke="#94a3b8" strokeWidth={1.2} dot={false} />
              <Line type="monotone" dataKey="리밸런싱" stroke="#3b82f6" strokeWidth={2} dot={<RebalanceDot />} />
            </LineChart>
          </ResponsiveContainer>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>노란 점 = 밴드를 벗어나 리밸런싱이 실행된 시점</p>
        </div>
      )}
    </>
  )
}

function InputField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#94a3b8' }}>
      {label}
      {children}
    </label>
  )
}

const boxStyle = { minWidth: 280, flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14 }

const numInputStyle = {
  background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155',
  borderRadius: 6, padding: '5px 8px', fontSize: 13, width: 80,
}
