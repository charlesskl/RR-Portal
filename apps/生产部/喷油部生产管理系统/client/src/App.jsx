import { Layout, Menu, Button } from 'antd';
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { AppstoreOutlined, TableOutlined, DollarOutlined, ProfileOutlined, FormOutlined } from '@ant-design/icons';
import Products from './pages/Products';
import WageStandards from './pages/WageStandards';
import Orders from './pages/Orders';
import Ledger from './pages/Ledger';
import DailyRecords from './pages/DailyRecords';
import WorkshopHome from './pages/WorkshopHome';

const { Header, Sider, Content } = Layout;

const items = [
  { key: '/products', icon: <AppstoreOutlined />, label: <Link to="/products">核价表</Link> },
  { key: '/wage-standards', icon: <DollarOutlined />, label: <Link to="/wage-standards">标准价表</Link> },
  { key: '/orders', icon: <ProfileOutlined />, label: <Link to="/orders">排产</Link> },
  { key: '/daily-records', icon: <FormOutlined />, label: <Link to="/daily-records">每日录入</Link> },
  { key: '/ledger', icon: <TableOutlined />, label: <Link to="/ledger">收支表</Link> },
];

function RequireWorkshop({ children }) {
  const wid = localStorage.getItem('workshop_id');
  if (!wid) return <Navigate to="/" replace />;
  return children;
}

function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const workshopName = localStorage.getItem('workshop_name') || '';
  const selectedKey = items.find(i => location.pathname.startsWith(i.key))?.key || '/products';

  const onChangeWorkshop = () => {
    localStorage.removeItem('workshop_id');
    localStorage.removeItem('workshop_name');
    navigate('/');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>
          喷油部 · {workshopName} 车间
        </span>
        <Button onClick={onChangeWorkshop}>换车间</Button>
      </Header>
      <Layout>
        <Sider width={200} style={{ background: '#fff' }}>
          <Menu mode="inline" selectedKeys={[selectedKey]} style={{ height: '100%', borderRight: 0 }} items={items} />
        </Sider>
        <Layout style={{ padding: 24 }}>
          <Content style={{ background: '#fff', padding: 24, minHeight: 280 }}>
            <Routes>
              <Route path="/products" element={<RequireWorkshop><Products /></RequireWorkshop>} />
              <Route path="/wage-standards" element={<RequireWorkshop><WageStandards /></RequireWorkshop>} />
              <Route path="/orders" element={<RequireWorkshop><Orders /></RequireWorkshop>} />
              <Route path="/daily-records" element={<RequireWorkshop><DailyRecords /></RequireWorkshop>} />
              <Route path="/ledger" element={<RequireWorkshop><Ledger /></RequireWorkshop>} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}

function App() {
  const location = useLocation();
  // 首页 / 不渲染主 Layout
  if (location.pathname === '/') {
    return <Routes><Route path="/" element={<WorkshopHome />} /></Routes>;
  }
  return <MainLayout />;
}

export default App;
