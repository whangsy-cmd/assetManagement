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

// 데이터입력 화면 항목 ↔ DB 컬럼 매핑 — 코드(DataInput.jsx 하위 탭) 감사 기준 수기 정리.
const INPUT_MAPPING = [
  {
    tab: '계좌평가', card: '계좌평가 수기 등록 (AccountEvalManualCard)',
    rows: [
      { label: '계좌', db: 'accountEval.accountId' },
      { label: '날짜', db: 'accountEval.date' },
      { label: '종목평가금액', db: 'accountEval.evalAmt' },
      { label: '예수금', db: 'accountEval.cashAmt' },
      { label: '총평가금액', db: 'accountEval.totalAmt', calc: 'evalAmt + cashAmt' },
    ],
  },
  {
    tab: '계좌평가', card: '브로커 붙여넣기 · API조회 — 보유종목/예수금 (6단계 스텝)',
    rows: [
      { label: '기준 날짜(공통)', db: 'holdings.date' },
      { label: '계좌', db: 'holdings.accountId' },
      { label: '종목코드', db: 'holdings.code', api: 'KR: stk_cd(선두 A 제거) · US: stk_cd' },
      { label: '종목명', db: 'holdings.name', api: 'KR: stk_nm · US: frgn_stk_nm' },
      { label: '수량', db: 'holdings.qty', api: 'KR: rmnd_qty · US: poss_qty' },
      { label: '매입금액', db: 'holdings.purchaseAmt', api: 'KR: pur_amt · US: frgn_stk_book_amt_krw' },
      { label: '평가금액', db: 'holdings.evalAmt', api: 'KR: evlt_amt · US: evlt_amt_krw' },
      { label: '손익', db: 'holdings.gainLoss', api: 'KR: evltv_prft · US: pl_amt_krw' },
      { label: '수익률', db: 'holdings.returnRate', api: 'KR: prft_rt · US: pl_rt' },
      { label: '브로커', db: 'holdings.broker' },
      { label: '(자동집계) 종목평가금액', db: 'accountEval.evalAmt', calc: '같은 date+accountId의 holdings.evalAmt 합계' },
      { label: '(자동집계) 예수금', db: 'accountEval.cashAmt', api: 'KR: 100stk_ord_alow_amt · US: d2_won_conv_alow_ch', calc: '같은 date+accountId 예수금액(붙여넣기/API 값, 중간값 — 별도 컬렉션에 저장 안 됨) 합계' },
      { label: '(자동집계) 합계', db: 'accountEval.totalAmt', calc: 'evalAmt + cashAmt' },
      { label: '(자동집계) 대출금 가상계좌', db: 'accountEval.cashAmt/totalAmt (accountId=대출금 가상계좌ID)', calc: '-Σ loans.amount, evalAmt는 항상 0' },
    ],
    note: '미래에셋은 API 없음(붙여넣기 전용). accountEval 4행은 화면 입력칸이 따로 없고, "저장 + 계좌별평가 등록" 클릭 시 holdings·예수금·loans로부터 자동 계산되어 holdings와 별개로 저장됨.',
  },
  {
    tab: '거래내역', card: '브로커 거래내역 붙여넣기 · API조회 (PasteTxCard)',
    rows: [
      { label: '계좌(선택/고정)', db: 'transactions.accountId' },
      { label: '날짜', db: 'transactions.date', api: 'KR: cntr_dt(체결일, 없으면 trde_dt)' },
      { label: '거래종류', db: 'transactions.type', api: 'KR: rmrk_nm' },
      { label: '종목명', db: 'transactions.name', api: 'KR: stk_nm' },
      { label: '종목코드', db: 'transactions.code', api: 'KR: stk_cd(선두 A 제거)' },
      { label: '통화', db: 'transactions.currency', api: 'KR: crnc_cd' },
      { label: '수량', db: 'transactions.qty', api: 'KR: trde_qty_jwa_cnt' },
      { label: '단가', db: 'transactions.price', api: 'KR: trde_unit' },
      { label: '거래금액', db: 'transactions.amount', api: 'KR: trde_amt' },
      { label: '수수료', db: 'transactions.fee', api: 'KR: cmsn' },
      { label: '세금', db: 'transactions.tax', api: 'KR: trde_agri_tax + incm_resi_tax' },
      { label: '청산손익', db: 'transactions.profit', calc: '선물옵션 등 결제행에 손익이 찍히는 포맷만 값 존재 (붙여넣기 파서 자체 계산)' },
      { label: '(파생) 실현손익 원화환산', db: 'realizedProfits.realizedProfit', calc: 'transactions.profit이 있을 때만: Math.trunc(currency===USD ? profit × 당일 환율 : profit)' },
      { label: '(파생) 실현손익 수수료', db: 'realizedProfits.fee', calc: 'Math.trunc(currency===USD ? transactions.fee × 당일 환율 : transactions.fee)' },
    ],
    note: 'API 자동조회는 키움국내만 지원 — 키움해외/미래에셋/선물옵션(국내·해외)은 붙여넣기 전용. realizedProfits 파생 등록은 저장(등록) 버튼 클릭 시 handleSave에서 함께 처리',
  },
  {
    tab: '거래내역', card: '이체입금/출금 등록 (TransferEntryCard)',
    rows: [
      { label: '계좌', db: 'transactions.accountId' },
      { label: '날짜', db: 'transactions.date' },
      { label: '종류', db: 'transactions.type' },
      { label: '통화', db: 'transactions.currency' },
      { label: '금액', db: 'transactions.amount' },
    ],
  },
  {
    tab: '실현손익', card: '계좌·포맷별 붙여넣기 · API조회 (RealizedProfitCard)',
    rows: [
      { label: '계좌(선택/고정)', db: 'realizedProfits.accountId' },
      { label: '일자', db: 'realizedProfits.date', api: 'KR: dt(영업일보정) · US: sell_dt(영업일보정)' },
      { label: '종목코드', db: 'realizedProfits.code', api: 'KR: stk_cd · US: stk_cd' },
      { label: '종목명', db: 'realizedProfits.name', api: 'KR: stk_nm · US: frgn_stk_nm' },
      { label: '수량', db: 'realizedProfits.qty', api: 'KR: cntr_qty · US: sell_qty' },
      { label: '거래금액', db: 'realizedProfits.sellAmount', api: 'KR: cntr_pric × cntr_qty · US: sell_amt' },
      { label: '청산손익', db: 'realizedProfits.liquidationProfit', api: 'US: pl_amt (KR은 필드 없음)' },
      { label: '수수료', db: 'realizedProfits.fee', api: 'KR: tdy_trde_cmsn · US: cmsn_tax(세금 합산)' },
      { label: '세금', db: 'realizedProfits.tax', api: 'KR: tdy_trde_tax (US는 수수료에 합산돼 별도 없음)' },
      { label: '적용환율', db: 'realizedProfits.exrt', api: 'US: sell_exrt (KR은 원화 그대로라 없음)' },
      { label: '실현손익(원)', db: 'realizedProfits.realizedProfit', api: 'KR: tdy_sel_pl · US: pl_amt × sell_exrt(반올림)' },
    ],
    note: 'API 자동조회는 키움국내/키움해외만 지원 — 미래에셋/옵션계좌손익(국내·해외)은 붙여넣기 전용',
  },
  {
    tab: '실현손익', card: '직접 입력 — 정해진 포맷 없는 계좌 (ManualEntryCard)',
    rows: [
      { label: '계좌', db: 'realizedProfits.accountId' },
      { label: '일자', db: 'realizedProfits.date' },
      { label: '실현손익', db: 'realizedProfits.realizedProfit' },
    ],
    note: '0 입력 시 등록 대신 해당 일자/계좌 문서 삭제',
  },
]

function InputFieldMapping() {
  return (
    <div className="card">
      <h4 className="section-label">데이터입력 항목 ↔ DB 컬럼 매핑</h4>
      {INPUT_MAPPING.map((section, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <p className="text-muted" style={{ margin: '10px 0 6px', fontSize: 13 }}>
            [{section.tab}] {section.card}
          </p>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>화면 입력 항목</th>
                  <th>DB 컬럼 (컬렉션.필드)</th>
                  <th>API 응답 필드 (자동조회 시)</th>
                  <th>계산식 (1:1 아닌 경우)</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map(r => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td><code className="code-chip">{r.db}</code></td>
                    <td>{r.api ? <code className="code-chip">{r.api}</code> : <span className="text-muted">-</span>}</td>
                    <td>{r.calc ? <span>{r.calc}</span> : <span className="text-muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.note && <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>※ {section.note}</p>}
        </div>
      ))}
    </div>
  )
}

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
      <InputFieldMapping />
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
