// 데이터 입력 화면 — 탭별로 데이터입력/입출금내역/실현손익 관리 (탭 구현은 ./datainput/)
import { useState } from 'react'
import HoldingsInputTab from './datainput/HoldingsInputTab'
import AccountEvalInputTab from './datainput/AccountEvalInputTab'
import CashFlowsInputTab from './datainput/CashFlowsInputTab'
import RealizedProfitTab from './datainput/RealizedProfitTab'
import TransactionsInputTab from './datainput/TransactionsInputTab'
import { styles } from './dataview/shared'
import '../common.css'

const TABS = ['데이터입력', '입출금내역', '실현손익', '미래에셋 계좌평가 등록', '거래내역']

export default function DataInput() {
  const [tab, setTab] = useState(0)

  return (
    <div className="page">
      <div style={styles.headingRow}>
        <h2 style={styles.heading}>데이터 입력</h2>
      </div>

      <div style={styles.tabs}>
        {TABS.map((t, i) => (
          <button
            key={i}
            style={{ ...styles.tab, ...(i === tab ? styles.tabActive : {}) }}
            onClick={() => setTab(i)}
          >{t}</button>
        ))}
      </div>

      <div style={styles.content}>
        {tab === 0 && <HoldingsInputTab />}
        {tab === 1 && <CashFlowsInputTab />}
        {tab === 2 && <RealizedProfitTab />}
        {tab === 3 && <AccountEvalInputTab />}
        {tab === 4 && <TransactionsInputTab />}
      </div>
    </div>
  )
}
