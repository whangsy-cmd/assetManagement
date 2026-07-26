import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import DataInput from './pages/DataInput'
import AccountSetup from './pages/AccountSetup'
import SectorManager from './pages/SectorManager'
import DataView from './pages/DataView'
import Migration from './pages/Migration'
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
        <Route path="/accounts" element={<AccountSetup />} />
        <Route path="/sectors" element={<SectorManager />} />
        <Route path="/migrate" element={<Migration />} />
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
