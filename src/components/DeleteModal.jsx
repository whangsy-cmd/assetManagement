// 삭제 확인 모달 (텍스트 확인 필요 여부 옵션) — 여러 페이지 공용
import { useState } from 'react'

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
              style={styles.modalInput}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="삭제"
              autoFocus
            />
          </>
        )}
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>취소</button>
          <button
            style={{ ...styles.modalDelBtn, opacity: canDelete ? 1 : 0.4, cursor: canDelete ? 'pointer' : 'not-allowed' }}
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
  modalInput: { width: '100%', background: '#0f172a', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 12px', color: '#f1f5f9', fontSize: 15, marginBottom: 20, boxSizing: 'border-box' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14 },
  modalDelBtn: { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 700 },
}
