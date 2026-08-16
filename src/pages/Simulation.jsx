// 시뮬레이션 화면 — 탭별 리밸런싱/셰넌 시뮬레이션/종목 비교 (탭 구현은 각 컴포넌트)
import { useState } from 'react'
import { useTabParam } from '../hooks/useTabParam'
import RebalanceReport from './RebalanceReport'
import ShannonSimulation from './ShannonSimulation'
import StockComparison from './StockComparison'
import SymbolManageTab from './SymbolManageTab'
import '../common.css'

// 탭 목록과 아래 렌더 스위치(tab === i)의 순서가 반드시 일치해야 함
const TABS = ['리밸런싱', '셰넌 시뮬레이션', '종목 비교', '종목관리']

export default function Simulation() {
  const [tab, setTab] = useTabParam(TABS)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">시뮬레이션</h2>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button
            key={i}
            className={'tab' + (i === tab ? ' active' : '')}
            onClick={() => { setTab(i); setRefreshKey(k => k + 1) }}
          >{t}</button>
        ))}
      </div>

      <div key={`${tab}-${refreshKey}`}>
        {tab === 0 && <RebalanceReport />}
        {tab === 1 && <ShannonSimulation />}
        {tab === 2 && <StockComparison />}
        {tab === 3 && <SymbolManageTab />}
      </div>
    </div>
  )
}
