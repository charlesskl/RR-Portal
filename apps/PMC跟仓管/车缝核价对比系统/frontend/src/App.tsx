import { lazy, Suspense } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import RequireRole from './auth/RequireRole';
import MainLayout from './layouts/MainLayout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const QualityPage = lazy(() => import('./pages/QualityPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SupplierEvaluationDetailPage = lazy(() => import('./pages/SupplierEvaluationDetailPage'));
const PreviewPage = lazy(() => import('./pages/PreviewPage'));
const PriceBoardPage = lazy(() => import('./pages/PriceBoardPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

export default function App() {
  const routerBase = import.meta.env.BASE_URL === '/'
    ? undefined
    : import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <AuthProvider>
      <BrowserRouter basename={routerBase}>
        <Suspense fallback={<div style={{ padding: 32 }}>正在加载…</div>}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* 模块一 UI 预览（免登录，静态假数据，确认布局用） */}
          {import.meta.env.DEV && <Route path="/preview" element={<PreviewPage />} />}
          <Route element={<MainLayout />}>
            <Route path="/price-board" element={<RequireRole><PriceBoardPage /></RequireRole>} />
            <Route path="/products" element={<RequireRole><ProductsPage /></RequireRole>} />
            <Route path="/suppliers" element={<RequireRole><SuppliersPage /></RequireRole>} />
            <Route path="/orders" element={<RequireRole><OrdersPage /></RequireRole>} />
            <Route path="/quality" element={<RequireRole><QualityPage /></RequireRole>} />
            <Route path="/dashboard" element={<RequireRole><DashboardPage /></RequireRole>} />
            <Route path="/dashboard/:supplierId" element={<RequireRole><SupplierEvaluationDetailPage /></RequireRole>} />
            <Route path="/users" element={<RequireRole><UsersPage /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/products" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
