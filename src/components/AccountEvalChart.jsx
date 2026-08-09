// 계좌별평가(accountEval) 기반 총자산 변동 추이 스택 영역 차트 (Dashboard/계좌평가이전 공용)
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#84cc16']

// 스택 순서 (아래→위): 선물옵션 → 연금 등 나머지 → 국내 → 해외
const CATEGORY_RANK = { '선물옵션': 0, '연금': 1, '국내': 2, '해외': 3 }
function categoryRank(label) {
  return CATEGORY_RANK[label] ?? 1.5
}

function fmtAbbrev(n) {
  if (n === undefined || n === null) return '-'
  const abs = Math.abs(n), sign = n < 0 ? '-' : ''
  if (abs >= 1e8) return sign + (abs / 1e8).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString() + '만'
  return n.toLocaleString()
}

// 계좌별 총액(totalAmt)을 유형(카테고리)별로 합산해 날짜 기준으로 피벗한 스택 영역 차트 데이터 생성
// 예탁금 없거나 0인 (날짜,계좌)는 제외 — 해당 계좌는 그 날 합계에 포함 안 함
function buildChartData(rows, startDate, categoryOf) {
  const filtered = rows.filter(r => (!startDate || r.date >= startDate) && r.totalAmt)
  const keyOf = r => categoryOf ? categoryOf(r.accountId) : r.accountId
  const groups = [...new Set(filtered.map(keyOf))]
    .sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
  const byDateGroup = new Map()
  for (const r of filtered) {
    const key = `${r.date}_${keyOf(r)}`
    byDateGroup.set(key, (byDateGroup.get(key) || 0) + r.totalAmt)
  }
  const dates = [...new Set(filtered.map(r => r.date))].sort()
  const data = dates.map(date => {
    const point = { date }
    for (const group of groups) {
      const v = byDateGroup.get(`${date}_${group}`)
      if (v) point[group] = v
    }
    return point
  })
  return { data, groups }
}

function AccountEvalTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0)
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>
      {payload.filter(p => p.value).map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: '2px 0' }}>{p.dataKey}: {p.value.toLocaleString()}원</p>
      ))}
      <p style={{ color: '#f1f5f9', borderTop: '1px solid #334155', marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
        합계: {total.toLocaleString()}원
      </p>
    </div>
  )
}

// 계좌별평가(accountEval) 테이블 rows를 계좌 유형(카테고리)별 스택 영역 차트로 표시.
// categoryOf(accountId)를 넘기면 유형별로 합산, 안 넘기면 계좌별로 그대로 표시.
export default function AccountEvalChart({ rows, startDate, categoryOf, title = '총자산 변동 추이 (유형별)', height = 260 }) {
  const { data, groups } = buildChartData(rows, startDate, categoryOf)
  if (!data.length) return null

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h3 style={styles.title}>{title}</h3>
        <div style={styles.legend}>
          {groups.map((g, i) => (
            <span key={g} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: CHART_COLORS[i % CHART_COLORS.length] }} />{g}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={d => d.slice(5)} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={fmtAbbrev} width={60} />
          <Tooltip content={<AccountEvalTooltip />} />
          {groups.map((g, i) => (
            <Area
              key={g}
              type="monotone"
              dataKey={g}
              stackId="1"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeOpacity={0.5}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              fillOpacity={0.5}
              strokeWidth={1}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  card: { background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  title: { color: '#f1f5f9', fontSize: 15, fontWeight: 700, margin: 0 },
  legend: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#94a3b8' },
  legendDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
}
