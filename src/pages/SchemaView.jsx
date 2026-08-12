// DB 구조 화면 — Firestore 컬렉션별 필드/샘플 조회
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getAllDocsRaw } from '../utils/firestore'
import '../common.css'

// settings(키움 API 키 등 시크릿 포함)는 제외
const COLLECTIONS = ['accountEval', 'realizedProfits', 'transactions', 'holdings', 'accounts', 'sectors', 'loans', 'incomeReports', 'taxPayments', 'priceSeries', 'cashFlows', 'cash', 'snapshots', 'optionMonthlyProfit', 'tempAccountDailyBalance']
const SAMPLE_SIZE = 5

const DESCRIPTIONS = {
  accountEval: '계좌별 평가 (holdings+cash 합산 결과)',
  realizedProfits: '실현손익 (일자/계좌/종목코드/종목명/실현손익/수수료, 종목 없는 계좌단위 손익도 포함)',
  transactions: '거래내역 (매매/입출금 등 전체, 일자+종목+거래종류 동일건 합산)',
  holdings: '보유종목 (날짜별 계좌별 종목 수량/매입금액/평가금액)',
  accounts: '계좌 목록 (계좌번호, 계좌유형 등 설정)',
  sectors: '종목코드, 섹터 분류',
  loans: '대출금 목록',
  incomeReports: '연도별 이자·배당 소득 리포트',
  taxPayments: '세금납부내역 (납부일자/세목/납부세액)',
  priceSeries: '종목별 과거 일별 시세 캐시 (셰넌 시뮬레이션용)',
  cashFlows: '계좌별 입출금내역 — 2026/8/11 기준 더이상 사용안함',
  cash: '예수금 (날짜별 계좌별 잔액) — 2026/8/9 기준 더이상 사용안함',
  snapshots: '자산 스냅샷 (날짜별 국내/해외/연금 잔액, 총잔액, 대출, 순자산) — 2026/8/9 기준 더이상 사용안함',
  optionMonthlyProfit: '옵션계좌 월별 손익 (브로커 제공값 직접 입력) — 2026/8/9 기준 더이상 사용안함',
  tempAccountDailyBalance: '임시계좌일별잔고 (증권사 리포트 붙여넣기 이전용 임시 테이블) — 2026/8/9 기준 더이상 사용안함',
}

// CRUD 매트릭스 — 컬럼: 컬렉션(한글명/실제명), 로우: 메뉴 최하단 기능(카테고리순). 코드 감사 기준 수기 정리.
const CRUD_COLUMNS = [
  { label: '설정', col: 'settings' },
  { label: '계좌정보', col: 'accounts' },
  { label: '종목코드', col: 'sectors' },
  { label: '보유종목', col: 'holdings' },
  { label: '계좌평가', col: 'accountEval' },
  { label: '대출금', col: 'loans' },
  { label: '거래내역', col: 'transactions' },
  { label: '실현손익', col: 'realizedProfits' },
  { label: '이자배당', col: 'incomeReports' },
  { label: '세금', col: 'taxPayments' },
  { label: '종목시세', col: 'priceSeries' },
  { label: '입출금내역(미사용)', col: 'cashFlows' },
  { label: '예수금(미사용)', col: 'cash' },
  { label: '스냅샷(미사용)', col: 'snapshots' },
  { label: '옵션(미사용)', col: 'optionMonthlyProfit' },
  { label: '일별계좌(미사용)', col: 'tempAccountDailyBalance' },
]

const CRUD_ROWS = [
  { group: '대시보드', name: '대시보드', crud: { holdings: 'R', accounts: 'R', accountEval: 'R', sectors: 'R', settings: 'R', loans: 'R', realizedProfits: 'R' } },
  { group: '관리', name: '계좌 관리', crud: { accounts: 'CRUD', loans: 'CRUD', settings: 'CRU' } },
  { group: '관리', name: '섹터 관리', crud: { sectors: 'CRUD' } },
  { group: '관리', name: '종목코드 등록', crud: { sectors: 'CRU' } },
  { group: '입력', name: '계좌평가 입력', crud: { holdings: 'CU', accountEval: 'CU', sectors: 'R', loans: 'R', accounts: 'R' } },
  { group: '입력', name: '실현손익 입력', crud: { realizedProfits: 'CUD', sectors: 'R', accounts: 'R' } },
  { group: '입력', name: '거래내역 입력', crud: { transactions: 'CU', sectors: 'R', accounts: 'R' } },
  { group: '조회', name: '계좌통합 조회', crud: { accountEval: 'R', accounts: 'R' } },
  { group: '조회', name: '계좌평가 조회', crud: { accountEval: 'RD', transactions: 'R', realizedProfits: 'R' } },
  { group: '조회', name: '실현손익 조회', crud: { realizedProfits: 'RUD' } },
  { group: '조회', name: '보유종목', crud: { holdings: 'RD', accountEval: 'R', sectors: 'R' } },
  { group: '조회', name: '거래내역', crud: { transactions: 'RD', accounts: 'R' } },
  { group: '조회', name: '종목별 조회', crud: { transactions: 'R', realizedProfits: 'R' } },
  { group: '조회', name: '종목별 손익', crud: { transactions: 'R', realizedProfits: 'R', holdings: 'R' } },
  { group: '기타', name: '리밸런싱', crud: { holdings: 'R', accounts: 'R', accountEval: 'R', sectors: 'R', loans: 'R', settings: 'RU' } },
  { group: '기타', name: '셰넌 시뮬레이션', crud: { priceSeries: 'CRUD' } },
  { group: '기타', name: '이자·배당·세금', crud: { incomeReports: 'CRUD', taxPayments: 'CRUD' } },
  { group: '기타', name: '키움 테스트', crud: {} },
]

function CrudMatrix() {
  return (
    <div className="card">
      <h4 className="section-label">기능별 CRUD 매트릭스</h4>
      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr>
              <th style={{ borderRight: '1px dotted #334155' }}>기능</th>
              {CRUD_COLUMNS.map((c, i) => <th key={c.col} title={c.col} style={{ borderRight: i < CRUD_COLUMNS.length - 1 ? '1px dotted #334155' : undefined }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {CRUD_ROWS.map((row, i) => {
              const groupStart = i === 0 || row.group !== CRUD_ROWS[i - 1].group
              return (
                <tr key={row.name} style={{ borderTop: groupStart && i > 0 ? '2px solid #334155' : (i > 0 ? '1px dotted #334155' : undefined) }}>
                  <td style={{ borderRight: '1px dotted #334155' }}>{row.name}</td>
                  {CRUD_COLUMNS.map((c, ci) => (
                    <td key={c.col} className="dim" style={{ textAlign: 'center', fontFamily: 'monospace', borderRight: ci < CRUD_COLUMNS.length - 1 ? '1px dotted #334155' : undefined }}>{row.crud[c.col] || ''}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function getType(v) {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object' && typeof v.toDate === 'function') return 'timestamp'
  if (typeof v === 'object') return 'object'
  return typeof v
}

function formatValue(v) {
  const t = getType(v)
  if (t === 'null') return '-'
  if (t === 'timestamp') return v.toDate().toISOString()
  if (t === 'array' || t === 'object') return JSON.stringify(v)
  return String(v)
}

function buildSchema(docs) {
  const fields = new Map() // 필드명 → { type, sample }
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      if (k === 'docId' || fields.has(k)) continue
      fields.set(k, { type: getType(v), sample: formatValue(v) })
    }
  }
  return [...fields.entries()].map(([name, info]) => ({ name, ...info }))
}

function CollectionCard({ name }) {
  const { user } = useAuth()
  const [docs, setDocs] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && docs === null) {
      setLoading(true)
      const rows = await getAllDocsRaw(user.uid, name)
      setDocs(rows)
      setLoading(false)
    }
  }

  const schema = docs ? buildSchema(docs) : []
  const sample = docs ? docs.slice(0, SAMPLE_SIZE) : []
  const columns = sample.length ? [...new Set(sample.flatMap(d => Object.keys(d)))] : []

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button style={styles.cardHeader} onClick={toggle}>
        <span style={styles.cardTitle}>{name}</span>
        <span className="text-muted">{DESCRIPTIONS[name]}</span>
        <span style={styles.cardCount}>{docs !== null ? `${docs.length}개 문서` : ''}</span>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        loading ? <div className="loading">로딩 중...</div> :
        !docs.length ? <div className="empty">데이터 없음</div> : (
          <div style={styles.body}>
            <h4 className="section-label">필드 구조</h4>
            <div className="table-wrap" style={{ marginBottom: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>필드명</th>
                    <th>타입</th>
                    <th>샘플값</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.map(f => (
                    <tr key={f.name}>
                      <td><code className="code-chip">{f.name}</code></td>
                      <td>{f.type}</td>
                      <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.sample}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="section-label">샘플 데이터 ({sample.length}개)</h4>
            <div className="table-wrap" style={{ marginBottom: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {sample.map(d => (
                    <tr key={d.docId}>
                      {columns.map(c => <td key={c}>{formatValue(d[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}

export default function SchemaView() {
  return (
    <div className="page">
      <h2 className="page-heading">DB 구조 조회</h2>
      <p className="text-muted" style={{ margin: '8px 0 20px' }}>컬렉션별 필드 구조와 샘플 데이터입니다. 클릭해서 펼쳐보세요.</p>
      <CrudMatrix />
      {COLLECTIONS.map(c => <CollectionCard key={c} name={c} />)}
    </div>
  )
}

const styles = {
  cardHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', padding: '14px 20px', cursor: 'pointer', textAlign: 'left' },
  cardTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, fontFamily: 'monospace' },
  cardCount: { color: '#64748b', fontSize: 12, marginLeft: 'auto' },
  body: { padding: '0 20px 20px' },
}
