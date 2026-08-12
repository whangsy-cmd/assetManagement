// 데이터 관리 화면 — 탭별로 계좌/섹터/종목코드 관리 (탭 구현은 별도 페이지 컴포넌트 재사용)
import { useState } from 'react'
import AccountSetup from './AccountSetup'
import SectorManager from './SectorManager'
import StockCodeManager from './StockCodeManager'
import '../common.css'

const TABS = ['계좌 관리', '섹터 관리', '종목코드 등록']

export default function DataManage() {
  const [tab, setTab] = useState(0)

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">데이터 관리</h2>
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

      <div className="card">
        {tab === 0 && <AccountSetup />}
        {tab === 1 && <SectorManager />}
        {tab === 2 && <StockCodeManager />}
      </div>
    </div>
  )
}
