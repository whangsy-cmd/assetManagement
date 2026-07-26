import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { getLatestHoldings, getLatestCash, getAccounts, getSnapshots, getSectors, getLoans, getRebalanceSettings, saveRebalanceSettings } from '../utils/firestore'
import '../common.css'

function fmt(n) {
  if (!n && n !== 0) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return Math.round(n).toLocaleString()
}
function sgn(v) { return v >= 0 ? '+' : '' }
function pc(v) { return v >= 0 ? 'pos' : 'neg' }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }
function variance(a) { const m = mean(a); return a.length ? mean(a.map(x => (x - m) ** 2)) : 0 }

export default function RebalanceReport() {
  const { user } = useAuth()
  const [holdings, setHoldings] = useState([])
  const [cash, setCash] = useState([])
  const [accounts, setAccounts] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [sectors, setSectors] = useState([])
  const [loans, setLoans] = useState([])
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('shannon')
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      getLatestHoldings(user.uid),
      getLatestCash(user.uid),
      getAccounts(user.uid),
      getSnapshots(user.uid, 500),
      getSectors(user.uid),
      getLoans(user.uid),
      getRebalanceSettings(user.uid),
    ]).then(([h, c, acc, s, sec, ln, st]) => {
      setHoldings(h); setCash(c); setAccounts(acc); setSnapshots(s); setSectors(sec); setLoans(ln)
      setSettings(st || {})
      setLoading(false)
    })
  }, [user])

  // 입력값 변경 시 기본값으로 저장(디바운스)
  function updateSettings(patch) {
    setSettings(prev => {
      const next = {
        kelly: { ...prev.kelly, ...patch.kelly },
        shannon: {
          pension: { ...prev.shannon?.pension, ...patch.shannon?.pension },
          other: { ...prev.shannon?.other, ...patch.shannon?.other },
        },
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveRebalanceSettings(user.uid, next), 600)
      return next
    })
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!snapshots.length) return (
    <div className="empty">
      <p>아직 데이터가 없습니다.</p>
    </div>
  )

  const latest = snapshots.at(-1)
  const loanTotal = loans.reduce((s, l) => s + (l.amount || 0), 0)

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">리밸런싱 리포트</h2>
        <span className="page-heading-sub">{latest.date} 기준</span>
      </div>

      <div className="toggle-group" style={{ marginBottom: 12 }}>
        <button className={`toggle-btn${tab === 'shannon' ? ' active' : ''}`} onClick={() => setTab('shannon')}>셰넌 기준</button>
        <button className={`toggle-btn${tab === 'kelly' ? ' active' : ''}`} onClick={() => setTab('kelly')}>켈리 기준</button>
      </div>

      {tab === 'kelly'
        ? <KellyTab snapshots={snapshots} latest={latest} holdings={holdings} cash={cash} accounts={accounts} loanTotal={loanTotal}
            settings={settings.kelly} onSettingsChange={updateSettings} />
        : <ShannonTab holdings={holdings} cash={cash} sectors={sectors} accounts={accounts} snapshots={snapshots}
            settings={settings.shannon} onSettingsChange={updateSettings} />
      }
    </div>
  )
}

// 연금/연금외 풀 간 자금이동 불가 → 켈리 f*는 "각 풀 자체 자금 중 위험자산 비중"으로 적용(풀 내부에서만 실행 가능).
// 매수는 그 풀의 가용예수금까지만 실행가능(연금은 외부현금 유입 불가), 매도는 항상 실행가능.
function KellyTab({ snapshots, latest, holdings, cash, accounts, loanTotal, settings, onSettingsChange }) {
  const [windowN, setWindowN] = useState(settings?.windowN ?? 12)
  const [multiplier, setMultiplier] = useState(settings?.multiplier ?? 0.5)
  const [minCap, setMinCap] = useState(settings?.minCap ?? 0)
  const [maxCap, setMaxCap] = useState(settings?.maxCap ?? 100)

  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return }
    onSettingsChange({ kelly: { windowN, multiplier, minCap, maxCap } })
  }, [windowN, multiplier, minCap, maxCap])

  const accCatMap = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
  const isPension = (id) => accCatMap[id] === 'pension'

  const pensionRets = snapshots.slice(1).map(s => (s.pension?.changeRate ?? 0) / 100)
  const otherSeries = snapshots.map(s => (s.domestic?.balance ?? 0) + (s.overseas?.balance ?? 0))
  const otherRets = []
  for (let i = 1; i < otherSeries.length; i++) {
    const prev = otherSeries[i - 1]
    otherRets.push(prev > 0 ? (otherSeries[i] - prev) / prev : 0)
  }

  const pensionStock = holdings.filter(h => isPension(h.accountId)).reduce((s, h) => s + (h.evalAmt || 0), 0)
  const pensionCash = cash.filter(c => isPension(c.accountId)).reduce((s, c) => s + (c.amount || 0), 0)
  const pensionPoolTotal = latest.pension?.balance ?? (pensionStock + pensionCash)

  const otherStock = holdings.filter(h => !isPension(h.accountId)).reduce((s, h) => s + (h.evalAmt || 0), 0)
  const otherCash = cash.filter(c => !isPension(c.accountId)).reduce((s, c) => s + (c.amount || 0), 0) - loanTotal
  const otherPoolTotal = (latest.domestic?.balance ?? 0) + (latest.overseas?.balance ?? 0) - loanTotal

  const cats = [
    { key: 'pension', label: '연금', rets: pensionRets, stockAmt: pensionStock, cashAmt: pensionCash, poolTotal: pensionPoolTotal },
    { key: 'other', label: '연금외', rets: otherRets, stockAmt: otherStock, cashAmt: otherCash, poolTotal: otherPoolTotal },
  ]
  const rows = cats.map(({ key, label, rets, stockAmt, cashAmt, poolTotal }) => {
    const windowed = windowN >= rets.length ? rets : rets.slice(-windowN)
    const mu = mean(windowed)
    const sigma2 = variance(windowed)
    const sigma = Math.sqrt(sigma2)
    const kellyF = sigma2 > 0 ? mu / sigma2 : 0
    const targetWeight = clamp(kellyF * multiplier, minCap / 100, maxCap / 100)
    const currentWeight = poolTotal > 0 ? stockAmt / poolTotal : 0
    const targetAmt = targetWeight * poolTotal
    const rawRebalance = targetAmt - stockAmt
    const executable = rawRebalance >= 0 ? Math.min(rawRebalance, Math.max(cashAmt, 0)) : rawRebalance
    const constrained = rawRebalance > 0 && rawRebalance > cashAmt
    return { key, label, mu, sigma, kellyF, targetWeight, stockAmt, cashAmt, currentWeight, targetAmt, rawRebalance, executable, constrained }
  })

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>기준 입력</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <InputField label="관측 기간(최근 N주)">
            <select value={windowN} onChange={e => setWindowN(Number(e.target.value))} style={selectStyle}>
              <option value={8}>8주</option>
              <option value={12}>12주</option>
              <option value={20}>20주</option>
              <option value={9999}>전체</option>
            </select>
          </InputField>
          <InputField label="켈리 승수 (1=풀켈리, 0.5=하프켈리)">
            <input type="number" step="0.1" value={multiplier} onChange={e => setMultiplier(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="목표비중 하한 %">
            <input type="number" value={minCap} onChange={e => setMinCap(Number(e.target.value))} style={numInputStyle} />
          </InputField>
          <InputField label="목표비중 상한 %">
            <input type="number" value={maxCap} onChange={e => setMaxCap(Number(e.target.value))} style={numInputStyle} />
          </InputField>
        </div>
      </div>

      <div className="card">
        <div className="section-header">
          <h3 className="section-title">풀별(연금/연금외) 켈리 리밸런싱 대상 — 위험자산 비중 기준</h3>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>구분</th>
                <th className="r">현재 위험자산비중</th>
                <th className="r">위험자산 현재금액</th>
                <th className="r">가용예수금</th>
                <th className="r">μ(주간)</th>
                <th className="r">σ(주간)</th>
                <th className="r">켈리 f*</th>
                <th className="r">목표비중</th>
                <th className="r">목표금액</th>
                <th className="r">리밸런싱(실행가능)</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="r">{(r.currentWeight * 100).toFixed(1)}%</td>
                  <td className="r">{fmt(r.stockAmt)}</td>
                  <td className="r dim">{fmt(r.cashAmt)}</td>
                  <td className={`r ${pc(r.mu)}`}>{sgn(r.mu)}{(r.mu * 100).toFixed(2)}%</td>
                  <td className="r dim">{(r.sigma * 100).toFixed(2)}%</td>
                  <td className={`r bold ${pc(r.kellyF)}`}>{r.kellyF.toFixed(2)}</td>
                  <td className="r bold">{(r.targetWeight * 100).toFixed(1)}%</td>
                  <td className="r">{fmt(r.targetAmt)}</td>
                  <td className={`r bold ${pc(r.executable)}`}>
                    {r.executable >= 0 ? '매수 ' : '매도 '}{sgn(r.executable)}{fmt(r.executable)}
                  </td>
                  <td>
                    {r.constrained && (
                      <span className="badge" style={{ color: '#f87171', background: '#3b0d0d' }}>
                        예수금 부족 (필요 {fmt(r.rawRebalance)})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
          f* = μ/σ² (선택 기간 주간수익률 평균/분산). 목표비중은 각 풀(연금/연금외) 자체 자금 대비 위험자산 비중 — 풀 간 자금이동은 불가하므로 풀 내부에서만 계산.
          매수는 그 풀의 가용예수금까지만 실행가능(연금은 외부현금 추가 불가), 매도는 보유자산 매도라 항상 실행가능. 대출은 현금 취급해 연금외 예수금에서 차감.
        </p>
      </div>
    </>
  )
}

// ── 셰넌 기준 탭 ─────────────────────────────────────────────
// 연금은 외부 현금 추가 불가 → 연금/연금외 완전 분리 계산 (풀 간 자금이동 없음 전제). 대출은 미반영, 현재 예수금 그대로 사용.
function ShannonTab({ holdings, cash, sectors, accounts, settings, onSettingsChange, snapshots }) {
  const accCatMap = Object.fromEntries(accounts.map(a => [a.accountId, a.category]))
  const isPension = (accountId) => accCatMap[accountId] === 'pension'

  const pensionHoldings = holdings.filter(h => isPension(h.accountId))
  const otherHoldings = holdings.filter(h => !isPension(h.accountId))
  const pensionCash = cash.filter(c => isPension(c.accountId))
  const otherCash = cash.filter(c => !isPension(c.accountId))

  const dates = snapshots.map(s => s.date)
  const pensionHistory = snapshots.map(s => s.pension?.balance ?? 0)
  const otherHistory = snapshots.map(s => (s.domestic?.balance ?? 0) + (s.overseas?.balance ?? 0))

  return (
    <>
      <ShannonPool poolLabel="연금" holdings={pensionHoldings} cash={pensionCash} sectors={sectors}
        settings={settings?.pension} onSettingsChange={patch => onSettingsChange({ shannon: { pension: patch } })}
        dates={dates} history={pensionHistory} />
      <ShannonPool poolLabel="연금외 (국내+해외)" holdings={otherHoldings} cash={otherCash} sectors={sectors}
        settings={settings?.other} onSettingsChange={patch => onSettingsChange({ shannon: { other: patch } })}
        dates={dates} history={otherHistory} />
    </>
  )
}

function simulateShannon(history, riskyWeightPct, bandPct) {
  const rets = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    rets.push(prev > 0 ? (history[i] - prev) / prev : 0)
  }
  const riskyFrac = riskyWeightPct / 100
  let risky = riskyFrac, cashSim = 1 - riskyFrac
  const path = [risky + cashSim]
  for (const r of rets) {
    risky *= (1 + r)
    const total = risky + cashSim
    const currentRiskyPct = total > 0 ? risky / total * 100 : 0
    if (Math.abs(currentRiskyPct - riskyWeightPct) > bandPct) {
      risky = total * riskyFrac
      cashSim = total * (1 - riskyFrac)
    }
    path.push(total)
  }
  return path
}
function maxDrawdown(path) {
  let peak = path[0], dd = 0
  for (const v of path) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1) }
  return dd
}

function ShannonPool({ poolLabel, holdings, cash, sectors, settings, onSettingsChange, dates, history }) {
  const sectorMap = Object.fromEntries(sectors.map(s => [s.code, s.sector || '미분류']))
  const sectorAgg = {}
  for (const h of holdings) {
    const sec = sectorMap[h.code] || '미분류'
    if (!sectorAgg[sec]) sectorAgg[sec] = { evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
    sectorAgg[sec].evalAmt += h.evalAmt || 0
    sectorAgg[sec].purchaseAmt += h.purchaseAmt || 0
    sectorAgg[sec].gainLoss += h.gainLoss || 0
  }
  const stockTotal = Object.values(sectorAgg).reduce((a, b) => a + b.evalAmt, 0)
  const cashTotal = cash.reduce((s, c) => s + (c.amount || 0), 0)
  if (!sectorAgg['예수금']) sectorAgg['예수금'] = { evalAmt: 0, purchaseAmt: 0, gainLoss: 0 }
  sectorAgg['예수금'].evalAmt += cashTotal
  const total = stockTotal + cashTotal || 1

  const names = Object.keys(sectorAgg).sort((a, b) => sectorAgg[b].evalAmt - sectorAgg[a].evalAmt)
  const currentWeights = Object.fromEntries(names.map(n => [n, sectorAgg[n].evalAmt / total * 100]))

  const [safeSet, setSafeSet] = useState(() => new Set(settings?.safeSectors ?? (names.includes('예수금') ? ['예수금'] : [])))
  const [safeRatio, setSafeRatio] = useState(settings?.safeRatio ?? 30)
  const [band, setBand] = useState(settings?.band ?? 10)

  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return }
    onSettingsChange({ safeRatio, band, safeSectors: [...safeSet] })
  }, [safeRatio, band, safeSet])

  const toggleSafe = (name) => setSafeSet(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const safeAssetAmt = names.filter(n => safeSet.has(n)).reduce((s, n) => s + sectorAgg[n].evalAmt, 0)
  const riskyAssetAmt = total - safeAssetAmt
  const targetSafeAmt = safeRatio / 100 * total
  const targetRiskyAmt = total - targetSafeAmt
  const currentSafePct = safeAssetAmt / total * 100
  const needsRebalance = Math.abs(currentSafePct - safeRatio) > band
  const riskyRebalanceAmt = needsRebalance ? targetRiskyAmt - riskyAssetAmt : 0

  // 시뮬레이션: 실제(매수후보유) vs 현재 설정(안전비율/밴드)으로 셰넌 리밸런싱했을 때
  const validHistory = history.filter(v => v > 0)
  const simPath = validHistory.length > 1 ? simulateShannon(validHistory, 100 - safeRatio, band) : []
  const actualPath = validHistory.map(v => v / validHistory[0])
  const simDates = dates.slice(dates.length - validHistory.length)
  const chartData = simDates.map((d, i) => ({ date: d, 실제: actualPath[i], 셰넌시뮬: simPath[i] }))
  const actualEnd = actualPath.at(-1), simEnd = simPath.at(-1)
  const actualMDD = maxDrawdown(actualPath), simMDD = maxDrawdown(simPath)

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-header">
        <h3 className="section-title">{poolLabel}</h3>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <InputField label="목표 안전자산 배분비율(%)">
          <input type="number" value={safeRatio} onChange={e => setSafeRatio(Number(e.target.value))} style={numInputStyle} />
        </InputField>
        <InputField label="리밸런싱 밴드 (목표비중 대비 ±%p)">
          <input type="number" value={band} onChange={e => setBand(Number(e.target.value))} style={numInputStyle} />
        </InputField>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>안전자산 지정 (체크한 섹터 = 안전자산)</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {names.map(name => (
          <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#e2e8f0', cursor: 'pointer' }}>
            <input type="checkbox" checked={safeSet.has(name)} onChange={() => toggleSafe(name)} />
            {name}
          </label>
        ))}
      </div>

      <div className="summary-bar" style={{ marginBottom: 12 }}>
        <div className="summary-item">
          <span className="summary-label">위험자산</span>
          <span className="summary-item-val">{fmt(riskyAssetAmt)}원</span>
          <span className="summary-sub">{(riskyAssetAmt / total * 100).toFixed(1)}% (목표 {(100 - safeRatio).toFixed(1)}%)</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">안전자산(예수금)</span>
          <span className={`summary-item-val ${pc(safeAssetAmt)}`}>{fmt(safeAssetAmt)}원</span>
          <span className="summary-sub">{(safeAssetAmt / total * 100).toFixed(1)}% (목표 {safeRatio}%)</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">위험자산 리밸런싱</span>
          <span className={`summary-item-val ${needsRebalance ? pc(riskyRebalanceAmt) : ''}`}>
            {needsRebalance
              ? <>{riskyRebalanceAmt >= 0 ? '매수 ' : '매도 '}{sgn(riskyRebalanceAmt)}{fmt(riskyRebalanceAmt)}</>
              : '밴드 이내 (조정 불필요)'}
          </span>
          <span className="summary-sub">목표안전 {fmt(targetSafeAmt)} / 목표위험 {fmt(targetRiskyAmt)}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>안전</th>
              <th>섹터</th>
              <th className="r">현재비중</th>
              <th className="r">현재금액</th>
              <th className="r">수익률</th>
            </tr>
          </thead>
          <tbody>
            {names.map(name => {
              const { evalAmt, purchaseAmt, gainLoss } = sectorAgg[name]
              const currentWeight = currentWeights[name]
              const returnRate = purchaseAmt > 0 ? (gainLoss / purchaseAmt) * 100 : null
              return (
                <tr key={name}>
                  <td><input type="checkbox" checked={safeSet.has(name)} onChange={() => toggleSafe(name)} /></td>
                  <td>{name}</td>
                  <td className="r dim">{currentWeight.toFixed(1)}%</td>
                  <td className="r">{fmt(evalAmt)}</td>
                  <td className={`r bold ${returnRate === null ? 'muted' : pc(returnRate)}`}>
                    {returnRate === null ? '-' : `${sgn(returnRate)}${returnRate.toFixed(2)}%`}
                  </td>
                </tr>
              )
            })}
            <tr className="total-row">
              <td></td>
              <td className="bold dim">합계</td>
              <td className="r dim">100.0%</td>
              <td className="r bold">{fmt(total)}</td>
              <td className="r dim">-</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        "목표 안전자산 배분비율"은 셰넌의 도깨비 2분할(안전:위험 고정비율) 기준 위험자산 매수/매도 금액. 현재 안전자산비중이 목표에서 "리밸런싱 밴드"(%p) 밖으로 벗어나야 매수/매도 금액이 표시됨(밴드 이내면 0). 수익률로 어느 섹터를 정리할지 판단하는 참고용.
        체크박스로 안전자산 섹터 지정(기본값: 예수금). 대출은 미반영, 현재 예수금 그대로 계산. {poolLabel === '연금' && '연금은 외부 현금 추가가 불가해 연금외 풀과 독립적으로 계산.'}
      </p>

      {chartData.length > 1 && (
        <div style={{ marginTop: 20 }}>
          <div className="section-header">
            <h3 className="section-title" style={{ fontSize: 14 }}>시뮬레이션: 실제(매수후보유) vs 셰넌 리밸런싱 (현재 설정 기준)</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => v.toFixed(1) + 'x'} width={45} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
                formatter={v => v.toFixed(3) + 'x'}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="실제" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="셰넌시뮬" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            최종배수 — 실제 {actualEnd.toFixed(2)}x (MDD {(actualMDD * 100).toFixed(1)}%) / 셰넌시뮬 {simEnd.toFixed(2)}x (MDD {(simMDD * 100).toFixed(1)}%).
            시뮬은 이 풀의 과거 잔액 변동을 위험자산 수익률로 보고, 현재 설정한 안전비율·밴드로 매기간 리밸런싱했다면 어땠을지 계산한 것(실제 입출금 반영 안 됨, 참고용).
          </p>
        </div>
      )}
    </div>
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

const numInputStyle = {
  background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155',
  borderRadius: 6, padding: '5px 8px', fontSize: 13, width: 80,
}
const selectStyle = { ...numInputStyle, width: 90 }
