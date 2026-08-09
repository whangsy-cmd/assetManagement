import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAccounts } from '../hooks/useAccounts'
import { getAllOptionMonthlyProfit } from '../utils/firestore'
import '../common.css'

function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

export default function OptionsPage() {
  const { user } = useAuth()
  const { accounts } = useAccounts()
  const [profitData, setProfitData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllOptionMonthlyProfit(user.uid).then(profit => {
      setProfitData(profit)
      setLoading(false)
    })
  }, [user.uid])

  const optionAccounts = accounts.filter(a => a.name === '선물옵션')

  if (loading) return <div className="loading">로딩 중...</div>

  const profitByAccount = optionAccounts.map(account => ({
    account,
    rows: profitData.filter(p => p.accountId === account.accountId).sort((a, b) => b.month.localeCompare(a.month)),
  }))
  const profitMonths = [...new Set(profitByAccount.flatMap(a => a.rows.map(r => r.month)))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">옵션 계좌 수익</h2>
        <span className="page-heading-sub">브로커 월별손익현황 직접입력 기준</span>
      </div>

      {optionAccounts.length === 0 ? (
        <div className="empty">계좌 관리에서 이름이 "선물옵션"인 계좌를 먼저 등록하세요.</div>
      ) : (
        <div className="card">
          <div className="section-header">
            <span className="section-title">월별손익</span>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {profitByAccount.map(a => {
                const total = a.rows.reduce((s, r) => s + r.profit, 0)
                return (
                  <span key={a.account.accountId} style={{ fontSize: 13 }}>
                    {a.account.name}({a.account.accountId}) 누적 손익 <b className={total >= 0 ? 'pos' : 'neg'}>{total >= 0 ? '+' : ''}{fmt(total)}원</b>
                  </span>
                )
              })}
            </div>
          </div>
          {profitMonths.length === 0 ? (
            <div className="empty">등록된 월별손익 데이터가 없습니다. 데이터 입력에서 브로커 월별손익현황을 붙여넣으세요.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>월</th>
                    {profitByAccount.map(a => (
                      <th key={a.account.accountId} className="r">{a.account.name}({a.account.accountId})</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profitMonths.map(month => (
                    <tr key={month}>
                      <td>{month}</td>
                      {profitByAccount.map(a => {
                        const r = a.rows.find(x => x.month === month)
                        return (
                          <td key={a.account.accountId} className={'r bold ' + (r ? (r.profit >= 0 ? 'pos' : 'neg') : 'dim')}>
                            {r ? `${r.profit >= 0 ? '+' : ''}${fmt(r.profit)}원` : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
