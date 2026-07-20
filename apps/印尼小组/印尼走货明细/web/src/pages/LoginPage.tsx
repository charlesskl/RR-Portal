import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const auth = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  if (auth.session) return <Navigate to="/" replace />

  async function submit(v: { username: string; password: string }) {
    setLoading(true); setError('')
    try {
      await auth.login(v.username, v.password)
      nav((location.state as any)?.from || '/', { replace: true })
    } catch (e: any) {
      setError(e?.response?.data?.error || '用户名或密码错误')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#eef5ff,#f8fafc)' }}>
      <Card style={{ width: 400, boxShadow: '0 18px 48px rgba(31,75,153,.15)' }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>印尼走货明细</Typography.Title>
        <Typography.Text type="secondary">请使用分配的账户登录</Typography.Text>
        {error && <Alert type="error" message={error} showIcon style={{ marginTop: 18 }} />}
        <Form layout="vertical" onFinish={submit} style={{ marginTop: 20 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input prefix={<UserOutlined />} autoFocus /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
        </Form>
      </Card>
    </div>
  )
}
