// 데이터 조회 화면 — 탭별 원본 데이터 조회/삭제/백업 (탭 구현은 ./dataview/)
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import { useTabParam } from '../hooks/useTabParam'
import { getAllDocsRaw } from '../utils/firestore'
import HoldingsTab from './dataview/HoldingsTab'
import AccountEvalTab from './dataview/AccountEvalTab'
import SnapshotsTab from './dataview/SnapshotsTab'
import StockPeriodTab from './dataview/StockPeriodTab'
import StockProfitTab from './dataview/StockProfitTab'
import RealizedProfitTab from './dataview/RealizedProfitTab'
import TransactionsTab from './dataview/TransactionsTab'
import ConsistencyCheckTab from './dataview/ConsistencyCheckTab'
import '../common.css'

// 탭 목록과 아래 렌더 스위치(tab === i)의 순서가 반드시 일치해야 함
const TABS = ['계좌통합 조회', '계좌평가 조회', '실현손익 조회', '거래내역', '보유종목', '종목별 조회', '종목별 손익', '정합성 검사']

// 백업 대상 컬렉션. settings(키움 API 키 등 시크릿 포함)는 의도적으로 제외.
const BACKUP_COLLECTIONS = ['holdings', 'cash', 'snapshots', 'accounts', 'sectors', 'loans', 'incomeReports', 'taxPayments', 'priceSeries', 'cashFlows', 'optionMonthlyProfit', 'accountEval', 'tempAccountDailyBalance', 'realizedProfits', 'transactions']

// 중첩 객체/배열은 복원 시 그대로 복구할 수 있도록 JSON 문자열로 넣는다. 감사용 타임스탬프는 제외.
function flattenDoc(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'createdAt' || k === 'updatedAt') continue
    out[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v
  }
  return out
}

export default function DataView() {
  const { user } = useAuth()
  const [tab, setTab] = useTabParam(TABS)
  const [refreshKey, setRefreshKey] = useState(0)
  const [backingUp, setBackingUp] = useState(false)

  const handleFullBackup = async () => {
    setBackingUp(true)
    try {
      const wb = XLSX.utils.book_new()
      for (const col of BACKUP_COLLECTIONS) {
        const docs = await getAllDocsRaw(user.uid, col)
        const rows = docs.map(flattenDoc)
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), col)
      }
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      XLSX.writeFile(wb, `백업_전체데이터_${today}.xlsx`)
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <div className="page">
      <div className="page-heading-row">
        <h2 className="page-heading">데이터 조회</h2>
        <button className="btn btn-outline-blue" style={{ marginLeft: 'auto' }} onClick={handleFullBackup} disabled={backingUp}>
          {backingUp ? '백업 생성 중...' : '전체 백업 다운로드'}
        </button>
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

      <div className="card" key={`${tab}-${refreshKey}`}>
        {tab === 0 && <SnapshotsTab />}
        {tab === 1 && <AccountEvalTab />}
        {tab === 2 && <RealizedProfitTab />}
        {tab === 3 && <TransactionsTab />}
        {tab === 4 && <HoldingsTab />}
        {tab === 5 && <StockPeriodTab />}
        {tab === 6 && <StockProfitTab />}
        {tab === 7 && <ConsistencyCheckTab />}
      </div>
    </div>
  )
}
