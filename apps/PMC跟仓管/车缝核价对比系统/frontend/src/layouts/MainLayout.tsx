import { LogoutOutlined } from '@ant-design/icons';
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { visibleMenus } from '../auth/permissions';
import { palette } from '../theme';

const { Header, Content } = Layout;

export default function MainLayout() {
  const { user, role, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const selectedMenu = visibleMenus(role).find((m) => location.pathname === m.key || location.pathname.startsWith(`${m.key}/`))?.key;

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingInline: 28,
          borderBottom: `1px solid ${palette.line}`,
          boxShadow: '0 1px 6px rgba(31,99,216,0.04)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        {/* 品牌 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginRight: 28 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: `linear-gradient(135deg, ${palette.blue}, #5b9bff)`,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 17,
              lineHeight: 1,
              boxShadow: '0 4px 12px rgba(47,127,240,0.35)',
            }}
          >
            核
          </div>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>车缝核价对比</div>
            <div style={{ fontSize: 9, letterSpacing: '0.16em', color: palette.inkSoft }}>STITCHCOSTPRO</div>
          </div>
        </div>

        {/* 横向菜单 */}
        <Menu
          mode="horizontal"
          selectedKeys={selectedMenu ? [selectedMenu] : []}
          items={visibleMenus(role).map((m) => ({ key: m.key, label: m.label }))}
          onClick={({ key }) => navigate(key)}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent', fontWeight: 500 }}
        />

        {/* 用户 */}
        <Dropdown
          menu={{
            items: [
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: '退出登录',
                onClick: () => {
                  logout();
                  navigate('/login');
                },
              },
            ],
          }}
        >
          <Space style={{ cursor: 'pointer' }}>
            <Avatar size="small" style={{ background: palette.blueSoft, color: palette.blueDark, fontWeight: 700 }}>
              {user.displayName?.[0] ?? 'U'}
            </Avatar>
            <Typography.Text>{user.displayName}</Typography.Text>
          </Space>
        </Dropdown>
      </Header>

      <Content>
        <div style={{ padding: '24px 28px 48px' }}>
          <Outlet />
        </div>
      </Content>
    </Layout>
  );
}
