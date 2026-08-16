// 계좌별 조회 탭 (DataView) — 계좌별평가(accountEval) 원본을 계좌 단위로 조회
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../contexts/AuthContext'
import { useAccounts } from '../../hooks/useAccounts'
import { getAllAccountEval, getAllTransactions, getAllRealizedProfits, deleteDocument } from '../../utils/firestore'
import { getUsdKrwRate } from '../../utils/exchangeRate'
import { toKrw } from '../../utils/currency'
import { fmt } from './shared'

// 순수 계좌이체(은행 입출금)만 순증감에서 제외 — 배당금/이자/분배금 등 손익성 입출금은 포함
const TRANSFER_TYPES = new Set(['이체입금', '계좌대체입금', '대체출금', '대체입금', '이체출금', '소액이체인증입금', '이체오픈뱅킹입금', '대체외화출금', '대체외화입금'])
const isTaxTxType = (type) => type.includes('세')
const isDividendType = (type) => /배당|분배금|이자|이용료/.test(type) && !isTaxTxType(type)
const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : ''

// 거래를 통화별(KRW/USD)로 나눠 signFn으로 부호 적용해 합산 — USD는 현재 환율로 원화 환산 후 KRW와 합산
function currencySum(items, matchFn, signFn, usdRate) {
  let krw = 0, usd = 0
  for (const t of items) {
    if (!matchFn(t)) continue
    const v = signFn(t)
    if (t.currency === 'USD') usd += v; else krw += v
  }
  return toKrw(krw, usd, usdRate)
}

// ── 계좌평가 조회 탭 (계좌별평가 테이블 원본 조회) ────────────────
export default function AccountEvalTab() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [data, setData] = useState([])
  const [txs, setTxs] = useState([])
  const [realized, setRealized] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAccount, setSelectedAccount] = useState('전체')
  const [selectedDate, setSelectedDate] = useState('전체')
  const [usdRate, setUsdRate] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([getAllAccountEval(user.uid), getAllTransactions(user.uid), getAllRealizedProfits(user.uid)])
      .then(([evalRows, txRows, realizedRows]) => {
        setData(evalRows)
        setTxs(txRows)
        setRealized(realizedRows)
        setLoading(false)
      })
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    getUsdKrwRate(today).then(setUsdRate).catch(() => setUsdRate(null))
  }, [])

  const presentIds = new Set(data.map(d => d.accountId))
  const accountIds = [
    ...accounts.map(a => a.accountId).filter(id => presentIds.has(id)),
    ...[...presentIds].filter(id => !accounts.some(a => a.accountId === id)).sort(),
  ]
  const dates = [...new Set(data.map(d => d.date))].sort().reverse()
  const filtered = data
    .filter(d => selectedAccount === '전체' || d.accountId === selectedAccount)
    .filter(d => selectedDate === '전체' || d.date === selectedDate)
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || a.accountId.localeCompare(b.accountId))

  // 상단 요약 — 계좌 선택(날짜 선택 무관)에 따른 전체 기간 요약
  const inAccount = id => selectedAccount === '전체' || id === selectedAccount
  const accRows = data.filter(d => inAccount(d.accountId))
  // 최초/현재 = 계좌평가 테이블 전체 기준 첫날/최신 날짜 (해당 계좌 데이터 없으면 0)
  const tableFirstDate = dates.at(-1)
  const tableLastDate = dates[0]
  const firstBalance = tableFirstDate ? accRows.filter(r => r.date === tableFirstDate).reduce((s, r) => s + r.totalAmt, 0) : 0
  const lastBalance = tableLastDate ? accRows.filter(r => r.date === tableLastDate).reduce((s, r) => s + r.totalAmt, 0) : 0

  const accTxs = txs.filter(t => inAccount(t.accountId))
  const transferNet = currencySum(
    accTxs, t => TRANSFER_TYPES.has(t.type),
    t => t.type.endsWith('입금') ? Math.abs(t.amount) : -Math.abs(t.amount),
    usdRate
  )
  const netChange = (lastBalance - firstBalance) - transferNet

  const realizedTotal = realized.filter(r => inAccount(r.accountId)).reduce((s, r) => s + (r.realizedProfit || 0), 0)
  const dividendTotal = currencySum(
    accTxs, t => isDividendType(t.type),
    t => (t.type.endsWith('입금') ? 1 : t.type.endsWith('출금') ? -1 : Math.sign(t.amount) || 1) * Math.abs(t.amount),
    usdRate
  )
  const feeTotal = currencySum(accTxs, () => true, t => t.fee || 0, usdRate)
  const taxFieldTotal = currencySum(accTxs, () => true, t => t.tax || 0, usdRate)
  // 세금 관련 거래는 출금(세금 납부)이면 +, 입금(환급)이면 -
  const taxTxTotal = currencySum(
    accTxs, t => isTaxTxType(t.type),
    t => (t.type.endsWith('입금') ? -1 : t.type.endsWith('출금') ? 1 : Math.sign(t.amount) || 1) * Math.abs(t.amount),
    usdRate
  )
  const taxTotal = taxFieldTotal + taxTxTotal

  // 현재평가손익(미실현) = 계좌평가 테이블 기준 순증감에서 실현손익/배당 빼고 수수료/세금 더한 잔여분
  // 순증감 = 미실현평가손익 + 실현손익 + 배당 - 수수료 - 세금 (마지막날 데이터 없으면 0)
  const hasLastDateData = accRows.some(r => r.date === tableLastDate)
  const evalGainLoss = hasLastDateData ? (netChange - realizedTotal - dividendTotal + feeTotal + taxTotal) : 0

  const handleDeleteRow = async (row) => {
    if (!window.confirm(`${row.date} / ${row.accountId} 행을 삭제하시겠습니까?`)) return
    await deleteDocument(user.uid, 'accountEval', row.docId)
    setData(d => d.filter(r => r.docId !== row.docId))
  }

  const handleExport = () => {
    const rows = sorted.map(r => ({
      날짜: r.date,
      계좌: r.accountId,
      종목평가금액: r.evalAmt,
      예수금: r.cashAmt,
      총액: r.totalAmt,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '계좌평가조회')
    XLSX.writeFile(wb, `계좌평가조회_${selectedAccount}_${selectedDate}.xlsx`)
  }

  if (loading) return <div className="loading">로딩 중...</div>
  if (!data.length) return <div className="empty">저장된 계좌별평가 데이터가 없습니다.</div>

  return (
    <div>
      <div className="toolbar">
        <div className="date-row">
          <span className="tool-label">계좌</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            <option value="전체">전체</option>
            {accountIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        <div className="date-row">
          <span className="tool-label">날짜</span>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="select input-sm" style={{ maxWidth: 260 }}>
            <option value="전체">전체</option>
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="tool-right">
          <button className="btn btn-outline-green btn-sm" onClick={handleExport}>
            데이터 엑셀 다운로드
          </button>
        </div>
      </div>

      <div className="summary-bar" style={{ marginBottom: 12 }}>
        <div className="summary-item">
          <span className="summary-label">최초 잔액</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{fmt(Math.round(firstBalance))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">현재 잔액</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{fmt(Math.round(lastBalance))}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">증감</span>
          <span className={`summary-item-val ${cls(netChange)}`} style={{ fontSize: 15 }}>{fmt(Math.round(netChange))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">현재평가손익</span>
          <span className={`summary-item-val ${cls(evalGainLoss)}`} style={{ fontSize: 15 }}>{fmt(Math.round(evalGainLoss))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">실현손익</span>
          <span className={`summary-item-val ${cls(realizedTotal)}`} style={{ fontSize: 15 }}>{fmt(Math.round(realizedTotal))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">배당</span>
          <span className={`summary-item-val ${cls(dividendTotal)}`} style={{ fontSize: 15 }}>{fmt(Math.round(dividendTotal))}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">수수료</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{fmt(Math.round(feeTotal))}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">세금</span>
          <span className="summary-item-val" style={{ fontSize: 15 }}>{fmt(Math.round(taxTotal))}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>계좌</th>
              <th className="r">종목평가금액</th>
              <th className="r">예수금</th>
              <th className="r">총액</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const groupStart = i === 0 || row.date !== sorted[i - 1].date
              return (
                <tr key={row.docId} style={{ borderTop: groupStart && i > 0 ? '2px solid #334155' : undefined }}>
                  <td>{row.date}</td>
                  <td>{row.accountId}</td>
                  <td className="r">{fmt(row.evalAmt)}</td>
                  <td className="r">{fmt(row.cashAmt)}</td>
                  <td className="r bold">{fmt(row.totalAmt)}</td>
                  <td>
                    <button className="btn btn-outline-red btn-sm" onClick={() => handleDeleteRow(row)}>삭제</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
