import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { App as AntApp, ConfigProvider, Spin } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './layouts/AppLayout'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { PERMISSION_MODULES, type ModuleKey } from './auth/permissions'

const CustomersPage    = lazy(() => import('./pages/CustomersPage'))
const DictionariesPage = lazy(() => import('./pages/DictionariesPage'))
const ProductsPage     = lazy(() => import('./pages/ProductsPage'))
const QuotesPage       = lazy(() => import('./pages/QuotesPage'))
const PurchasePage     = lazy(() => import('./pages/PurchasePage'))
const OutboundPage     = lazy(() => import('./pages/OutboundPage'))
const MoldingPosPage   = lazy(() => import('./pages/MoldingPosPage'))
const SchedulesPage    = lazy(() => import('./pages/SchedulesPage'))
const ShipmentsPage    = lazy(() => import('./pages/ShipmentsPage'))
const DbAdminPage      = lazy(() => import('./pages/DbAdminPage'))
const LoginPage        = lazy(() => import('./pages/LoginPage'))
const UsersPage        = lazy(() => import('./pages/UsersPage'))

const Fallback = <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>

function RequireLogin({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.loading) return Fallback
  return auth.session ? children : <Navigate to="/login" state={{ from: location.pathname }} replace />
}

function ModuleRoute({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const auth = useAuth()
  if (!auth.canAccess(module)) return <Navigate to="/" replace />
  return children
}

function HomeRedirect() {
  const auth = useAuth()
  const first = PERMISSION_MODULES.find(m => auth.canAccess(m.key))
  return <Navigate to={first?.path || (auth.isAdmin ? '/users' : '/login')} replace />
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <AntApp>
      <BrowserRouter>
        <AuthProvider>
        <Suspense fallback={Fallback}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireLogin><AppLayout /></RequireLogin>}>
              <Route index element={<HomeRedirect />} />
              <Route path="customers"    element={<ModuleRoute module="customers"><CustomersPage /></ModuleRoute>} />
              <Route path="dictionaries" element={<ModuleRoute module="products"><DictionariesPage /></ModuleRoute>} />
              <Route path="products"     element={<ModuleRoute module="products"><ProductsPage /></ModuleRoute>} />
              <Route path="quotes"       element={<ModuleRoute module="quotes"><QuotesPage /></ModuleRoute>} />
              <Route path="purchase"     element={<ModuleRoute module="purchase"><PurchasePage /></ModuleRoute>} />
              <Route path="molding-pos"  element={<ModuleRoute module="molding"><MoldingPosPage /></ModuleRoute>} />
              <Route path="schedules"    element={<ModuleRoute module="schedules"><SchedulesPage /></ModuleRoute>} />
              <Route path="shipments"    element={<ModuleRoute module="shipments"><ShipmentsPage /></ModuleRoute>} />
              <Route path="outbound"     element={<ModuleRoute module="outbound"><OutboundPage /></ModuleRoute>} />
              <Route path="users"        element={<AdminRoute><UsersPage /></AdminRoute>} />
              <Route path="db-admin"     element={<AdminRoute><DbAdminPage /></AdminRoute>} />
              <Route path="*" element={<HomeRedirect />} />
            </Route>
          </Routes>
        </Suspense>
        </AuthProvider>
      </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  )
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  return auth.isAdmin ? children : <Navigate to="/" replace />
}
