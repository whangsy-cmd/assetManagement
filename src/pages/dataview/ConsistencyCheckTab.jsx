// 정합성 검사 탭 (DataView) — 매도 거래내역과 실현손익이 계좌·일자·종목코드 기준으로 서로 매칭되는지 대조
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { getAllTransactions, getAllRealizedProfits } from '../../utils/firestore'
import { addBusinessDays } from '../../utils/parsers'
import { fmt } from './shared'

// 키움국내(3058-4099)는 2025-08-06 이전 실현손익을 등록하지 않아(거래내역은 있음) 그 기간은 매도 거래-실현손익 매칭 검증에서 제외
const NO_RP_BEFORE = { '3058-4099': '2025-08-06' }

// 옵션/선물 계좌는 매도가 항상 청산은 아님(매도로 진입 후 매수로 청산하는 숏 포지션 가능) — 매도-실현손익 매칭 검증 자체가 성립 안 해서 계좌 통째로 제외
const OPTION_ACCOUNTS = new Set(['1611-0027', '5767-2099'])

// 계좌별 결제 소요 영업일 — 실현손익 발생일 + 이 기간이 아직 안 지났으면 거래내역이 결제 전이라 없는 게 정상(정합성 검사 제외 대상)
const SETTLEMENT_DAYS = {
  '3058-4099': { n: 2, market: 'kr' },        // 키움국내
  '5124-4860': { n: 2, market: 'us' },        // 키움해외 종목매매
  '010-9786-1102-1': { n: 2, market: 'kr' },  // 미래에셋 연금저축
  '010-9786-1102-2': { n: 2, market: 'kr' },  // 미래에셋 일반
  '010-9786-1102-3': { n: 2, market: 'kr' },  // 미래에셋 ISA
  '010-9786-1102-5': { n: 2, market: 'kr' },  // 미래에셋 IRP
}
const todayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

export default function ConsistencyCheckTab() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [txMissing, setTxMissing] = useState([]) // 매도 거래는 있는데 실현손익 없음
  const [rpMissing, setRpMissing] = useState([]) // 실현손익은 있는데 매칭되는 매도 거래 없음
  const [qtyMismatch, setQtyMismatch] = useState([]) // 매칭은 되는데 수량이 다름

  useEffect(() => {
    setLoading(true)
    Promise.all([getAllTransactions(user.uid), getAllRealizedProfits(user.uid)]).then(async ([tx, rp]) => {
      const sellTx = tx.filter(t => t.code && /매도/.test(t.type))
      const rpWithCode = rp.filter(r => r.code)
      const matchableSellTx = sellTx.filter(t => !OPTION_ACCOUNTS.has(t.accountId))
      const matchableRp = rpWithCode.filter(r => !OPTION_ACCOUNTS.has(r.accountId))

      const rpKeys = new Set(matchableRp.map(r => `${r.date}_${r.accountId}_${r.code}`))
      const txKeys = new Set(matchableSellTx.map(t => `${t.date}_${t.accountId}_${t.code}`))

      const hasNoRpData = t => { const from = NO_RP_BEFORE[t.accountId]; return from && t.date < from }

      const today = todayIso()
      const pendingSettlement = async r => {
        const cfg = SETTLEMENT_DAYS[r.accountId]
        if (!cfg) return false
        return (await addBusinessDays(r.date, cfg.n, cfg.market)) > today
      }
      const rpCandidates = matchableRp.filter(r => !txKeys.has(`${r.date}_${r.accountId}_${r.code}`))
      const pendingFlags = await Promise.all(rpCandidates.map(pendingSettlement))

      setTxMissing(matchableSellTx.filter(t => !rpKeys.has(`${t.date}_${t.accountId}_${t.code}`) && !hasNoRpData(t)))
      setRpMissing(rpCandidates.filter((_, i) => !pendingFlags[i]))

      // 날짜+계좌+종목코드로 매칭되는 건만 대상 — 동일 종목 하루치는 이미 각 컬렉션 저장 시 한 건으로 합산돼 있어 수량도 그대로 비교 가능. qty 없는 소스(미래에셋/옵션 등)는 비교 제외.
      const txQtyByKey = new Map(matchableSellTx.map(t => [`${t.date}_${t.accountId}_${t.code}`, t.qty]))
      const rpQtyByKey = new Map(matchableRp.map(r => [`${r.date}_${r.accountId}_${r.code}`, r.qty]))
      const mismatches = []
      for (const [key, txQty] of txQtyByKey) {
        if (!rpKeys.has(key)) continue
        const rpQty = rpQtyByKey.get(key)
        if (txQty === undefined || rpQty === undefined) continue
        if (txQty !== rpQty) {
          const t = matchableSellTx.find(x => `${x.date}_${x.accountId}_${x.code}` === key)
          mismatches.push({ ...t, txQty, rpQty })
        }
      }
      setQtyMismatch(mismatches)
      setLoading(false)
    }).catch(e => { setLoadError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div className="loading">로딩 중...</div>
  if (loadError) return <div className="neg" style={{ padding: 20, fontSize: 13 }}>{loadError}</div>

  return (
    <div>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
        매도 거래내역과 실현손익을 계좌·일자·종목코드 기준으로 대조합니다. 거래내역/실현손익을 별도 경로로만 입력하는 계좌(옵션·선물, 계좌단위 실현손익 등)는 원래 매칭되지 않으니 정상입니다.
      </p>

      <div style={{ marginBottom: 24 }}>
        <p className="section-label">매도 거래는 있는데 실현손익이 없음 — {txMissing.length}건</p>
        {txMissing.length === 0 ? <div className="empty">없음</div> : (
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr><th>일자</th><th>계좌</th><th>종목코드</th><th>종목명</th><th className="r">수량</th><th className="r">거래금액</th></tr>
              </thead>
              <tbody>
                {txMissing.map(t => (
                  <tr key={t.docId}>
                    <td>{t.date}</td><td>{t.accountId}</td><td>{t.code}</td><td>{t.name || '-'}</td>
                    <td className="r">{t.qty !== undefined ? t.qty.toLocaleString() : '-'}</td>
                    <td className="r">{fmt(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <p className="section-label">실현손익은 있는데 매칭되는 매도 거래가 없음 — {rpMissing.length}건</p>
        {rpMissing.length === 0 ? <div className="empty">없음</div> : (
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr><th>일자</th><th>계좌</th><th>종목코드</th><th>종목명</th><th className="r">수량</th><th className="r">실현손익</th></tr>
              </thead>
              <tbody>
                {rpMissing.map(r => (
                  <tr key={r.docId}>
                    <td>{r.date}</td><td>{r.accountId}</td><td>{r.code}</td><td>{r.name || '-'}</td>
                    <td className="r">{r.qty !== undefined ? r.qty.toLocaleString() : '-'}</td>
                    <td className={'r ' + (r.realizedProfit >= 0 ? 'pos' : 'neg')}>{fmt(r.realizedProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <p className="section-label">매도 거래-실현손익은 매칭되는데 수량이 다름 — {qtyMismatch.length}건</p>
        {qtyMismatch.length === 0 ? <div className="empty">없음</div> : (
          <div className="table-wrap table-wrap-scroll">
            <table className="data-table">
              <thead>
                <tr><th>일자</th><th>계좌</th><th>종목코드</th><th>종목명</th><th className="r">거래내역 수량</th><th className="r">실현손익 수량</th></tr>
              </thead>
              <tbody>
                {qtyMismatch.map(t => (
                  <tr key={t.docId}>
                    <td>{t.date}</td><td>{t.accountId}</td><td>{t.code}</td><td>{t.name || '-'}</td>
                    <td className="r neg">{fmt(t.txQty)}</td>
                    <td className="r neg">{fmt(t.rpQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
