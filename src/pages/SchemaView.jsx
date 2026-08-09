import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getAllDocsRaw } from '../utils/firestore'

// settings(키움 API 키 등 시크릿 포함)는 제외
const COLLECTIONS = ['holdings', 'cash', 'snapshots', 'accounts', 'sectors', 'loans', 'incomeReports', 'priceSeries', 'cashFlows', 'optionMonthlyProfit', 'accountEval', 'tempAccountDailyBalance']
const SAMPLE_SIZE = 3

const DESCRIPTIONS = {
  holdings: '보유종목 (날짜별 계좌별 종목 수량/매입금액/평가금액)',
  cash: '예수금 (날짜별 계좌별 잔액)',
  snapshots: '자산 스냅샷 (날짜별 국내/해외/연금 잔액, 총잔액, 대출, 순자산) — 2026/8/9 기준 더이상 사용안함',
  accounts: '계좌 목록 (계좌번호, 카테고리 등 설정)',
  sectors: '종목별 섹터 분류',
  loans: '대출금 목록',
  incomeReports: '연도별 이자·배당 소득 리포트',
  priceSeries: '종목별 과거 일별 시세 캐시 (셰넌 시뮬레이션용)',
  cashFlows: '계좌별 입출금내역',
  optionMonthlyProfit: '옵션계좌 월별 손익 (브로커 제공값 직접 입력)',
  accountEval: '계좌별 평가 (holdings+cash 합산 결과, 계좌평가 이전 화면에서 생성)',
  tempAccountDailyBalance: '임시계좌일별잔고 (증권사 리포트 붙여넣기 이전용 임시 테이블)',
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
    <div style={styles.card}>
      <button style={styles.cardHeader} onClick={toggle}>
        <span style={styles.cardTitle}>{name}</span>
        <span style={styles.cardDesc}>{DESCRIPTIONS[name]}</span>
        <span style={styles.cardCount}>{docs !== null ? `${docs.length}개 문서` : ''}</span>
        <span style={{ color: '#64748b' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        loading ? <div style={styles.loading}>로딩 중...</div> :
        !docs.length ? <div style={styles.empty}>데이터 없음</div> : (
          <div style={styles.body}>
            <h4 style={styles.subheading}>필드 구조</h4>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>필드명</th>
                    <th style={styles.th}>타입</th>
                    <th style={styles.th}>샘플값</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.map(f => (
                    <tr key={f.name} style={styles.tr}>
                      <td style={styles.td}><code style={styles.code}>{f.name}</code></td>
                      <td style={styles.td}>{f.type}</td>
                      <td style={{ ...styles.td, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.sample}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={styles.subheading}>샘플 데이터 ({sample.length}개)</h4>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>{columns.map(c => <th key={c} style={styles.th}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {sample.map(d => (
                    <tr key={d.docId} style={styles.tr}>
                      {columns.map(c => <td key={c} style={styles.td}>{formatValue(d[c])}</td>)}
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
    <div style={styles.container}>
      <h2 style={styles.heading}>DB 구조 조회</h2>
      <p style={styles.desc}>컬렉션별 필드 구조와 샘플 데이터입니다. 클릭해서 펼쳐보세요.</p>
      {COLLECTIONS.map(c => <CollectionCard key={c} name={c} />)}
    </div>
  )
}

const styles = {
  container: { maxWidth: 1250, margin: '0 auto', padding: '24px 16px' },
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  desc: { color: '#64748b', fontSize: 13, margin: '8px 0 20px' },
  card: { background: '#1e293b', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  cardHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', padding: '14px 20px', cursor: 'pointer', textAlign: 'left' },
  cardTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, fontFamily: 'monospace' },
  cardDesc: { color: '#94a3b8', fontSize: 13 },
  cardCount: { color: '#64748b', fontSize: 12, marginLeft: 'auto' },
  body: { padding: '0 20px 20px' },
  subheading: { color: '#94a3b8', fontSize: 13, fontWeight: 600, margin: '12px 0 8px' },
  loading: { color: '#94a3b8', padding: '0 20px 20px' },
  empty: { color: '#64748b', padding: '0 20px 20px' },
  tableWrap: { overflowX: 'auto', marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '9px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '9px 12px', whiteSpace: 'nowrap' },
  code: { background: '#0f172a', padding: '2px 5px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' },
}
