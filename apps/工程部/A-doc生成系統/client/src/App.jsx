import { useState } from 'react';
import { Layout, Menu, Typography, Button } from 'antd';
import { UnorderedListOutlined, UploadOutlined, FileExcelOutlined, LogoutOutlined, FilePdfOutlined } from '@ant-design/icons';
import axios from 'axios';
import ProductList from './pages/ProductList';
import Upload from './pages/Upload';
import Login from './pages/Login';
import AdocPage from './pages/AdocPage';
import ExcelTranslatePage from './pages/ExcelTranslatePage';
import {
  initialPageFromStoredTranslationJob,
  readStoredTranslationJob,
  translationJobStorageKey,
} from './pages/excelTranslateState';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

// 生产环境部署在 /zouhuo/ 子路径下：API 请求必须带前缀，否则打到 core 服务
// （core 的 401 带 WWW-Authenticate: Basic，会让浏览器反复弹平台认证框）。
// 开发环境走 vite proxy 的 /api 前缀，不加 baseURL。
if (import.meta.env.PROD) {
  axios.defaults.baseURL = import.meta.env.BASE_URL.replace(/\/$/, '');
}

const PAGE_TITLES = {
  list: '走货明细列表',
  upload: '上传 Excel 文件处理',
  adoc: 'TOMY A-DOC 生成',
  'excel-translate': 'Excel 中英翻译',
};

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

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
  const [user, setUser] = useState(storedUser);
  const [page, setPage] = useState(() => initialPageFromStoredTranslationJob(
    readStoredTranslationJob(localStorage, translationJobStorageKey(storedUser())),
  ));
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'));

  const handleLogin = ({ user: loggedInUser }) => {
    setUser(loggedInUser);
    setPage(initialPageFromStoredTranslationJob(
      readStoredTranslationJob(localStorage, translationJobStorageKey(loggedInUser)),
    ));
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
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
    { key: 'excel-translate', icon: <FileExcelOutlined />, label: 'Excel 中英翻译' },
    { key: 'adoc', icon: <FilePdfOutlined />, label: 'A-DOC 生成' },
  ];

  const translationStorageKey = translationJobStorageKey(user);

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
            {PAGE_TITLES[page]}
          </Text>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {page === 'list'   && <ProductList onUpload={() => setPage('upload')} />}
          {page === 'upload' && <Upload onDone={() => setPage('list')} />}
          {page === 'excel-translate' && (
            <ExcelTranslatePage key={translationStorageKey} storageKey={translationStorageKey} />
          )}
          {page === 'adoc'   && <AdocPage />}
        </Content>
      </Layout>
    </Layout>
  );
}
