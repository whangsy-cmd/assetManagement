// 데이터 조회(DataView) 탭 공통 유틸/스타일. 각 Tab 컴포넌트가 여기서 import해서 씀.
import { useEffect, useState } from 'react'

export function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Number(n).toLocaleString()
}

// ── 날짜 검색 드롭다운 ──────────────────────────────────────
export function DateSelect({ id, dates, value, onChange }) {
  const [query, setQuery] = useState(value)

  useEffect(() => { setQuery(value) }, [value])

  return (
    <>
      <input
        list={id}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          if (dates.includes(e.target.value)) onChange(e.target.value)
        }}
        onFocus={() => setQuery('')}
        onBlur={() => setQuery(value)}
        style={styles.dateInput}
        placeholder="날짜 검색..."
      />
      <datalist id={id}>
        {dates.map(d => <option key={d} value={d} />)}
      </datalist>
    </>
  )
}

export const styles = {
  heading: { color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  backupBtn: { background: 'transparent', color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #1e293b', paddingBottom: 0 },
  tab: { background: 'transparent', color: '#64748b', border: 'none', borderBottom: '2px solid transparent', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 600, marginBottom: -1 },
  tabActive: { color: '#f1f5f9', borderBottomColor: '#3b82f6' },
  content: { background: '#1e293b', borderRadius: 12, padding: '20px' },
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  empty: { color: '#64748b', padding: 40, textAlign: 'center' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  dateRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  toolLabel: { color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },
  dateBtns: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  dateInput: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', fontSize: 13, width: 160, outline: 'none' },
  stockSelect: { background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', fontSize: 13, maxWidth: 260, outline: 'none' },
  toolRight: { display: 'flex', gap: 8 },
  exportBtn: { background: 'transparent', color: '#4ade80', border: '1px solid #14532d', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  dateDel: { background: 'transparent', color: '#fb923c', border: '1px solid #7c2d12', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  allDel: { background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '9px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '9px 12px', whiteSpace: 'nowrap' },
  code: { background: '#0f172a', padding: '2px 5px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' },
  rowDel: { background: 'transparent', color: '#ef4444', border: '1px solid #7f1d1d', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 11 },
}
