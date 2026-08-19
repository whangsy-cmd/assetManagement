// 종목관리 탭 — 시뮬레이션(셰넌/종목비교) 공용 가격 데이터(priceSeries) 등록/조회
import { useEffect, useState } from 'react'
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { getSavedSymbols, getPriceSeries, downloadMissingRange, addDays, parseCsvPrices, saveCsvPrices, isKoreanCode } from '../utils/priceData'
import { deleteDocument, getSectors, saveSector } from '../utils/firestore'
import { fetchKrStockInfo, fetchUsStockInfo } from '../utils/kiwoomApi'
import InputField, { numInputStyle } from '../components/InputField'
import '../common.css'

const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const DEFAULT_FROM = addDays(TODAY, -365 * 3)

// range([low,high]) Bar의 x/y/width/height는 recharts가 이미 고가~저가 구간의 픽셀 좌표로 계산해줌 —
// 그 안에서 시가/종가 위치를 선형보간해 몸통(사각형)+꼬리(수직선)를 직접 그림 (StockPeriodTab.jsx와 동일한 방식)
function Candle({ x, y, width, height, payload }) {
  const { open, high, low, close } = payload
  if (high == null || low == null || high === low) {
    return <line x1={x} x2={x + width} y1={y + height / 2} y2={y + height / 2} stroke="#64748b" strokeWidth={1} />
  }
  const up = close >= open
  const color = up ? '#22c55e' : '#ef4444'
  const scale = height / (high - low)
  const yOpen = y + (high - open) * scale
  const yClose = y + (high - close) * scale
  const bodyY = Math.min(yOpen, yClose)
  const bodyH = Math.max(Math.abs(yClose - yOpen), 1)
  const bodyX = x + width * 0.2
  const bodyW = width * 0.6
  return (
    <g>
      <line x1={x + width / 2} x2={x + width / 2} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} fill={color} />
    </g>
  )
}

function CandleTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0]?.payload
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>{label}</p>
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>시가 {p.open?.toLocaleString()} · 고가 {p.high?.toLocaleString()} · 저가 {p.low?.toLocaleString()}</p>
      <p style={{ color: '#3b82f6', margin: '2px 0' }}>종가 {p.close?.toLocaleString()}</p>
    </div>
  )
}

export default function SymbolManageTab() {
  const { user } = useAuth()
  const [savedSymbols, setSavedSymbols] = useState([])
  const [symbolsLoading, setSymbolsLoading] = useState(true)

  const refreshSymbols = async () => {
    if (!user) return
    setSymbolsLoading(true)
    setSavedSymbols(await getSavedSymbols(user.uid))
    setSymbolsLoading(false)
  }

  useEffect(() => { refreshSymbols() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [user])

  // 등록된 종목코드(종목코드 등록 메뉴) 목록 — 텍스트입력 가능한 선택박스 후보용
  const [registeredCodes, setRegisteredCodes] = useState([])
  useEffect(() => { if (user) getSectors(user.uid).then(list => setRegisteredCodes(list.map(s => ({ code: s.code, name: s.name })))) }, [user])

  const [dlCode, setDlCode] = useState('')
  const [dlName, setDlName] = useState('')
  const [showCodeList, setShowCodeList] = useState(false)
  const [dlFrom, setDlFrom] = useState(DEFAULT_FROM)
  const [dlTo, setDlTo] = useState(TODAY)
  const [dlStatus, setDlStatus] = useState({ loading: false, msg: '', error: '' })

  const codeMatches = dlCode
    ? registeredCodes.filter(o => o.code.toLowerCase().includes(dlCode.toLowerCase()) || (o.name || '').toLowerCase().includes(dlCode.toLowerCase())).slice(0, 20)
    : registeredCodes.slice(0, 20)

  const pickCode = (o) => {
    setDlCode(o.code)
    setDlName(o.name || '')
    setShowCodeList(false)
    // 이미 가격 데이터가 있는 종목이면 기존 기간을 그대로 채워줌
    const saved = savedSymbols.find(s => s.code === o.code)
    if (saved) {
      setDlFrom(saved.minDate)
      setDlTo(saved.maxDate)
      setSelectedSymbol(saved)
    }
  }

  const [csvCode, setCsvCode] = useState('')
  const [csvName, setCsvName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvStatus, setCsvStatus] = useState({ loading: false, msg: '', error: '' })

  // 종목 목록에서 선택한 종목의 캔들 차트 — 기간은 목록에 이미 있는 minDate~maxDate 그대로 사용
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [chartSeries, setChartSeries] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => {
    if (!user || !selectedSymbol) { setChartSeries(null); return }
    setChartLoading(true)
    getPriceSeries(user.uid, selectedSymbol.code).then(series => { setChartSeries(series); setChartLoading(false) })
  }, [user, selectedSymbol])

  const chartData = chartSeries
    ? Object.keys(chartSeries.prices).sort().map(d => {
      const close = chartSeries.prices[d]
      const open = chartSeries.opens?.[d] ?? close
      const high = chartSeries.highs?.[d] ?? close
      const low = chartSeries.lows?.[d] ?? close
      return { date: d, open, high, low, close, range: [low, high] }
    })
    : []

  if (!user) return null

  const handleDownload = async () => {
    if (!dlCode.trim()) return
    setDlStatus({ loading: true, msg: '', error: '' })
    try {
      const code = dlCode.trim()
      let name = dlName.trim()
      const registered = registeredCodes.find(o => o.code === code)

      if (!registered) {
        // 종목코드 등록(sectors)에 없는 코드면 자동 등록 — 키움 기본정보(국내 ka10001 / 해외 usa10100)로 종목명 조회
        try {
          const info = isKoreanCode(code) ? await fetchKrStockInfo(code) : await fetchUsStockInfo(code)
          if (info.name) name = info.name
        } catch { /* 조회 실패 시 입력한 이름(또는 코드)으로 등록 */ }
        await saveSector(user.uid, { code, name: name || code, sector: '미분류', memo: '' })
        setRegisteredCodes(r => [...r, { code, name: name || code }])
      } else {
        // 이미 등록된 종목코드면 입력칸에 뭐가 들어있든 종목코드 등록(sectors)의 이름을 항상 우선 사용
        name = registered.name
      }

      const { added, total } = await downloadMissingRange(user.uid, code, name, dlFrom, dlTo)
      setDlStatus({ loading: false, msg: added > 0 ? `${added}건 추가 저장 (총 ${total}건)` : `이미 최신 상태 (총 ${total}건)`, error: '' })
      refreshSymbols()
    } catch (e) {
      setDlStatus({ loading: false, msg: '', error: e.message })
    }
  }

  const handleDeleteSymbol = async (code) => {
    if (!window.confirm(`${code} 가격 데이터를 삭제할까요?`)) return
    await deleteDocument(user.uid, 'priceSeries', code)
    if (selectedSymbol?.code === code) setSelectedSymbol(null)
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

      <div style={{ ...boxStyle, marginBottom: 14 }}>
        <div className="form-row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <InputField label="종목코드">
            <div style={{ position: 'relative' }}>
              <input
                placeholder="예: 069500, AAPL"
                value={dlCode}
                onChange={e => { setDlCode(e.target.value.trim()); setShowCodeList(true) }}
                onFocus={() => setShowCodeList(true)}
                onBlur={() => setTimeout(() => setShowCodeList(false), 150)}
                style={{ ...numInputStyle, width: 130 }}
              />
              {showCodeList && codeMatches.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, marginTop: 4, maxHeight: 220, overflowY: 'auto', minWidth: 180, background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
                  {codeMatches.map(o => (
                    <div key={o.code} onMouseDown={() => pickCode(o)} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {o.code} — {o.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </InputField>
          <InputField label="종목명"><input placeholder="종목명" value={dlName} onChange={e => setDlName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="시작일"><input type="date" value={dlFrom} onChange={e => setDlFrom(e.target.value)} style={numInputStyle} /></InputField>
          <InputField label="종료일"><input type="date" value={dlTo} onChange={e => setDlTo(e.target.value)} style={numInputStyle} /></InputField>
          <button className="toggle-btn active" onClick={handleDownload} disabled={dlStatus.loading || !dlCode}>
            {dlStatus.loading ? '가져오는 중...' : '키움에서 데이터 가져오기'}
          </button>
        </div>
        {dlStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{dlStatus.msg}</p>}
        {dlStatus.error && <p className="text-error" style={{ marginTop: 8 }}>{dlStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          이미 저장된 구간은 건너뛰고 없는 구간만 내려받습니다(시가/고가/저가/종가 모두 저장). 6자리 숫자 코드는 국내(키움 ka10086), 그 외는 미국 종목(키움 usa20590)으로 조회합니다. 키움이 지원하지 않는 종목(레버리지 ETF 등)은 아래 CSV 가져오기를 이용하세요.
        </p>
      </div>

      <div style={{ ...boxStyle, marginBottom: 14 }}>
        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>CSV 파일 등록</div>
        <div className="form-row" style={{ gap: 12, marginBottom: 10, alignItems: 'flex-end' }}>
          <InputField label="종목코드"><input placeholder="예: SOXL" value={csvCode} onChange={e => setCsvCode(e.target.value.trim())} style={{ ...numInputStyle, width: 130 }} /></InputField>
          <InputField label="종목명"><input placeholder="종목명" value={csvName} onChange={e => setCsvName(e.target.value)} style={{ ...numInputStyle, width: 110 }} /></InputField>
          <InputField label="CSV 파일">
            <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{ ...numInputStyle, width: 220, padding: '4px 6px' }} />
          </InputField>
        </div>
        <textarea
          className="textarea"
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder={'파일을 선택하면 내용이 여기 표시됩니다. 직접 붙여넣기도 가능: date,close\n2024-01-02,187.15\n...'}
          rows={5}
          style={{ fontSize: 12, marginBottom: 8 }}
        />
        <button className="toggle-btn active" onClick={handleCsvImport} disabled={csvStatus.loading || !csvCode || !csvText}>
          {csvStatus.loading ? '가져오는 중...' : 'CSV 등록'}
        </button>
        {csvStatus.msg && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>{csvStatus.msg}</p>}
        {csvStatus.error && <p className="text-error" style={{ marginTop: 8 }}>{csvStatus.error}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          Shannon/fetch_stock.py로 로컬에서 받은 결과(예: <code>python fetch_stock.py SOXL 2022-01-01 2024-12-31</code> 실행 후 출력된 date,close CSV)를 붙여넣으면 됩니다.
        </p>
      </div>

      {symbolsLoading ? (
        <p className="dim">불러오는 중...</p>
      ) : savedSymbols.length === 0 ? (
        <p className="dim">저장된 가격 데이터가 없습니다. 위에서 종목을 다운로드하세요.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th>코드</th><th>이름</th><th>시장</th><th className="r">구간</th><th className="r">건수</th><th></th></tr>
            </thead>
            <tbody>
              {savedSymbols.map(s => (
                <tr
                  key={s.code}
                  onClick={() => {
                    setSelectedSymbol(s)
                    // 기존 종목 선택 시 위 다운로드 폼에도 코드/이름/기간을 그대로 채워줌(연장 다운로드 편의)
                    setDlCode(s.code)
                    setDlName(s.name)
                    setDlFrom(s.minDate)
                    setDlTo(s.maxDate)
                  }}
                  style={{ cursor: 'pointer', background: selectedSymbol?.code === s.code ? '#1e293b' : undefined }}
                >
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td className="dim">{s.market}</td>
                  <td className="r dim">{s.minDate} ~ {s.maxDate}</td>
                  <td className="r">{s.count}</td>
                  <td className="r"><button className="toggle-btn" style={{ color: '#f87171', borderColor: '#7f1d1d' }} onClick={e => { e.stopPropagation(); handleDeleteSymbol(s.code) }}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSymbol && (
        <div className="card card-flat" style={{ marginTop: 14 }}>
          <div className="section-header">
            <h3 className="section-title">가격 차트 — {selectedSymbol.code} {selectedSymbol.name}</h3>
            <span className="dim" style={{ fontSize: 12 }}>{selectedSymbol.minDate} ~ {selectedSymbol.maxDate}</span>
          </div>
          {chartLoading ? (
            <p className="dim">불러오는 중...</p>
          ) : chartData.length === 0 ? (
            <p className="dim">가격 데이터가 없습니다.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 11 }} width={55} />
                <Tooltip content={<CandleTooltip />} />
                <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

const boxStyle = { minWidth: 280, flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14 }
