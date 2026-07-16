import { Routes, Route, NavLink } from 'react-router-dom';
import Upload from './pages/Upload.jsx';
import ReportList from './pages/ReportList.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import Weekly from './pages/Weekly.jsx';
import Products from './pages/Products.jsx';
import ProductDetail from './pages/ProductDetail.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>QA 产品测试生命周期</h1>
        <nav>
          <NavLink to="/" end>产品追踪</NavLink>
          <NavLink to="/upload">上传报告</NavLink>
          <NavLink to="/reports">历史报告</NavLink>
          <NavLink to="/weekly">周报</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Products />} />
          <Route path="/products/:productNo" element={<ProductDetail />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/reports" element={<ReportList />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
          <Route path="/weekly" element={<Weekly />} />
        </Routes>
      </main>
    </div>
  );
}
