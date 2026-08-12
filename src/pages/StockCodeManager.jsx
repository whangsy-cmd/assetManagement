// 종목코드 관리 화면 — HTS 조회화면 붙여넣기로 종목코드/종목명을 섹터(sectors) 테이블에 일괄 등록
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getSectors, saveSector } from '../utils/firestore'
import '../common.css'

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

  if (loading) return <div className="loading">로딩 중...</div>

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>관심종목 복사, 종목코드, 종목명이 첫번째 컬럼이어야 함.</p>

      <textarea
        className="textarea"
        value={text}
        onChange={e => { setText(e.target.value); setRows(null); setError(''); setSavedMsg('') }}
        onPaste={handlePaste}
        placeholder="관심종목 복사"
        rows={8}
      />

      {error && <p className="text-error" style={{ marginTop: 8 }}>{error}</p>}
      {savedMsg && <p className="text-success" style={{ marginTop: 8 }}>{savedMsg}</p>}

      {rows && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label">파싱 결과 — {rows.length}건</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>종목코드</th>
                  <th>종목명</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><code className="code-chip">{r.code}</code></td>
                    <td>{r.name}</td>
                    <td>
                      {existingCodes.has(r.code)
                        ? <span className="text-muted">기존 (이름만 갱신)</span>
                        : <span className="pos">신규</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      )}
    </div>
  )
}
