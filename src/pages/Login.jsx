import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')
    setLoading(true)
    try {
      await login()
    } catch (e) {
      console.error('Login error:', e)
      setError(`오류: ${e.code || e.message}`)
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>💼 자산관리</h1>
        <p style={styles.sub}>개인 투자 포트폴리오 관리 도구</p>
        <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} onClick={handleLogin} disabled={loading}>
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
            style={{ width: 20, marginRight: 10 }}
          />
          {loading ? '로그인 중...' : 'Google 계정으로 로그인'}
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
  },
  card: {
    background: '#1e293b',
    borderRadius: 16,
    padding: '48px 40px',
    textAlign: 'center',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
    minWidth: 320,
  },
  title: {
    color: '#f1f5f9',
    fontSize: 32,
    margin: '0 0 8px',
    fontWeight: 700,
  },
  sub: {
    color: '#94a3b8',
    marginBottom: 36,
    fontSize: 14,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    color: '#1e293b',
    border: 'none',
    borderRadius: 8,
    padding: '12px 24px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    transition: 'opacity 0.2s',
  },
  error: {
    color: '#f87171',
    fontSize: 13,
    marginTop: 16,
    wordBreak: 'break-all',
  },
}
