// 데이터 조회(DataView) 탭 공통 유틸. 스타일은 common.css 클래스 사용 (.page-heading, .tabs/.tab, .table-wrap/.data-table 등).
import { useEffect, useState } from 'react'
import '../../common.css'

export function fmt(n) {
  if (n === undefined || n === null) return '-'
  return Math.round(Number(n)).toLocaleString()
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
        className="input input-sm"
        style={{ width: 160 }}
        placeholder="날짜 검색..."
      />
      <datalist id={id}>
        {dates.map(d => <option key={d} value={d} />)}
      </datalist>
    </>
  )
}
