// 라벨+입력 세로 배치 필드 — 리밸런싱/셰넌 시뮬레이션 설정 폼 공용
export default function InputField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#94a3b8' }}>
      {label}
      {children}
    </label>
  )
}

export const numInputStyle = {
  background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155',
  borderRadius: 6, padding: '5px 8px', fontSize: 13, width: 80,
}
