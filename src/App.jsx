// 라우팅 설정 — 로그인 여부에 따라 Login 또는 페이지 레이아웃 렌더
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import DataInput from './pages/DataInput'
import DataView from './pages/DataView'
import DataManage from './pages/DataManage'
import SchemaView from './pages/SchemaView'
import KiwoomTest from './pages/KiwoomTest'
import IncomeReport from './pages/IncomeReport'
import RebalanceReport from './pages/RebalanceReport'
import ShannonSimulation from './pages/ShannonSimulation'

function PrivateRoutes() {
  const { user } = useAuth()

  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
        로딩 중...
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/input" element={<DataInput />} />
        <Route path="/dataview" element={<DataView />} />
        <Route path="/datamanage" element={<DataManage />} />
        <Route path="/schema" element={<SchemaView />} />
        <Route path="/kiwoom-test" element={<KiwoomTest />} />
        <Route path="/income" element={<IncomeReport />} />
        <Route path="/rebalance" element={<RebalanceReport />} />
        <Route path="/shannon-sim" element={<ShannonSimulation />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PrivateRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
