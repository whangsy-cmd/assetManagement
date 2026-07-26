import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import '../common.css'

const NAV = [
  { to: '/',         label: '대시보드' },
  { to: '/rebalance', label: '리밸런싱' },
  { to: '/shannon-sim', label: '셰넌 시뮬레이션' },
  { to: '/input',    label: '데이터 입력' },
  { to: '/dataview', label: '데이터 조회' },
  { to: '/accounts', label: '계좌 관리' },
  { to: '/sectors',  label: '섹터 관리' },
  { to: '/migrate',  label: '데이터 이전' },
  { to: '/income',   label: '이자·배당' },
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
          <span className="nav-email">{user?.email}</span>
          <button className="nav-logout" onClick={logout}>로그아웃</button>
        </div>
      </nav>
      <main className="layout-main">{children}</main>
    </div>
  )
}
