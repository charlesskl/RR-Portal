import { Routes, Route, NavLink } from 'react-router-dom';
import Upload from './pages/Upload.jsx';
import ReportList from './pages/ReportList.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import Weekly from './pages/Weekly.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>QA 测试报告周结系统</h1>
        <nav>
          <NavLink to="/" end>上传</NavLink>
          <NavLink to="/reports">历史报告</NavLink>
          <NavLink to="/weekly">周报</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/reports" element={<ReportList />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
          <Route path="/weekly" element={<Weekly />} />
        </Routes>
      </main>
    </div>
  );
}
