// 상단 네비게이션 + 페이지 레이아웃 뼈대
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import '../common.css'

const BUILD_TIME_KST = new Date(__BUILD_TIME__).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})

const NAV = [
  { to: '/',         label: '대시보드' },
  { to: '/input',    label: '데이터 입력' },
  { to: '/dataview', label: '데이터 조회' },
  { to: '/rebalance', label: '리밸런싱' },
  { to: '/shannon-sim', label: '셰넌 시뮬레이션' },
  { to: '/accounts', label: '계좌 관리' },
  { to: '/sectors',  label: '섹터 관리' },
  { to: '/income',   label: '이자·배당·세금' },
  { to: '/schema',   label: 'DB 구조' },
  { to: '/kiwoom-test', label: '키움 테스트' },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()

  return (
    <div className="layout-root">
      <nav className="layout-nav">
        <span className="nav-brand">💼 자산관리</span>
        <div className="nav-links">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              {n.label}
            </NavLink>
          ))}
        </div>
        <div className="nav-user">
          <span style={{ opacity: 0.6, fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>빌드 {BUILD_TIME_KST}</span>
          <span className="nav-email">{user?.email}</span>
          <button className="nav-logout" onClick={logout}>로그아웃</button>
        </div>
      </nav>
      <main className="layout-main">{children}</main>
    </div>
  )
}
