// 삭제 확인 모달 (텍스트 확인 필요 여부 옵션) — 여러 페이지 공용
import { useState } from 'react'
import '../common.css'

export default function DeleteModal({ title, count, requireConfirm, onConfirm, onCancel, loading }) {
  const [text, setText] = useState('')
  const canDelete = requireConfirm ? text === '삭제' : true
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>⚠️ {title}</h3>
        <p style={styles.modalCount}>
          <strong style={{ color: '#f87171' }}>{count}개</strong> 문서가 삭제됩니다.
        </p>
        {requireConfirm && (
          <>
            <p style={styles.modalGuide}>
              계속하려면 <strong style={{ color: '#f87171' }}>삭제</strong>를 입력하세요.
            </p>
            <input
              className="input"
              style={{ width: '100%', borderColor: '#ef4444', fontSize: 15, marginBottom: 20 }}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="삭제"
              autoFocus
            />
          </>
        )}
        <div style={styles.modalActions}>
          <button className="btn btn-outline" onClick={onCancel}>취소</button>
          <button
            className="btn btn-danger"
            style={{ opacity: canDelete ? 1 : 0.4, cursor: canDelete ? 'pointer' : 'not-allowed' }}
            onClick={() => canDelete && onConfirm()}
            disabled={!canDelete || loading}
            autoFocus={!requireConfirm}
          >
            {loading ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalCard: { background: '#1e293b', borderRadius: 14, padding: '32px', width: '100%', maxWidth: 400, boxShadow: '0 25px 50px rgba(0,0,0,0.6)' },
  modalTitle: { color: '#fca5a5', fontSize: 18, fontWeight: 700, marginBottom: 12 },
  modalCount: { color: '#e2e8f0', fontSize: 15, marginBottom: 12 },
  modalGuide: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
}
