import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Checkbox, Form, Input } from 'antd';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './login.css';

// 只记住用户名；密码不写入浏览器本地存储。
const REMEMBER_KEY = 'scp_login_remember';
function loadRemembered(): { username: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: string };
    if (!parsed.username) return null;
    // 自动清理旧版本可能遗留的 password 字段。
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: parsed.username }));
    return { username: parsed.username };
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const remembered = loadRemembered();

  const onFinish = async (values: { username: string; password: string; remember?: boolean }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      // 仅保存账号，避免密码以明文长期留在浏览器。
      if (values.remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: values.username }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      const from = (location.state as { from?: string })?.from ?? '/products';
      navigate(from, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-logo">核</div>
        <h1>车缝核价对比系统</h1>
        <div className="login-en">STITCHCOSTPRO</div>
        <div className="login-sub">请使用工厂账号登录</div>

        <Form
          onFinish={onFinish}
          size="large"
          layout="vertical"
          initialValues={{
            username: remembered?.username ?? 'admin',
            password: '',
            remember: !!remembered,
          }}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined style={{ opacity: 0.45 }} />} placeholder="账号" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ opacity: 0.45 }} />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>记住用户名</Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 4 }}>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 46 }}>
              登 录
            </Button>
          </Form.Item>
        </Form>

        <div className="login-foot">
          <span>v0.1 · 内网部署</span>
          <span>本厂 HQ</span>
        </div>
      </div>
    </div>
  );
}
