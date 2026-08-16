// 데이터 입력 화면 — 탭별로 데이터입력/실현손익/거래내역 관리 (탭 구현은 ./datainput/)
import { useTabParam } from '../hooks/useTabParam'
import HoldingsInputTab from './datainput/HoldingsInputTab'
import RealizedProfitTab from './datainput/RealizedProfitTab'
import TransactionsInputTab from './datainput/TransactionsInputTab'
import '../common.css'

const TABS = ['계좌평가', '거래내역', '실현손익']

export default function DataInput() {
  const [tab, setTab] = useTabParam(TABS)

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">데이터 입력</h2>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button
            key={i}
            className={'tab' + (i === tab ? ' active' : '')}
            onClick={() => setTab(i)}
          >{t}</button>
        ))}
      </div>

      <div className="card card-flat">
        {tab === 0 && <HoldingsInputTab />}
        {tab === 1 && <TransactionsInputTab />}
        {tab === 2 && <RealizedProfitTab />}
      </div>
    </div>
  )
}
