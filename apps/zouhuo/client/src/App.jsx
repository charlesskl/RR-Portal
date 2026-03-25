import { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Button } from 'antd';
import { UnorderedListOutlined, UploadOutlined, FileExcelOutlined, LogoutOutlined, FilePdfOutlined } from '@ant-design/icons';
import axios from 'axios';
import ProductList from './pages/ProductList';
import Upload from './pages/Upload';
import Login from './pages/Login';
import AdocPage from './pages/AdocPage';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

// axios 拦截器：自动带 token，401 时跳转登录
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default function App() {
  const [page, setPage] = useState('list');
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'));

  const handleLogin = () => {
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuthed(false);
  };

  if (!authed) {
    return <Login onLogin={handleLogin} />;
  }

  const menuItems = [
    {
      key: 'zouhuo',
      icon: <UnorderedListOutlined />,
      label: '走货明细',
      children: [
        { key: 'list',   icon: <UnorderedListOutlined />, label: '走货明细列表' },
        { key: 'upload', icon: <UploadOutlined />,        label: '上传处理' },
      ],
    },
    { key: 'adoc', icon: <FilePdfOutlined />, label: 'A-DOC 生成' },
  ];

  const user = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 12px' }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold', textAlign: 'center' }}>走货明细管理</Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={menuItems}
          onClick={({ key }) => setPage(key)}
        />
        <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, padding: '0 12px' }}>
          <Button
            block
            icon={<FileExcelOutlined />}
            style={{ background: '#145214', color: '#52c41a', borderColor: '#145214', marginBottom: 8 }}
            onClick={async () => {
              try {
                const res = await axios.get('/api/template', { responseType: 'blob' });
                const url = window.URL.createObjectURL(res.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = '走货明细模板.xlsx';
                a.click();
                window.URL.revokeObjectURL(url);
              } catch { /* ignore */ }
            }}
          >
            下载空白模板
          </Button>
          <Button
            block
            icon={<LogoutOutlined />}
            style={{ color: '#999', borderColor: '#333' }}
            onClick={handleLogout}
          >
            {user?.username || '退出'}
          </Button>
        </div>
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, color: '#333' }}>
            {page === 'list' ? '走货明细列表' : page === 'upload' ? '上传 Excel 文件处理' : 'TOMY A-DOC 生成'}
          </Text>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {page === 'list'   && <ProductList onUpload={() => setPage('upload')} />}
          {page === 'upload' && <Upload onDone={() => setPage('list')} />}
          {page === 'adoc'   && <AdocPage />}
        </Content>
      </Layout>
    </Layout>
  );
}
