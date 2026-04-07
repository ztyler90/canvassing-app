import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { SessionProvider } from './contexts/SessionContext.jsx'
import Login             from './screens/Login.jsx'
import RepHome           from './screens/RepHome.jsx'
import ActiveCanvassing  from './screens/ActiveCanvassing.jsx'
import SessionSummary    from './screens/SessionSummary.jsx'
import ManagerDashboard  from './screens/ManagerDashboard.jsx'

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />

  if (!user) return (
    <Routes>
      <Route path="*" element={<Login />} />
    </Routes>
  )

  if (user.role === 'manager') return (
    <Routes>
      <Route path="/manager" element={<ManagerDashboard />} />
      <Route path="*" element={<Navigate to="/manager" replace />} />
    </Routes>
  )

  // Rep routes (wrapped with SessionProvider for live session state)
  return (
    <SessionProvider>
      <Routes>
        <Route path="/"           element={<RepHome />} />
        <Route path="/canvassing" element={<ActiveCanvassing />} />
        <Route path="/summary"    element={<SessionSummary />} />
        <Route path="*"           element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: '#1A6B3A' }}>
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
