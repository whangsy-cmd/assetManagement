// 스윙매매 시뮬레이션 — 지그재그로 확정되는 저점/고점은 미리보기 참고용. 실제 매매 판단은 "직전 매매(매수든
// 매도든) 이후의 최고점/최저점" 기준: 그 최고점 대비 하락률 이상 떨어지면 매수(피라미딩), 그 최저점 대비
// 상승률 이상 오르면 매도(단계적 익절). 매매가 일어나면 그 체결가부터 최고점/최저점 추적이 다시 시작된다.
// 기준이 항상 그 시점까지의 실제 가격만 쓰므로 미래데이터 없이도 그대로 실거래에 옮길 수 있는 causal한 로직이다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { getSavedSymbols, getPriceSeries } from '../utils/priceData'
import { pc } from '../utils/format'
import { maxDrawdown } from '../utils/finance'
import InputField, { numInputStyle } from '../components/InputField'
import '../common.css'

// 온라인 지그재그: 시작점을 임시 저점으로 놓고 고점을 탐색, threshold% 이상 반전되면 피벗 확정 후 방향 전환.
// confirmIdx = 반전이 threshold를 넘어 실제로 확정된 날짜 인덱스(피벗 자체의 idx보다 항상 뒤) — 미리보기에서
// "그 시점까지 알 수 있었던, 오늘 막 확정된 피벗"을 causal하게 찾는 데 씀(미래데이터 참조 방지).
function computeZigzag(dates, prices, thresholdPct) {
  const th = thresholdPct / 100
  const pivots = [{ idx: 0, confirmIdx: 0, date: dates[0], price: prices[0], type: 'low' }]
  let dir = 1 // 1=고점 탐색중, -1=저점 탐색중
  let extIdx = 0, extPrice = prices[0]
  for (let i = 1; i < prices.length; i++) {
    const price = prices[i]
    if (dir === 1) {
      if (price > extPrice) { extPrice = price; extIdx = i }
      else if ((extPrice - price) / extPrice >= th) {
        pivots.push({ idx: extIdx, confirmIdx: i, date: dates[extIdx], price: extPrice, type: 'high' })
        dir = -1; extPrice = price; extIdx = i
      }
    } else {
      if (price < extPrice) { extPrice = price; extIdx = i }
      else if ((price - extPrice) / extPrice >= th) {
        pivots.push({ idx: extIdx, confirmIdx: i, date: dates[extIdx], price: extPrice, type: 'low' })
        dir = 1; extPrice = price; extIdx = i
      }
    }
  }
  return { pivots }
}

function swingAverages(pivots) {
  const rises = [], falls = []
  for (let i = 1; i < pivots.length; i++) {
    const prev = pivots[i - 1], cur = pivots[i]
    if (prev.type === 'low' && cur.type === 'high') rises.push(cur.price / prev.price - 1)
    else if (prev.type === 'high' && cur.type === 'low') falls.push(1 - cur.price / prev.price)
  }
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  return { avgRise: avg(rises), avgFall: avg(falls), riseCount: rises.length, fallCount: falls.length }
}

// 시작일에 초기 투자금의 initialBuyPct%를 매수. 이후 매일 직전 매매(매수든 매도든) 이후의 최고점/최저점을 갱신하며:
// 최고점 대비 avgFall% 이상 떨어지면 남은 현금의 tradePct% 추가매수(피라미딩), 최저점 대비 avgRise% 이상 오르면
// 보유수량의 tradePct% 추가매도(단계적 익절). 매매가 일어나면 그 체결가부터 최고점/최저점 추적을 다시 시작한다.
// maSellPeriod > 0이면, 종가가 그 이동평균선을 아래로 이탈하는 순간(어제는 이평선 이상, 오늘은 미만)
// 위 점진적 매매보다 우선해서 보유수량 전량을 매도하고, 다시 위로 복귀하는 순간(어제는 이평선 미만, 오늘은 이상)
// 남은 현금 전량을 매수한다 — 이평선은 매매 기준가가 아니라 이탈/복귀만 걸러내는 필터. 각각 그 순간에만 1회 발동.
// 이 이평선 매매는 highSinceTrade/lowSinceTrade/lastTradePrice(직전 매매 기준점)를 갱신하지 않는다 — 그리드 매매의
// 기준점은 오직 그리드 매매(피라미딩 매수/단계적 익절 매도) 자신만 옮긴다.
function runSimulation(dates, prices, avgRise, avgFall, tradePct, initialBuyPct, initialAmount, maSellPeriod) {
  let shares = 0, cash = initialAmount
  let highSinceTrade = null, lowSinceTrade = null
  let highDate = null, lowDate = null
  let lastTradePrice = null, lastTradeDate = null
  let maSum = 0
  const path = []
  let buyCount = 0, sellCount = 0

  for (let i = 0; i < dates.length; i++) {
    const price = prices[i]
    if (highSinceTrade != null) {
      if (price > highSinceTrade) { highSinceTrade = price; highDate = dates[i] }
      if (price < lowSinceTrade) { lowSinceTrade = price; lowDate = dates[i] }
    }
    // 오늘 트레이드 여부와 무관하게 "지금 기준 고점/저점/직전 매매가 대비 변동률"은 매일 계산해서 툴팁에 씀 —
    // 트레이드 리셋 전 값을 써야 매수/매도 당일 툴팁에 실제 트리거된 기준일/변동률이 찍힘.
    const fallFromHigh = highSinceTrade != null ? 1 - price / highSinceTrade : null
    const riseFromLow = lowSinceTrade != null ? price / lowSinceTrade - 1 : null
    const sinceTradePct = lastTradePrice != null ? price / lastTradePrice - 1 : null
    const dayChangePct = i > 0 ? price / prices[i - 1] - 1 : null
    const refHighDate = highDate, refLowDate = lowDate, refTradeDate = lastTradeDate
    let tradeType = null, maBreak = false

    // 이동평균(단순, maSellPeriod일) — 어제/오늘 값을 비교해 이탈 순간을 잡음
    let maToday = null
    if (maSellPeriod > 0) {
      maSum += price
      if (i >= maSellPeriod) maSum -= prices[i - maSellPeriod]
      if (i >= maSellPeriod - 1) maToday = maSum / maSellPeriod
    }
    const maYesterday = maSellPeriod > 0 && i >= maSellPeriod ? (maSum + prices[i - maSellPeriod] - price) / maSellPeriod : null
    const crossedBelowMa = maToday != null && maYesterday != null && prices[i - 1] >= maYesterday && price < maToday
    const crossedAboveMa = maToday != null && maYesterday != null && prices[i - 1] < maYesterday && price >= maToday

    if (i === 0) {
      const buyValue = cash * initialBuyPct / 100
      shares = buyValue / price
      cash -= buyValue
      highSinceTrade = price; lowSinceTrade = price; highDate = dates[i]; lowDate = dates[i]
      lastTradePrice = price; lastTradeDate = dates[i]
      if (buyValue > 0) { tradeType = 'buy'; buyCount++ }
    } else if (crossedBelowMa && shares > 0) {
      cash += shares * price
      shares = 0
      tradeType = 'sell'; maBreak = true; sellCount++
    } else if (crossedAboveMa && cash > 0) {
      shares += cash / price
      cash = 0
      tradeType = 'buy'; maBreak = true; buyCount++
    } else if (cash > 0 && avgFall > 0 && price <= highSinceTrade * (1 - avgFall)) {
      const buyValue = cash * tradePct / 100
      shares += buyValue / price
      cash -= buyValue
      highSinceTrade = price; lowSinceTrade = price; highDate = dates[i]; lowDate = dates[i]
      lastTradePrice = price; lastTradeDate = dates[i]
      tradeType = 'buy'; buyCount++
    } else if (shares > 0 && avgRise > 0 && price >= lowSinceTrade * (1 + avgRise)) {
      const sellValue = shares * price * tradePct / 100
      shares -= sellValue / price
      cash += sellValue
      highSinceTrade = price; lowSinceTrade = price; highDate = dates[i]; lowDate = dates[i]
      lastTradePrice = price; lastTradeDate = dates[i]
      tradeType = 'sell'; sellCount++
    }

    const total = shares * price + cash
    path.push({
      date: dates[i], price, total, weightPct: total > 0 ? (shares * price) / total * 100 : 0, tradeType, maBreak,
      fallFromHigh, riseFromLow, refHighDate, refLowDate, sinceTradePct, refTradeDate, dayChangePct,
    })
  }

  return { path, buyCount, sellCount }
}

const MA_COLORS = ['#f59e0b', '#a855f7', '#14b8a6', '#eab308', '#ec4899']

function TradeDot({ cx, cy, payload }) {
  if (!payload.tradeType) return null
  const buy = payload.tradeType === 'buy'
  return <circle cx={cx} cy={cy} r={payload.maBreak ? 6 : 4} fill={buy ? '#22c55e' : '#ef4444'} stroke={buy ? '#14532d' : '#7f1d1d'} strokeWidth={payload.maBreak ? 2 : 1} />
}

// 실선 원 = 저점/고점 그 지점(idx), 점선 테두리 원 = 그 저점/고점이 반전 임계값을 넘어 "확정"된 날(confirmIdx) — 항상 실선보다 뒤에 찍힘
function PivotDot({ cx, cy, payload }) {
  if (!payload.pivotType && !payload.confirmType) return null
  return (
    <g>
      {payload.confirmType && (
        <circle cx={cx} cy={cy} r={7} fill="none" stroke={payload.confirmType === 'high' ? '#ef4444' : '#22c55e'} strokeWidth={1.5} strokeDasharray="2 2" />
      )}
      {payload.pivotType && (
        <circle cx={cx} cy={cy} r={4} fill={payload.pivotType === 'high' ? '#ef4444' : '#22c55e'} stroke={payload.pivotType === 'high' ? '#7f1d1d' : '#14532d'} strokeWidth={1} />
      )}
    </g>
  )
}

// 차트 영역을 우클릭 드래그로 왼→오하면 그 구간으로 확대, 오→왼으로 하면 전체로 축소. 좌클릭 드래그는 좌우 스크롤.
function useDragZoom(fullData) {
  const [zoomRange, setZoomRange] = useState(null) // [fromDate, toDate] or null(전체)
  const [dragStart, setDragStart] = useState(null)
  const [dragEnd, setDragEnd] = useState(null)

  const reset = () => { setZoomRange(null); setDragStart(null); setDragEnd(null) }
  const onMouseDown = (state, e) => {
    if (e.button !== 2) return
    e.preventDefault()
    if (state.activeLabel) { setDragStart(state.activeLabel); setDragEnd(state.activeLabel) }
  }
  const onMouseMove = (state) => { if (dragStart && state.activeLabel) setDragEnd(state.activeLabel) }
  const onMouseUp = () => {
    if (dragStart && dragEnd && dragStart !== dragEnd) {
      setZoomRange(dragStart < dragEnd ? [dragStart, dragEnd] : null)
    }
    setDragStart(null); setDragEnd(null)
  }
  const onContextMenu = (state, e) => e.preventDefault()

  const data = zoomRange ? fullData.filter(d => d.date >= zoomRange[0] && d.date <= zoomRange[1]) : fullData
  // 확대 배율 = 전체 데이터 수 / 확대된 구간 데이터 수 — 좁게 선택할수록(더 확대) 배율이 커짐
  const zoomRatio = zoomRange && data.length > 0 ? fullData.length / data.length : 1
  return { data, zoomRange, zoomRatio, dragStart, dragEnd, onMouseDown, onMouseMove, onMouseUp, onContextMenu, reset }
}

// 좌클릭 드래그로 스크롤 컨테이너를 좌우로 팬.
function usePanScroll() {
  const ref = useRef(null)
  const dragRef = useRef(null)
  const onMouseDown = (e) => {
    if (e.button !== 0 || !ref.current) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startScroll: ref.current.scrollLeft }
    const onMove = (ev) => {
      if (!dragRef.current || !ref.current) return
      ref.current.scrollLeft = dragRef.current.startScroll - (ev.clientX - dragRef.current.startX)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return { ref, onMouseDown }
}

function ResultTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const point = payload[0]?.payload
  return (
    <div style={{ background: '#1e293b', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', margin: '2px 0' }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>{p.name}: {p.value.toFixed(3)}x</p>
      ))}
      {point?.dayChangePct != null && (
        <p style={{ color: point.dayChangePct >= 0 ? '#22c55e' : '#ef4444', margin: '2px 0' }}>
          당일 등락률: {point.dayChangePct >= 0 ? '+' : ''}{(point.dayChangePct * 100).toFixed(1)}%
        </p>
      )}
      {point?.tradeType === 'buy' && point.maBreak && (
        <p style={{ color: '#22c55e', margin: '2px 0', fontWeight: 700 }}>
          전량매수 — 이동평균선 복귀
        </p>
      )}
      {point?.tradeType === 'buy' && !point.maBreak && point.fallFromHigh != null && (
        <p style={{ color: '#22c55e', margin: '2px 0', fontWeight: 700 }}>
          매수 체결 — 직전 고점({point.refHighDate}) 대비 {(point.fallFromHigh * 100).toFixed(1)}% 하락
        </p>
      )}
      {point?.tradeType === 'sell' && point.maBreak && (
        <p style={{ color: '#ef4444', margin: '2px 0', fontWeight: 700 }}>
          전량매도 — 이동평균선 이탈
        </p>
      )}
      {point?.tradeType === 'sell' && !point.maBreak && point.riseFromLow != null && (
        <p style={{ color: '#ef4444', margin: '2px 0', fontWeight: 700 }}>
          매도 체결 — 직전 저점({point.refLowDate}) 대비 {(point.riseFromLow * 100).toFixed(1)}% 상승
        </p>
      )}
      {!point?.tradeType && point?.fallFromHigh != null && (
        <p style={{ color: '#94a3b8', margin: '2px 0' }}>
          직전 고점({point.refHighDate}) 대비 {(point.fallFromHigh * 100).toFixed(1)}% 하락 / 직전 저점({point.refLowDate}) 대비 {(point.riseFromLow * 100).toFixed(1)}% 상승
        </p>
      )}
      {point?.sinceTradePct != null && (
        <p style={{ color: '#94a3b8', margin: '2px 0' }}>
          직전 매매({point.refTradeDate}) 대비 {Math.abs(point.sinceTradePct * 100).toFixed(1)}% {point.sinceTradePct >= 0 ? '상승' : '하락'}
        </p>
      )}
    </div>
  )
}

export default function SwingPyramidSimulation() {
  const { user } = useAuth()
  const [savedSymbols, setSavedSymbols] = useState([])

  useEffect(() => {
    if (!user) return
    getSavedSymbols(user.uid).then(setSavedSymbols)
  }, [user])

  if (!user) return null

  return <SimTab user={user} savedSymbols={savedSymbols} />
}

function SimTab({ user, savedSymbols }) {
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [thresholdPct, setThresholdPct] = useState(30)
  const [tradePct, setTradePct] = useState(30)
  const [initialBuyPct, setInitialBuyPct] = useState(100)
  const initialAmount = 100000000
  const [avgRisePct, setAvgRisePct] = useState(0)
  const [avgFallPct, setAvgFallPct] = useState(0)
  const [maPeriods, setMaPeriods] = useState([])
  const [maInput, setMaInput] = useState(20)
  const [maSellPeriod, setMaSellPeriod] = useState(0)

  const [rawSeries, setRawSeries] = useState(null)
  const [previewError, setPreviewError] = useState('')

  const symbol = savedSymbols.find(s => s.code === selectedCode)

  useEffect(() => {
    if (symbol) { setDateFrom(symbol.minDate); setDateTo(symbol.maxDate) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode])

  // 종목 선택 시 가격 데이터를 미리 받아와 저점/고점 미리보기를 자동 표시 (시뮬레이션 실행 버튼과 무관)
  useEffect(() => {
    if (!selectedCode) { setRawSeries(null); setPreviewError(''); return }
    setPreviewError('')
    getPriceSeries(user.uid, selectedCode).then(s => {
      if (!s) { setPreviewError(`${selectedCode}: 저장된 가격 데이터가 없습니다.`); setRawSeries(null) }
      else setRawSeries(s)
    })
  }, [user.uid, selectedCode])

  const preview = useMemo(() => {
    if (!rawSeries || !dateFrom || !dateTo) return null
    const dates = Object.keys(rawSeries.prices).filter(d => d >= dateFrom && d <= dateTo).sort()
    if (dates.length < 5) return null
    const prices = dates.map(d => rawSeries.prices[d])
    const { pivots } = computeZigzag(dates, prices, thresholdPct)
    const { avgRise, avgFall, riseCount, fallCount } = swingAverages(pivots)
    const pivotByIdx = new Map(pivots.slice(1).map(p => [p.idx, p.type]))
    const confirmByIdx = new Map(pivots.slice(1).map(p => [p.confirmIdx, p.type]))
    const chartData = dates.map((d, i) => ({ date: d, 종가: prices[i], pivotType: pivotByIdx.get(i) || null, confirmType: confirmByIdx.get(i) || null }))
    for (const period of maPeriods) {
      const key = `MA${period}`
      let sum = 0
      for (let i = 0; i < prices.length; i++) {
        sum += prices[i]
        if (i >= period) sum -= prices[i - period]
        if (i >= period - 1) chartData[i][key] = sum / period
      }
    }

    return { chartData, avgRise, avgFall, riseCount, fallCount }
  }, [rawSeries, dateFrom, dateTo, thresholdPct, maPeriods])

  const result = useMemo(() => {
    if (!rawSeries || !dateFrom || !dateTo) return null
    const dates = Object.keys(rawSeries.prices).filter(d => d >= dateFrom && d <= dateTo).sort()
    if (dates.length < 5) return { error: '시뮬레이션 가능한 거래일이 부족합니다. 기간을 확인하세요.' }
    const prices = dates.map(d => rawSeries.prices[d])

    const { pivots } = computeZigzag(dates, prices, thresholdPct)
    const { riseCount, fallCount } = swingAverages(pivots)
    if (riseCount === 0 || fallCount === 0) return { error: '선택한 기간/임계값으로는 스윙(저점↔고점)이 충분히 나오지 않습니다. 임계값을 낮추거나 기간을 늘려보세요.' }

    const avgRise = avgRisePct / 100
    const avgFall = avgFallPct / 100

    const { path, buyCount, sellCount } = runSimulation(dates, prices, avgRise, avgFall, tradePct, initialBuyPct, initialAmount, maSellPeriod)

    const stratSeries = path.map(p => p.total / initialAmount)
    const holdSeries = prices.map(p => p / prices[0])
    const days = (new Date(dates.at(-1)) - new Date(dates[0])) / 86400000
    const years = days / 365

    // 매매기준 이평선(maSellPeriod) — 매수후보유와 같은 배수 스케일로 표시
    let maSum = 0
    const maLine = maSellPeriod > 0 ? prices.map((p, i) => {
      maSum += p
      if (i >= maSellPeriod) maSum -= prices[i - maSellPeriod]
      return i >= maSellPeriod - 1 ? maSum / maSellPeriod / prices[0] : null
    }) : null

    return {
      chartData: path.map((p, i) => ({
        date: p.date, 전략: stratSeries[i], '매수후보유': holdSeries[i], 이평선: maLine ? maLine[i] : null, tradeType: p.tradeType, maBreak: p.maBreak,
        fallFromHigh: p.fallFromHigh, riseFromLow: p.riseFromLow, refHighDate: p.refHighDate, refLowDate: p.refLowDate,
        sinceTradePct: p.sinceTradePct, refTradeDate: p.refTradeDate, dayChangePct: p.dayChangePct,
      })),
      stratFinal: stratSeries.at(-1),
      holdFinal: holdSeries.at(-1),
      stratCAGR: years > 0 ? Math.pow(stratSeries.at(-1), 1 / years) - 1 : 0,
      holdCAGR: years > 0 ? Math.pow(holdSeries.at(-1), 1 / years) - 1 : 0,
      stratMDD: maxDrawdown(stratSeries),
      holdMDD: maxDrawdown(holdSeries),
      buyCount, sellCount,
      avgRise, avgFall, riseCount, fallCount,
      fromDate: dates[0], toDate: dates.at(-1), days: dates.length,
    }
  }, [rawSeries, dateFrom, dateTo, thresholdPct, avgRisePct, avgFallPct, tradePct, initialBuyPct, initialAmount, maSellPeriod])

  const previewZoom = useDragZoom(preview?.chartData || [])
  const resultZoom = useDragZoom(result?.chartData || [])
  const previewPan = usePanScroll()
  const resultPan = usePanScroll()

  // 확대/축소로 데이터가 바뀌면 그 구간의 시작점(맨 앞)이 보이도록 스크롤 위치를 리셋 —
  // 안 하면 이전 팬 위치가 새 확대 배율에서 엉뚱한 지점을 가리키게 됨
  useEffect(() => {
    if (previewPan.ref.current) previewPan.ref.current.scrollLeft = 0
  }, [previewZoom.zoomRange, previewPan.ref])
  useEffect(() => {
    if (resultPan.ref.current) resultPan.ref.current.scrollLeft = 0
  }, [resultZoom.zoomRange, resultPan.ref])

  useEffect(() => {
    previewZoom.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode, dateFrom, dateTo, thresholdPct])

  useEffect(() => {
    resultZoom.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // 종목/기간/임계값이 바뀌어 평균이 새로 계산되면 입력값도 그 값으로 다시 채움 — 이후 수동으로 고쳐서 쓸 수 있음
  useEffect(() => {
    if (preview) { setAvgRisePct(+(preview.avgRise * 100).toFixed(2)); setAvgFallPct(+(preview.avgFall * 100).toFixed(2)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.avgRise, preview?.avgFall])

  const handlePick = (code, name) => {
    setSelectedCode(code); setSelectedName(name)
  }

  const addMa = () => {
    if (maInput > 0 && !maPeriods.includes(maInput)) setMaPeriods([...maPeriods, maInput].sort((a, b) => a - b))
  }
  const removeMa = (period) => setMaPeriods(maPeriods.filter(p => p !== period))

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>종목 선택</div>
        {savedSymbols.length === 0 ? (
          <p className="dim">저장된 종목이 없습니다. 시뮬레이션 &gt; 종목관리 탭에서 먼저 가격 데이터를 받아오세요.</p>
        ) : (
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr><th>코드</th><th>이름</th><th>시장</th><th className="r">구간</th><th className="r">건수</th></tr>
              </thead>
              <tbody>
                {savedSymbols.map(s => (
                  <tr key={s.code} onClick={() => handlePick(s.code, s.name)}
                    style={{ cursor: 'pointer', background: s.code === selectedCode ? '#1d4ed8' : undefined }}>
                    <td>{s.code}</td>
                    <td>{s.name}</td>
                    <td className="dim">{s.market}</td>
                    <td className="r dim">{s.minDate} ~ {s.maxDate}</td>
                    <td className="r">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {symbol && <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>선택: {symbol.code} — {symbol.name} (보유 구간 {symbol.minDate} ~ {symbol.maxDate})</p>}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>시뮬레이션 설정</div>
        <div className="form-row" style={{ gap: 20, alignItems: 'flex-end' }}>
          <InputField label="시작일">
            <input type="date" value={dateFrom} min={symbol?.minDate} max={symbol?.maxDate} onChange={e => setDateFrom(e.target.value)} style={numInputStyle} />
          </InputField>
          <InputField label="종료일">
            <input type="date" value={dateTo} min={symbol?.minDate} max={symbol?.maxDate} onChange={e => setDateTo(e.target.value)} style={numInputStyle} />
          </InputField>
          <InputField label="최초 매수비중(%)">
            <input type="number" value={initialBuyPct} onChange={e => setInitialBuyPct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="지그재그 임계값(%)">
            <input type="number" step="0.5" value={thresholdPct} onChange={e => setThresholdPct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="회당 매매비율(%)">
            <input type="number" value={tradePct} onChange={e => setTradePct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="상승률(%)">
            <input type="number" step="0.1" value={avgRisePct} onChange={e => setAvgRisePct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="하락률(%)">
            <input type="number" step="0.1" value={avgFallPct} onChange={e => setAvgFallPct(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="이탈/복귀 이평선(일, 0=미사용)">
            <input type="number" min="0" value={maSellPeriod} onChange={e => setMaSellPeriod(Number(e.target.value))} style={numInputStyle} />
          </InputField>
        </div>
      </div>

      {previewError && <p className="text-error" style={{ marginBottom: 12 }}>{previewError}</p>}

      {preview && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-header">
            <h3 className="section-title">저점/고점 미리보기</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="dim" style={{ fontSize: 12 }}>이동평균선:</span>
              {maPeriods.map((p, i) => (
                <span key={p} className="toggle-btn active" style={{ background: MA_COLORS[i % MA_COLORS.length], borderColor: MA_COLORS[i % MA_COLORS.length], display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 12px' }}>
                  {p}일
                  <button onClick={() => removeMa(p)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
              <input type="number" min="2" value={maInput} onChange={e => setMaInput(Number(e.target.value))} style={{ ...numInputStyle, width: 60 }} />
              <button className="toggle-btn" onClick={addMa}>+ 추가</button>
            </div>
          </div>

          <div style={{ display: 'flex' }}>
            <div style={{ flexShrink: 0 }}>
              <ResponsiveContainer width={65} height={260}>
                <LineChart data={previewZoom.data} margin={{ top: 5, right: 0, left: 10, bottom: 29 }}>
                  <YAxis domain={['auto', 'auto']} padding={{ top: 10, bottom: 10 }} tick={{ fill: '#64748b', fontSize: 11 }} width={55} allowDataOverflow />
                  <Line type="monotone" dataKey="종가" stroke="transparent" dot={false} isAnimationActive={false} />
                  {maPeriods.map(p => (
                    <Line key={p} type="monotone" dataKey={`MA${p}`} stroke="transparent" dot={false} isAnimationActive={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div ref={previewPan.ref} onMouseDown={previewPan.onMouseDown} style={{ overflowX: 'auto', flex: 1, cursor: 'grab' }}>
              <div style={{ width: previewZoom.zoomRange ? `${previewZoom.zoomRatio * 100}%` : '100%' }}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={previewZoom.data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    onMouseDown={previewZoom.onMouseDown} onMouseMove={previewZoom.onMouseMove} onMouseUp={previewZoom.onMouseUp} onContextMenu={previewZoom.onContextMenu}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" height={24} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(0, 7)} allowDataOverflow />
                    <YAxis domain={['auto', 'auto']} padding={{ top: 10, bottom: 10 }} hide allowDataOverflow />
                    <Tooltip contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="종가" stroke="#3b82f6" strokeWidth={1.2} dot={<PivotDot />} isAnimationActive={false} />
                    {maPeriods.map((p, i) => (
                      <Line key={p} type="monotone" dataKey={`MA${p}`} name={`${p}일 이평선`} stroke={MA_COLORS[i % MA_COLORS.length]} strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                    {previewZoom.dragStart && previewZoom.dragEnd && previewZoom.dragStart !== previewZoom.dragEnd && (
                      <ReferenceArea x1={previewZoom.dragStart} x2={previewZoom.dragEnd} strokeOpacity={0.3} fill="#3b82f6" fillOpacity={0.15} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            <span style={{ color: '#22c55e' }}>● 초록</span> = 저점, <span style={{ color: '#ef4444' }}>● 빨강</span> = 고점 (실선 원),
            <span style={{ color: '#94a3b8' }}> ○ 점선 원</span> = 그 저점/고점이 확정된 날(항상 실선보다 뒤) —
            차트를 우클릭 드래그로 왼쪽→오른쪽하면 그 구간 확대, 오른쪽→왼쪽하면 전체로 축소 — 좌클릭 드래그는 좌우 스크롤
          </p>
        </div>
      )}

      {result?.error && <p className="text-error" style={{ marginBottom: 12 }}>{result.error}</p>}

      {result && !result.error && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">결과 — {result.fromDate} ~ {result.toDate} ({result.days}거래일)</h3>
          </div>
          <div className="summary-bar" style={{ marginBottom: 12 }}>
            <div className="summary-item">
              <span className="summary-label">전략 최종배수</span>
              <span className={`summary-item-val ${pc(result.stratFinal - 1)}`}>{result.stratFinal.toFixed(2)}x</span>
              <span className="summary-sub">CAGR {(result.stratCAGR * 100).toFixed(1)}% / MDD {(result.stratMDD * 100).toFixed(1)}%</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">매수후보유 최종배수</span>
              <span className={`summary-item-val ${pc(result.holdFinal - 1)}`}>{result.holdFinal.toFixed(2)}x</span>
              <span className="summary-sub">CAGR {(result.holdCAGR * 100).toFixed(1)}% / MDD {(result.holdMDD * 100).toFixed(1)}%</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">매수 / 매도 체결</span>
              <span className="summary-item-val">{result.buyCount}회 / {result.sellCount}회</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">스윙 평균 상승률 / 하락률</span>
              <span className="summary-item-val">{(result.avgRise * 100).toFixed(1)}% / {(result.avgFall * 100).toFixed(1)}%</span>
              <span className="summary-sub">스윙 {result.riseCount + result.fallCount}개 (상승구간 {result.riseCount} / 하락구간 {result.fallCount})</span>
            </div>
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: '#94a3b8' }}>━ 매수후보유</span> &nbsp; <span style={{ color: '#3b82f6' }}>━ 전략</span>
            {maSellPeriod > 0 && <> &nbsp; <span style={{ color: '#f59e0b' }}>┅ {maSellPeriod}일 이평선(매매기준)</span></>}
          </div>
          <div style={{ display: 'flex' }}>
            <div style={{ flexShrink: 0 }}>
              <ResponsiveContainer width={55} height={300}>
                <LineChart data={resultZoom.data} margin={{ top: 5, right: 0, left: 10, bottom: 29 }}>
                  <YAxis scale="log" domain={['auto', 'auto']} padding={{ top: 10, bottom: 10 }} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v.toFixed(1) + 'x'} width={45} allowDataOverflow />
                  <Line type="monotone" dataKey="매수후보유" stroke="transparent" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="전략" stroke="transparent" dot={false} isAnimationActive={false} />
                  {maSellPeriod > 0 && <Line type="monotone" dataKey="이평선" stroke="transparent" dot={false} isAnimationActive={false} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div ref={resultPan.ref} onMouseDown={resultPan.onMouseDown} style={{ overflowX: 'auto', flex: 1, cursor: 'grab' }}>
              <div style={{ width: resultZoom.zoomRange ? `${resultZoom.zoomRatio * 100}%` : '100%' }}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={resultZoom.data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    onMouseDown={resultZoom.onMouseDown} onMouseMove={resultZoom.onMouseMove} onMouseUp={resultZoom.onMouseUp} onContextMenu={resultZoom.onContextMenu}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" height={24} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(0, 7)} allowDataOverflow />
                    <YAxis scale="log" domain={['auto', 'auto']} padding={{ top: 10, bottom: 10 }} hide allowDataOverflow />
                    <Tooltip content={<ResultTooltip />} />
                    <Line type="monotone" dataKey="매수후보유" stroke="#94a3b8" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                    {maSellPeriod > 0 && <Line type="monotone" dataKey="이평선" name={`${maSellPeriod}일 이평선`} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls />}
                    <Line type="monotone" dataKey="전략" stroke="#3b82f6" strokeWidth={2} dot={<TradeDot />} isAnimationActive={false} />
                    {resultZoom.dragStart && resultZoom.dragEnd && resultZoom.dragStart !== resultZoom.dragEnd && (
                      <ReferenceArea x1={resultZoom.dragStart} x2={resultZoom.dragEnd} strokeOpacity={0.3} fill="#3b82f6" fillOpacity={0.15} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            <span style={{ color: '#22c55e' }}>● 초록</span> = 매수(피라미딩), <span style={{ color: '#ef4444' }}>● 빨강</span> = 매도(단계적 익절) —
            차트를 우클릭 드래그로 왼쪽→오른쪽하면 그 구간 확대, 오른쪽→왼쪽하면 전체로 축소 — 좌클릭 드래그는 좌우 스크롤
          </p>
        </div>
      )}
    </div>
  )
}
