import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import OrdersPage from './pages/OrdersPage.jsx';
import SuppliersPage from './pages/SuppliersPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import OrderPrintPage from './pages/OrderPrintPage.jsx';
import OrdersPrintListPage from './pages/OrdersPrintListPage.jsx';
import PdfImportPage from './pages/PdfImportPage.jsx';
import MoldFactoryPage from './pages/MoldFactoryPage.jsx';
import { useLocation } from 'react-router-dom';

export default function App() {
  const location = useLocation();
  const isPrint = location.pathname.startsWith('/print');

  if (isPrint) {
    return (
      <Routes>
        <Route path="/print/order/:id" element={<OrderPrintPage />} />
        <Route path="/print/orders" element={<OrdersPrintListPage />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">啤机外发系统</div>
        <nav className="nav">
          <NavLink to="/dashboard" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>概览</NavLink>
          <NavLink to="/orders" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>外发明细</NavLink>
          <NavLink to="/import" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>PDF 导入</NavLink>
          <NavLink to="/molds" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>模具分布</NavLink>
          <NavLink to="/suppliers" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>加工厂明细</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/import" element={<PdfImportPage />} />
          <Route path="/molds" element={<MoldFactoryPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
        </Routes>
      </main>
    </div>
  );
}
