// 종목별 손익 탭 (DataView) — 종목코드 기준 실현손익+현재 평가손익 통합 요약, 수익 순 정렬
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { getAllTransactions, getAllRealizedProfits, getAllHoldings } from '../../utils/firestore'
import { getUsdKrwRate } from '../../utils/exchangeRate'
import { toKrw } from '../../utils/currency'
import { fmt } from './shared'

export default function StockProfitTab() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [usdRate, setUsdRate] = useState(null)

  useEffect(() => {
    setLoading(true)
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    Promise.all([getAllTransactions(user.uid), getAllRealizedProfits(user.uid), getAllHoldings(user.uid), getUsdKrwRate(today).catch(() => null)])
      .then(([txs, realized, holdings, rate]) => {
        setUsdRate(rate)
        const nameByCode = new Map()
        const realizedByCode = new Map()
        // 해외 거래 fee/tax는 USD 원화(₩) 혼합 방지 위해 통화별로 따로 누적
        const feeTaxByCode = new Map()
        // 선물옵션 등 realizedProfits 컬렉션이 없는 종목은 거래 자체의 profit(청산손익, 이미 원화) 합계로 대체
        const txProfitByCode = new Map()
        const tradeCountByCode = new Map()
        for (const t of txs) {
          if (!t.code) continue
          nameByCode.set(t.code, t.name || nameByCode.get(t.code))
          const cur = feeTaxByCode.get(t.code) || { krw: 0, usd: 0 }
          const amt = (t.fee || 0) + (t.tax || 0)
          if (t.currency === 'USD') cur.usd += amt; else cur.krw += amt
          feeTaxByCode.set(t.code, cur)
          if (t.profit !== undefined && t.profit !== null) {
            txProfitByCode.set(t.code, (txProfitByCode.get(t.code) || 0) + t.profit)
          }
          if (/매수|매도/.test(t.type)) {
            tradeCountByCode.set(t.code, (tradeCountByCode.get(t.code) || 0) + 1)
          }
        }
        for (const r of realized) {
          if (!r.code) continue
          nameByCode.set(r.code, r.name || nameByCode.get(r.code))
          realizedByCode.set(r.code, (realizedByCode.get(r.code) || 0) + (r.realizedProfit || 0))
        }

        const latestDate = holdings.map(h => h.date).sort().at(-1)
        const evalByCode = new Map()
        const heldAmtByCode = new Map()
        for (const h of holdings) {
          if (!h.code || h.date !== latestDate) continue
          nameByCode.set(h.code, h.name || nameByCode.get(h.code))
          evalByCode.set(h.code, (evalByCode.get(h.code) || 0) + (h.gainLoss || 0))
          heldAmtByCode.set(h.code, (heldAmtByCode.get(h.code) || 0) + (h.evalAmt || 0))
        }

        const out = [...nameByCode.keys()].map(code => {
          const realizedProfit = realizedByCode.has(code) ? realizedByCode.get(code) : (txProfitByCode.get(code) || 0)
          const evalGainLoss = evalByCode.get(code) || 0
          const ft = feeTaxByCode.get(code) || { krw: 0, usd: 0 }
          return {
            code,
            name: nameByCode.get(code) || code,
            realizedProfit,
            feeTaxKrw: ft.krw,
            feeTaxUsd: ft.usd,
            evalGainLoss,
            heldAmt: heldAmtByCode.get(code) || 0,
            totalProfit: realizedProfit + evalGainLoss,
            tradeCount: tradeCountByCode.get(code) || 0,
          }
        }).sort((a, b) => b.totalProfit - a.totalProfit)

        setRows(out)
        setLoading(false)
      })
  }, [])

  const totalsRaw = rows.reduce((s, r) => ({
    realizedProfit: s.realizedProfit + r.realizedProfit,
    feeTaxKrw: s.feeTaxKrw + r.feeTaxKrw,
    feeTaxUsd: s.feeTaxUsd + r.feeTaxUsd,
    evalGainLoss: s.evalGainLoss + r.evalGainLoss,
    heldAmt: s.heldAmt + r.heldAmt,
    totalProfit: s.totalProfit + r.totalProfit,
    tradeCount: s.tradeCount + r.tradeCount,
  }), { realizedProfit: 0, feeTaxKrw: 0, feeTaxUsd: 0, evalGainLoss: 0, heldAmt: 0, totalProfit: 0, tradeCount: 0 })
  const totals = { ...totalsRaw, feeTax: toKrw(totalsRaw.feeTaxKrw, totalsRaw.feeTaxUsd, usdRate) }

  const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : ''

  const winRows = rows.filter(r => r.totalProfit > 0)
  const lossRows = rows.filter(r => r.totalProfit < 0)
  const winSum = winRows.reduce((s, r) => s + r.totalProfit, 0)
  const lossSum = lossRows.reduce((s, r) => s + r.totalProfit, 0)
  const winAvg = winRows.length ? winSum / winRows.length : 0
  const lossAvg = lossRows.length ? lossSum / lossRows.length : 0
  const winRate = (winRows.length + lossRows.length) ? winRows.length / (winRows.length + lossRows.length) * 100 : 0
  const profitRatio = lossRows.length ? winAvg / Math.abs(lossAvg) : (winRows.length ? Infinity : null)

  const handleExport = () => {
    const exportRows = rows.map(r => ({
      종목: r.name,
      종목코드: r.code,
      실현손익: r.realizedProfit,
      '수수료+세금': Math.round(toKrw(r.feeTaxKrw, r.feeTaxUsd, usdRate)),
      '평가손익(현재)': r.evalGainLoss,
      '보유금액(현재)': r.heldAmt,
      총손익: r.totalProfit,
      거래건수: r.tradeCount,
    }))
    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '종목별손익')
    XLSX.writeFile(wb, '종목별손익.xlsx')
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!rows.length) return <div className="empty">데이터가 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div />
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
        </div>
      </div>
      <div className="summary-bar" style={{ marginBottom: 12 }}>
        <div className="summary-item">
          <span className="summary-label">수익 종목 건수</span>
          <span className="summary-item-val pos" style={{ fontSize: 15 }}>{winRows.length}건</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">수익 합계</span>
          <span className="summary-item-val pos" style={{ fontSize: 15 }}>{fmt(Math.round(winSum))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">수익 평균</span>
          <span className="summary-item-val pos" style={{ fontSize: 15 }}>{fmt(Math.round(winAvg))}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">손실 종목 건수</span>
          <span className="summary-item-val neg" style={{ fontSize: 15 }}>{lossRows.length}건</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">손실 합계</span>
          <span className="summary-item-val neg" style={{ fontSize: 15 }}>{fmt(Math.round(lossSum))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">손실 평균</span>
          <span className="summary-item-val neg" style={{ fontSize: 15 }}>{fmt(Math.round(lossAvg))}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">승률</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{winRate.toFixed(1)}%</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">손익비</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{profitRatio === null ? '-' : profitRatio === Infinity ? '∞' : profitRatio.toFixed(2)}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>종목</th>
              <th className="r">실현손익(원)</th>
              <th className="r">수수료+세금</th>
              <th className="r">평가손익(현재)</th>
              <th className="r">보유금액(현재)</th>
              <th className="r">총손익</th>
              <th className="r">거래건수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code}>
                <td>{r.name} ({r.code})</td>
                <td className={'r ' + cls(r.realizedProfit)}>{fmt(r.realizedProfit)}</td>
                <td className="r">{fmt(Math.round(toKrw(r.feeTaxKrw, r.feeTaxUsd, usdRate)))}</td>
                <td className={'r ' + cls(r.evalGainLoss)}>{fmt(r.evalGainLoss)}</td>
                <td className="r">{fmt(r.heldAmt)}</td>
                <td className={'r bold ' + cls(r.totalProfit)}>{fmt(r.totalProfit)}</td>
                <td className="r">{r.tradeCount}건</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="bold">합계</td>
              <td className={'r bold ' + cls(totals.realizedProfit)}>{fmt(totals.realizedProfit)}</td>
              <td className="r bold">{fmt(Math.round(totals.feeTax))}</td>
              <td className={'r bold ' + cls(totals.evalGainLoss)}>{fmt(totals.evalGainLoss)}</td>
              <td className="r bold">{fmt(totals.heldAmt)}</td>
              <td className={'r bold ' + cls(totals.totalProfit)}>{fmt(totals.totalProfit)}</td>
              <td className="r bold">{totals.tradeCount}건</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
