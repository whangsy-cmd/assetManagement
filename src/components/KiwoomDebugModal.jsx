// API 자동조회 실패/빈 결과 시 원인 파악용 — 최근 Kiwoom API 요청/응답 로그를 팝업으로 표시, 클립보드 복사 가능
import { useState } from 'react'
import { getKiwoomCallLog } from '../utils/kiwoomApi'

export default function KiwoomDebugModal({ open, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!open) return null

  const log = getKiwoomCallLog()
  const last = log.at(-1)
  const text = JSON.stringify(last, null, 2)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h4 className="section-label">최근 API 요청/응답</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={handleCopy}>{copied ? '복사됨' : '클립보드 복사'}</button>
            <button className="btn btn-outline btn-sm" onClick={onClose}>닫기</button>
          </div>
        </div>
        <pre style={styles.pre}>{last ? text : '기록된 호출이 없습니다.'}</pre>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16, width: '80vw', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pre: { color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, overflow: 'auto' },
}
