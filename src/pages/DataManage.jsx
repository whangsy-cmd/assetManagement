// 데이터 관리 화면 — 탭별로 계좌/섹터/종목코드 관리 (탭 구현은 별도 페이지 컴포넌트 재사용)
import { useState } from 'react'
import AccountSetup from './AccountSetup'
import SectorManager from './SectorManager'
import StockCodeManager from './StockCodeManager'
import { styles } from './dataview/shared'
import '../common.css'

const TABS = ['계좌 관리', '섹터 관리', '종목코드 등록']

export default function DataManage() {
  const [tab, setTab] = useState(0)

  return (
    <div className="page">
      <div style={styles.headingRow}>
        <h2 style={styles.heading}>데이터 관리</h2>
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
        {tab === 0 && <AccountSetup />}
        {tab === 1 && <SectorManager />}
        {tab === 2 && <StockCodeManager />}
      </div>
    </div>
  )
}
