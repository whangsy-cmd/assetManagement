// 종목코드 관리 화면 — HTS 조회화면 붙여넣기로 종목코드/종목명을 섹터(sectors) 테이블에 일괄 등록
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getSectors, saveSector } from '../utils/firestore'

// 앞의 ' 기호는 항상 제거. 8컬럼 포맷(해외)은 ' 뒤 거래소 접두 2자리도 추가로 제거.
// 예: '233740 → 233740 (국내 6컬럼) / 'NYKORU → KORU (해외 8컬럼, NY 접두 제거)
function parseStockCodes(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim())
  const rows = []
  for (const line of lines) {
    const cols = line.split('\t')
    const rawCode = cols[0]?.trim()
    const name = cols[1]?.trim()
    if (!rawCode || !rawCode.startsWith("'") || !name) continue // 헤더줄 등 스킵
    let code = rawCode.slice(1)
    if (cols.length >= 8) code = code.slice(2)
    rows.push({ code, name })
  }
  return rows
}

export default function StockCodeManager() {
  const { user } = useAuth()
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const load = () => getSectors(user.uid).then(data => { setSectors(data); setLoading(false) })

  useEffect(() => { if (user) load() }, [user])

  const existingCodes = new Set(sectors.map(s => s.code))

  const parseText = (rawText) => {
    setError('')
    setSavedMsg('')
    const parsed = parseStockCodes(rawText)
    if (!parsed.length) { setError('파싱 결과가 없습니다. 종목코드/종목명이 포함된 화면을 복사했는지 확인하세요.'); setRows(null); return }
    setRows(parsed)
  }

  const handlePaste = (e) => {
    const rawText = e.clipboardData.getData('text')
    if (!rawText.trim()) return
    setTimeout(() => parseText(rawText), 0)
  }

  const handleSave = async () => {
    if (!rows || !rows.length) return
    setSaving(true)
    setError('')
    try {
      await Promise.all(rows.map(r =>
        saveSector(user.uid, existingCodes.has(r.code)
          ? { code: r.code, name: r.name }
          : { code: r.code, name: r.name, sector: '미분류', memo: '' }
        )
      ))
      setSavedMsg(`✅ ${rows.length}건 등록 완료`)
      setRows(null)
      setText('')
      await load()
    } catch (e) {
      setError('저장 오류: ' + e.message)
    }
    setSaving(false)
  }

  if (loading) return <div style={styles.loading}>로딩 중...</div>

  return (
    <div>
      <p style={styles.desc}>관심종목 복사, 종목코드, 종목명이 첫번째 컬럼이어야 함.</p>

      <textarea
        style={styles.textarea}
        value={text}
        onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
        onPaste={handlePaste}
        placeholder="관심종목 복사"
        rows={8}
      />

      {error && <p style={styles.error}>{error}</p>}
      {savedMsg && <p style={styles.saved}>{savedMsg}</p>}

      {rows && (
        <div style={styles.preview}>
          <p style={styles.previewTitle}>파싱 결과 — {rows.length}건</p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>종목코드</th>
                  <th style={styles.th}>종목명</th>
                  <th style={styles.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={styles.tr}>
                    <td style={styles.td}><code style={styles.code}>{r.code}</code></td>
                    <td style={styles.td}>{r.name}</td>
                    <td style={styles.td}>
                      {existingCodes.has(r.code)
                        ? <span style={{ color: '#94a3b8' }}>기존 (이름만 갱신)</span>
                        : <span style={{ color: '#4ade80' }}>신규</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  loading: { color: '#94a3b8', padding: 40, textAlign: 'center' },
  desc: { color: '#94a3b8', fontSize: 13, marginBottom: 14, lineHeight: 1.6 },
  textarea: { width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' },
  error: { color: '#f87171', fontSize: 13, marginTop: 8 },
  saved: { color: '#4ade80', fontSize: 13, marginTop: 8 },
  preview: { marginTop: 16 },
  previewTitle: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#0f172a', color: '#64748b', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { color: '#e2e8f0', padding: '7px 10px', whiteSpace: 'nowrap' },
  code: { background: '#0f172a', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' },
  saveBtn: { background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 14, marginTop: 14 },
}
