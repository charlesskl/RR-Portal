import { MemoryRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { DashboardOutlined, ProfileOutlined, UploadOutlined, BlockOutlined, BankOutlined } from '@ant-design/icons';
import DashboardPage from './DashboardPage.jsx';
import OrdersPage from './OrdersPage.jsx';
import PdfImportPage from './PdfImportPage.jsx';
import MoldFactoryPage from './MoldFactoryPage.jsx';
import SuppliersPage from './SuppliersPage.jsx';
import './outsource.css';

const { Sider, Content } = Layout;

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: 'orders',    icon: <ProfileOutlined />,  label: '外发明细' },
  { key: 'import',    icon: <UploadOutlined />,   label: 'PDF 导入' },
  { key: 'molds',     icon: <BlockOutlined />,    label: '模具分布' },
  { key: 'suppliers', icon: <BankOutlined />,     label: '加工厂明细' },
];

function OutsourceLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const seg = location.pathname.split('/').filter(Boolean)[0] || 'orders';

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: 'transparent' }}>
      <Sider theme="light" width={160} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0' }}>
        <Menu
          mode="inline"
          selectedKeys={[seg]}
          items={menuItems}
          onClick={({ key }) => navigate('/' + key)}
          style={{ background: 'transparent', borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <Content style={{ padding: 16, background: '#fff' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/import" element={<PdfImportPage />} />
          <Route path="/molds" element={<MoldFactoryPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
        </Routes>
      </Content>
    </Layout>
  );
}

export default function OutsourceModule() {
  return (
    <MemoryRouter initialEntries={['/orders']}>
      <OutsourceLayout />
    </MemoryRouter>
  );
}
