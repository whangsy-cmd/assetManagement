import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { getLatestHoldings, getLatestCash, getAccounts, getSnapshots, getSectors, getRebalanceSettings } from '../utils/firestore'
import '../common.css'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#84cc16']
const CAT_LABEL = { pension: '연금', domestic: '국내', overseas: '해외' }

function fmt(n) {
  if (!n && n !== 0) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return n.toLocaleString()
}

function fmtWon(n) {
  if (!n && n !== 0) return '-'
  return Math.round(n).toLocaleString()
}

function sgn(v) { return v >= 0 ? '+' : '' }
function pc(v)  { return v >= 0 ? 'pos' : 'neg' }

function NetWorthTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const nameMap = { pension: '연금', domestic: '국내', overseas: '해외', loan: '대출' }
  const net = payload.reduce((sum, p) => sum + (p.value || 0), 0)
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>
      {payload.map(p => {
        const isLoan = p.dataKey === 'loan'
        const display = isLoan ? `-${Math.abs(p.value).toLocaleString()}` : p.value.toLocaleString()
        return (
          <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>
            {nameMap[p.dataKey]}: {display}원
          </p>
        )
      })}
      <p style={{ color: '#f1f5f9', borderTop: '1px solid #334155', marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
        순자산: {net.toLocaleString()}원
      </p>
    </div>
  )
}

function makePieLabel(denom) {
  return function({ cx, cy, midAngle, innerRadius, outerRadius, value }) {
    const pct = value / denom
    if (pct < 0.04) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.6
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {(pct * 100).toFixed(1)}%
      </text>
    )
  }
}

function computeAggregates(snapshots, mode) {
  const groups = {}
  for (const s of snapshots) {
    const key = mode === 'year' ? s.date.slice(0, 4) : s.date.slice(0, 7)
    groups[key] = s
  }
  const keys = Object.keys(groups).sort()
  // i=0 기준점: 데이터셋 최초 스냅샷 → 모든 기간 합산 = latest - first (텔레스코핑 보장)
  const absFirst = snapshots[0]

  return keys.map((key, i) => {
    const curr = groups[key]
    const base = i > 0 ? groups[keys[i - 1]] : absFirst
    const baseBal    = base.totalBalance ?? 0
    const overseasChg = (curr.overseas?.balance ?? 0) - (base.overseas?.balance ?? 0)
    const domesticChg = (curr.domestic?.balance ?? 0) - (base.domestic?.balance ?? 0)
    const pensionChg  = (curr.pension?.balance  ?? 0) - (base.pension?.balance  ?? 0)
    const totalChg    = (curr.totalBalance ?? 0) - baseBal
    const rate        = baseBal > 0 ? totalChg / baseBal * 100 : null
    return {
      period: key,
      overseasBal: curr.overseas?.balance ?? 0, overseasChg,
      domesticBal: curr.domestic?.balance ?? 0, domesticChg,
      pensionBal:  curr.pension?.balance  ?? 0, pensionChg,
      totalBal:    curr.totalBalance ?? 0,       totalChg,
      rate,
    }
  }).reverse()
}

function AggregateTable({ rows }) {
  const totals = rows.reduce(
    (acc, r) => ({
      overseasChg: acc.overseasChg + r.overseasChg,
      domesticChg: acc.domesticChg + r.domesticChg,
      pensionChg:  acc.pensionChg  + r.pensionChg,
      totalChg:    acc.totalChg    + r.totalChg,
    }),
    { overseasChg: 0, domesticChg: 0, pensionChg: 0, totalChg: 0 }
  )

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th rowSpan={2}>기간</th>
            <th className="th-group sep" colSpan={2}>해외</th>
            <th className="th-group sep" colSpan={2}>국내</th>
            <th className="th-group sep" colSpan={2}>연금</th>
            <th className="th-group sep" colSpan={2}>합계</th>
            <th className="r sep" rowSpan={2}>수익률</th>
          </tr>
          <tr>
            <th className="r sep">잔액</th><th className="r">수익</th>
            <th className="r sep">잔액</th><th className="r">수익</th>
            <th className="r sep">잔액</th><th className="r">수익</th>
            <th className="r sep">잔액</th><th className="r">수익</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.period}</td>
              <td className="r sep-dim">{fmt(r.overseasBal)}</td>
              <td className={`r ${pc(r.overseasChg)}`}>{sgn(r.overseasChg)}{fmt(r.overseasChg)}</td>
              <td className="r sep-dim">{fmt(r.domesticBal)}</td>
              <td className={`r ${pc(r.domesticChg)}`}>{sgn(r.domesticChg)}{fmt(r.domesticChg)}</td>
              <td className="r sep-dim">{fmt(r.pensionBal)}</td>
              <td className={`r ${pc(r.pensionChg)}`}>{sgn(r.pensionChg)}{fmt(r.pensionChg)}</td>
              <td className="r bold sep-dim">{fmt(r.totalBal)}</td>
              <td className={`r bold ${pc(r.totalChg)}`}>{sgn(r.totalChg)}{fmt(r.totalChg)}</td>
              <td className={`r sep-dim ${r.rate !== null ? pc(r.rate) : 'muted'}`}>
                {r.rate !== null ? `${sgn(r.rate)}${r.rate.toFixed(2)}%` : '-'}
              </td>
            </tr>
          ))}
          <tr className="total-row">
            <td className="bold dim">수익합계</td>
            <td className="sep-dim" /><td className={`r bold ${pc(totals.overseasChg)}`}>{sgn(totals.overseasChg)}{fmt(totals.overseasChg)}</td>
            <td className="sep-dim" /><td className={`r bold ${pc(totals.domesticChg)}`}>{sgn(totals.domesticChg)}{fmt(totals.domesticChg)}</td>
            <td className="sep-dim" /><td className={`r bold ${pc(totals.pensionChg)}`}>{sgn(totals.pensionChg)}{fmt(totals.pensionChg)}</td>
            <td className="sep-dim" /><td className={`r bold ${pc(totals.totalChg)}`}>{sgn(totals.totalChg)}{fmt(totals.totalChg)}</td>
            <td className="sep-dim" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [holdings, setHoldings] = useState([])
  const [cash, setCash] = useState([])
  const [accounts, setAccounts] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [sectors, setSectors] = useState([])
  const [rebalanceSettings, setRebalanceSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [aggMode, setAggMode] = useState('month')

  useEffect(() => {
    if (!user) return
    Promise.all([
      getLatestHoldings(user.uid),
      getLatestCash(user.uid),
      getAccounts(user.uid),
      getSnapshots(user.uid, 260),
      getSectors(user.uid),
      getRebalanceSettings(user.uid),
    ]).then(([h, c, acc, s, sec, st]) => {
      setHoldings(h); setCash(c); setAccounts(acc); setSnapshots(s); setSectors(sec)
      setRebalanceSettings(st || {})
      setLoading(false)
    })
  }, [user])

  if (loading) return <div className="loading">로딩 중...</div>
  if (!snapshots.length) return (
    <div className="empty">
      <p>아직 데이터가 없습니다.</p>
      <p style={{ color: '#64748b', fontSize: 14 }}>데이터 입력 메뉴에서 HTS 데이터를 붙여넣기 하세요.</p>
    </div>
  )

  const latest    = snapshots.at(-1)
  const weekChange     = latest.totalChange ?? 0
  const weekChangeRate = latest.totalChangeRate ?? 0
  const pension  = latest.pension?.balance  || 0
  const domestic = latest.domestic?.balance || 0
  const overseas = latest.overseas?.balance || 0

  // 섹터별 집계
  const sectorMap = Object.fromEntries(sectors.map(s => [s.code, s.sector || '미분류']))
  const sectorAgg = {}
  for (const h of holdings) {
    const sec = sectorMap[h.code] || '미분류'
    sectorAgg[sec] = (sectorAgg[sec] || 0) + (h.evalAmt || 0)
  }
  const sectorStockTotal = Object.values(sectorAgg).reduce((a, b) => a + b, 0)
  const cashInSector = (domestic + overseas + pension) - sectorStockTotal
  if (cashInSector > 0) sectorAgg['예수금'] = (sectorAgg['예수금'] || 0) + cashInSector
  const netDenom  = latest.netBalance || sectorStockTotal || 1
  const sectorData = Object.entries(sectorAgg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const categoryData = [
    { name: '국내', value: domestic },
    { name: '해외', value: overseas },
    { name: '연금', value: pension },
    ...(latest.totalLoan > 0 ? [{ name: '대출금', value: latest.totalLoan }] : []),
  ].filter(d => d.value > 0).sort((a, b) => b.value - a.value)

  // 셰넌 리밸런싱 요약 (연금/연금외 독립 — 리밸런싱 페이지에서 저장한 기준 사용, 없으면 기본값). 대출 미반영, 현재 예수금 그대로 계산.
  const accCatMap  = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
  const isPensionAcc = (id) => accCatMap[id] === 'pension'
  function shannonSummary(isPool, poolKey) {
    const poolHoldings = holdings.filter(h => isPool(h.accountId))
    const poolSectorAgg = {}
    for (const h of poolHoldings) {
      const sec = sectorMap[h.code] || '미분류'
      poolSectorAgg[sec] = (poolSectorAgg[sec] || 0) + (h.evalAmt || 0)
    }
    const stockAmt = Object.values(poolSectorAgg).reduce((a, b) => a + b, 0)
    const cashAmt = cash.filter(c => isPool(c.accountId)).reduce((s, c) => s + (c.amount || 0), 0)
    poolSectorAgg['예수금'] = (poolSectorAgg['예수금'] || 0) + cashAmt
    const total = stockAmt + cashAmt || 1

    const cfg = rebalanceSettings.shannon?.[poolKey] || {}
    const safeRatio = cfg.safeRatio ?? 30
    const band = cfg.band ?? 10
    const safeSectors = cfg.safeSectors ?? ['예수금']
    const safeAssetAmt = safeSectors.reduce((s, n) => s + (poolSectorAgg[n] || 0), 0)
    const riskyAssetAmt = total - safeAssetAmt
    const targetSafeAmt = safeRatio / 100 * total
    const targetRiskyAmt = total - targetSafeAmt
    const currentSafePct = safeAssetAmt / total * 100
    const needsRebalance = Math.abs(currentSafePct - safeRatio) > band
    const riskyRebalanceAmt = needsRebalance ? targetRiskyAmt - riskyAssetAmt : 0

    return { total, safeRatio, band, safeAssetAmt, riskyAssetAmt, needsRebalance, riskyRebalanceAmt }
  }
  const shannonPools = [
    { label: '연금', ...shannonSummary(isPensionAcc, 'pension') },
    { label: '연금외', ...shannonSummary(id => !isPensionAcc(id), 'other') },
  ]

  // 계좌별 집계
  const accNameMap = Object.fromEntries(accounts.map(a => [a.accountId, a.name || a.accountId]))
  const accMap = {}
  for (const h of holdings) {
    const id = h.accountId
    if (!accMap[id]) accMap[id] = { accountId: id, category: accCatMap[id] || 'domestic', purchaseAmt: 0, evalAmt: 0, gainLoss: 0, cashAmt: 0 }
    accMap[id].purchaseAmt += h.purchaseAmt || 0
    accMap[id].evalAmt    += h.evalAmt    || 0
    accMap[id].gainLoss   += h.gainLoss   || 0
  }
  for (const c of cash) {
    const id = c.accountId
    if (!accMap[id]) accMap[id] = { accountId: id, category: accCatMap[id] || 'domestic', purchaseAmt: 0, evalAmt: 0, gainLoss: 0, cashAmt: 0 }
    accMap[id].cashAmt += c.amount || 0
  }
  const accountRows = Object.values(accMap)
    .map(r => ({ ...r, totalAmt: r.evalAmt + r.cashAmt, returnRate: r.purchaseAmt > 0 ? (r.gainLoss / r.purchaseAmt) * 100 : 0 }))
    .sort((a, b) => b.totalAmt - a.totalAmt)
  const accTotals = accountRows.reduce(
    (acc, r) => ({ purchaseAmt: acc.purchaseAmt + r.purchaseAmt, evalAmt: acc.evalAmt + r.evalAmt, gainLoss: acc.gainLoss + r.gainLoss, cashAmt: acc.cashAmt + r.cashAmt, totalAmt: acc.totalAmt + r.totalAmt }),
    { purchaseAmt: 0, evalAmt: 0, gainLoss: 0, cashAmt: 0, totalAmt: 0 }
  )

  // 누적 수익
  const first = snapshots[0]
  const cumulativeGain = (latest.totalBalance ?? 0) - (first.totalBalance ?? 0)
  const cumulativeRate = (first.totalBalance ?? 0) > 0 ? (cumulativeGain / first.totalBalance) * 100 : 0
  const months = Math.max(1,
    (new Date(latest.date).getFullYear() - new Date(first.date).getFullYear()) * 12 +
    (new Date(latest.date).getMonth()    - new Date(first.date).getMonth())
  )
  const monthlyAvgRate = cumulativeRate / months

  // 종목별 비중 (코드별 합산 → 섹터별 그룹)
  const totalBal = (overseas + domestic + pension) || 1
  const codeAgg = {}
  for (const h of holdings) {
    if (!codeAgg[h.code]) codeAgg[h.code] = { code: h.code, name: h.name || h.code, evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    codeAgg[h.code].evalAmt     += h.evalAmt     || 0
    codeAgg[h.code].purchaseAmt += h.purchaseAmt || 0
    codeAgg[h.code].gainLoss    += h.gainLoss    || 0
  }
  const sectorGroupMap = {}
  for (const item of Object.values(codeAgg)) {
    const sec = sectorMap[item.code] || '미분류'
    if (!sectorGroupMap[sec]) sectorGroupMap[sec] = { sector: sec, items: [], evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    sectorGroupMap[sec].items.push(item)
    sectorGroupMap[sec].evalAmt     += item.evalAmt
    sectorGroupMap[sec].purchaseAmt += item.purchaseAmt
    sectorGroupMap[sec].gainLoss    += item.gainLoss
  }
  const sectorGroups = Object.values(sectorGroupMap)
    .map(g => ({ ...g, items: g.items.sort((a, b) => b.evalAmt - a.evalAmt) }))
    .sort((a, b) => b.evalAmt - a.evalAmt)
  const holdingsEvalTotal     = sectorGroups.reduce((s, g) => s + g.evalAmt, 0)
  const holdingsGainTotal     = sectorGroups.reduce((s, g) => s + g.gainLoss, 0)
  const holdingsPurchaseTotal = sectorGroups.reduce((s, g) => s + g.purchaseAmt, 0)
  const holdingCount          = Object.keys(codeAgg).length

  const aggData   = computeAggregates(snapshots, aggMode)
  const chartData = snapshots.map(s => ({
    date:     s.date,
    domestic: s.domestic?.balance ?? 0,
    overseas: s.overseas?.balance ?? 0,
    pension:  s.pension?.balance  ?? 0,
    loan:     -(s.totalLoan ?? 0),
  }))
  const chartMin = Math.min(0, ...chartData.map(d => d.loan)) - 1e8
  const chartMax = Math.max(0, ...chartData.map(d => d.pension + d.domestic + d.overseas)) + 1e8
  const TICK_STEP = 5e8
  const yTicks = []
  for (let t = Math.floor(chartMin / TICK_STEP) * TICK_STEP; t <= Math.ceil(chartMax / TICK_STEP) * TICK_STEP; t += TICK_STEP) {
    if (t >= chartMin && t <= chartMax) yTicks.push(t)
  }
  if (!yTicks.includes(0)) { yTicks.push(0); yTicks.sort((a, b) => a - b) }

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">대시보드</h2>
        <span className="page-heading-sub">{latest.date} 기준</span>
        <span className="page-heading-net"><span className="page-heading-sub">순자산&nbsp;</span>{(latest.netBalance ?? 0).toLocaleString()}원</span>
      </div>

      {/* 요약 바 */}
      <div className="summary-bar">
        <div className="summary-main">
          <span className="summary-label">순자산</span>
          <span className="summary-value">{fmt(latest.netBalance)}원</span>
          <span className="summary-sub" style={{ color: weekChange >= 0 ? '#22c55e' : '#ef4444' }}>
            주간 {sgn(weekChange)}{fmt(weekChange)}원 ({sgn(weekChangeRate)}{weekChangeRate.toFixed(2)}%)
          </span>
        </div>

        <div className="summary-divider" />

        {[
          { label: '국내', val: domestic, chg: latest.domestic?.change ?? 0 },
          { label: '해외', val: overseas, chg: latest.overseas?.change ?? 0 },
          { label: '연금', val: pension,  chg: latest.pension?.change  ?? 0 },
          ...(latest.totalLoan > 0 ? [{ label: '대출금', val: latest.totalLoan, chg: null, neg: true }] : []),
        ].map(({ label, val, chg, neg }) => (
          <div key={label} className="summary-item">
            <span className="summary-label">{label}</span>
            <span className="summary-item-val" style={{ color: neg ? '#ef4444' : '#f1f5f9' }}>
              {neg ? '-' : ''}{fmt(val)}원
            </span>
            {chg !== null && (
              <span className="summary-sub" style={{ color: chg >= 0 ? '#22c55e' : '#ef4444' }}>
                {sgn(chg)}{fmt(chg)}
              </span>
            )}
          </div>
        ))}

        <div className="summary-divider" />

        {[
          { label: '누적수익',   val: `${sgn(cumulativeGain)}${fmt(cumulativeGain)}원`, color: pc(cumulativeGain), sub: `${first.date.slice(0,7)} ~` },
          { label: '누적수익률', val: `${sgn(cumulativeRate)}${cumulativeRate.toFixed(2)}%`, color: pc(cumulativeRate), sub: `최초 ${fmt(first.totalBalance)}원` },
          { label: '월평균수익', val: `${sgn(monthlyAvgRate)}${monthlyAvgRate.toFixed(2)}%`, color: pc(monthlyAvgRate), sub: `${months}개월` },
        ].map(({ label, val, color, sub }) => (
          <div key={label} className="summary-item">
            <span className="summary-label">{label}</span>
            <span className={`summary-item-val ${color}`}>{val}</span>
            <span className="summary-sub">{sub}</span>
          </div>
        ))}
      </div>

      {/* 셰넌 리밸런싱 요약 (연금/연금외, 리밸런싱 페이지에서 저장한 기준 사용) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-header">
          <h3 className="section-title">셰넌 리밸런싱 요약</h3>
          <span className="page-heading-sub">기준 조정은 리밸런싱 페이지에서</span>
        </div>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {shannonPools.map(p => (
            <div key={p.label} style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{p.label}</span> — 위험 {(100 - p.safeRatio).toFixed(0)}% · 변동범위 ±{p.band}%p
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13 }}>
                  <span className="dim">위험자산 </span>
                  <span style={{ fontWeight: 700 }}>{fmt(p.riskyAssetAmt)}원</span>
                  <span className="dim"> ({(p.riskyAssetAmt / p.total * 100).toFixed(1)}%, </span>
                  <span className={p.needsRebalance ? pc(p.riskyRebalanceAmt) : 'dim'}>
                    {p.needsRebalance
                      ? <>{p.riskyRebalanceAmt >= 0 ? '매수 ' : '매도 '}{fmt(Math.abs(p.riskyRebalanceAmt))}</>
                      : '밴드이내'}
                  </span>
                  <span className="dim">)</span>
                </span>
                <span style={{ fontSize: 13 }}>
                  <span className="dim">안전자산 </span>
                  <span style={{ fontWeight: 700 }}>{fmt(p.safeAssetAmt)}원</span>
                  <span className="dim"> ({(p.safeAssetAmt / p.total * 100).toFixed(1)}%)</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 총자산 변동 차트 */}
      <div className="card">
        <div className="section-header">
          <h3 className="section-title">총자산 변동 추이</h3>
          <div className="legend">
            {[['#f59e0b','연금'],['#3b82f6','국내'],['#22c55e','해외'],['#ef4444','대출']].map(([color, label]) => (
              <span key={label} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />{label}
              </span>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <defs>
              {[['gPension','#f59e0b'],['gDomestic','#3b82f6'],['gOverseas','#22c55e']].map(([id, color]) => (
                <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.7} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.2} />
                </linearGradient>
              ))}
              <linearGradient id="gLoan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => fmt(v)} width={60} ticks={yTicks} domain={[chartMin, chartMax]} />
            <Tooltip content={<NetWorthTooltip />} />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
            <Area type="monotone" dataKey="pension"  stackId="1" stroke="#f59e0b" fill="url(#gPension)"  strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="domestic" stackId="1" stroke="#3b82f6" fill="url(#gDomestic)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="overseas" stackId="1" stroke="#22c55e" fill="url(#gOverseas)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="loan"     stackId="2" stroke="#ef4444" fill="url(#gLoan)"    strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 비중 차트 */}
      <div className="card-row">
        {[
          { title: '섹터별 비중',   data: sectorData,   denom: netDenom },
          { title: '자산유형별 비중', data: categoryData, denom: totalBal },
        ].map(({ title, data, denom }) => (
          <div key={title} className="card">
            <div className="section-header">
              <h3 className="section-title" style={{ flexShrink: 0 }}>{title}</h3>
              <div className="legend" style={{ flex: 1, justifyContent: 'flex-end' }}>
                {data.map((d, i) => (
                  <span key={i} className="legend-item">
                    <span className="legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{d.name}</span>
                    <span className="legend-pct">{((d.value / denom) * 100).toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="chart-area">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} labelLine={false} label={makePieLabel(denom)}>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
                    formatter={(v, name) => [`${v.toLocaleString()}원 (${((v / denom) * 100).toFixed(1)}%)`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* 종목별 비중 */}
      {sectorGroups.length > 0 && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">종목별 비중</h3>
            <span className="page-heading-sub">{holdingCount}개 종목</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>코드</th>
                  <th className="r">평가금액</th>
                  <th className="r">총자산비중</th>
                  <th className="r">평가손익</th>
                  <th className="r">수익률</th>
                </tr>
              </thead>
              <tbody>
                {sectorGroups.map(g => (
                  <>
                    <tr key={`sec-${g.sector}`} className="sector-row">
                      <td colSpan={2} className="bold">{g.sector}</td>
                      <td className="r bold">{fmtWon(g.evalAmt)}</td>
                      <td className="r bold">{(g.evalAmt / totalBal * 100).toFixed(1)}%</td>
                      <td className={`r bold ${pc(g.gainLoss)}`}>{sgn(g.gainLoss)}{fmtWon(g.gainLoss)}</td>
                      <td className={`r bold ${g.purchaseAmt > 0 ? pc(g.gainLoss) : 'muted'}`}>
                        {g.purchaseAmt > 0 ? `${sgn(g.gainLoss)}${(g.gainLoss / g.purchaseAmt * 100).toFixed(2)}%` : '-'}
                      </td>
                    </tr>
                    {g.items.map(h => {
                      const weight = h.evalAmt / totalBal * 100
                      const returnRate = h.purchaseAmt > 0 ? (h.gainLoss / h.purchaseAmt) * 100 : 0
                      return (
                        <tr key={`${g.sector}-${h.code}`}>
                          <td style={{ paddingLeft: '1.8rem' }}>{h.name}</td>
                          <td className="dim">{h.code}</td>
                          <td className="r">{fmtWon(h.evalAmt)}</td>
                          <td className="r">{weight.toFixed(1)}%</td>
                          <td className={`r ${pc(h.gainLoss)}`}>{sgn(h.gainLoss)}{fmtWon(h.gainLoss)}</td>
                          <td className={`r ${pc(returnRate)}`}>{sgn(returnRate)}{returnRate.toFixed(2)}%</td>
                        </tr>
                      )
                    })}
                  </>
                ))}
                <tr className="total-row">
                  <td className="bold dim" colSpan={2}>합계 (주식)</td>
                  <td className="r bold">{fmtWon(holdingsEvalTotal)}</td>
                  <td className="r bold">{(holdingsEvalTotal / totalBal * 100).toFixed(1)}%</td>
                  <td className={`r bold ${pc(holdingsGainTotal)}`}>{sgn(holdingsGainTotal)}{fmtWon(holdingsGainTotal)}</td>
                  <td className={`r bold ${holdingsPurchaseTotal > 0 ? pc(holdingsGainTotal) : 'muted'}`}>
                    {holdingsPurchaseTotal > 0 ? `${sgn(holdingsGainTotal)}${(holdingsGainTotal / holdingsPurchaseTotal * 100).toFixed(2)}%` : '-'}
                  </td>
                </tr>
                {accTotals.cashAmt > 0 && (
                  <tr>
                    <td className="bold" colSpan={2}>예수금</td>
                    <td className="r">{fmtWon(accTotals.cashAmt)}</td>
                    <td className="r">{(accTotals.cashAmt / totalBal * 100).toFixed(1)}%</td>
                    <td className="r dim">-</td>
                    <td className="r dim">-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 계좌별 평가현황 */}
      {accountRows.length > 0 && (
        <div className="card">
          <div className="section-header">
            <h3 className="section-title">계좌별 평가현황</h3>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>계좌</th><th>유형</th>
                  <th className="r">매입금액</th><th className="r">평가금액</th>
                  <th className="r">평가손익</th><th className="r">수익률</th>
                  <th className="r">예수금</th><th className="r">총잔액</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((r, i) => (
                  <tr key={i}>
                    <td>{accNameMap[r.accountId] || r.accountId}</td>
                    <td><span className={`badge badge-${r.category}`}>{CAT_LABEL[r.category] || r.category}</span></td>
                    <td className="r">{fmtWon(r.purchaseAmt)}</td>
                    <td className="r">{fmtWon(r.evalAmt)}</td>
                    <td className={`r bold ${pc(r.gainLoss)}`}>{sgn(r.gainLoss)}{fmtWon(r.gainLoss)}</td>
                    <td className={`r bold ${pc(r.returnRate)}`}>{sgn(r.returnRate)}{r.returnRate.toFixed(2)}%</td>
                    <td className="r dim">{r.cashAmt > 0 ? fmtWon(r.cashAmt) : '-'}</td>
                    <td className="r bold">{fmtWon(r.totalAmt)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td className="bold dim" colSpan={2}>합계</td>
                  <td className="r bold">{fmtWon(accTotals.purchaseAmt)}</td>
                  <td className="r bold">{fmtWon(accTotals.evalAmt)}</td>
                  <td className={`r bold ${pc(accTotals.gainLoss)}`}>{sgn(accTotals.gainLoss)}{fmtWon(accTotals.gainLoss)}</td>
                  <td className={`r bold ${accTotals.purchaseAmt > 0 ? pc(accTotals.gainLoss) : 'muted'}`}>
                    {accTotals.purchaseAmt > 0 ? `${sgn(accTotals.gainLoss)}${((accTotals.gainLoss / accTotals.purchaseAmt) * 100).toFixed(2)}%` : '-'}
                  </td>
                  <td className="r bold dim">{fmtWon(accTotals.cashAmt)}</td>
                  <td className="r bold purple">{fmtWon(accTotals.totalAmt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 기간별 수익 집계 */}
      <div className="card">
        <div className="section-header">
          <h3 className="section-title">기간별 수익 집계</h3>
          <div className="toggle-group">
            <button className={`toggle-btn${aggMode === 'month' ? ' active' : ''}`} onClick={() => setAggMode('month')}>월별</button>
            <button className={`toggle-btn${aggMode === 'year'  ? ' active' : ''}`} onClick={() => setAggMode('year')}>연별</button>
          </div>
        </div>
        <AggregateTable rows={aggData} />
      </div>
    </div>
  )
}
