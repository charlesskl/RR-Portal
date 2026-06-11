import { useEffect, useState } from 'react';
import { Modal, Input, message } from 'antd';
import axios from 'axios';

const WORKSHOPS = [
  { key: 'A', label: 'A车间', color: '#1565c0', bg: 'linear-gradient(135deg,#1565c0,#1976d2)', icon: '🏭' },
  { key: 'B', label: 'B车间', color: '#e65100', bg: 'linear-gradient(135deg,#e65100,#f57c00)', icon: '🏭' },
  { key: 'C', label: '华登', color: '#2e7d32', bg: 'linear-gradient(135deg,#2e7d32,#388e3c)', icon: '🏭' },
];

export default function WorkshopPortal({ onEnter }) {
  const [stats, setStats] = useState({});
  const [loginWs, setLoginWs] = useState(null);     // 正在登录的车间 key
  const [password, setPassword] = useState('');
  const [logging, setLogging] = useState(false);

  const tryLogin = async () => {
    if (!loginWs) return;
    setLogging(true);
    try {
      const { data } = await axios.post('/api/auth/login', { workshop: loginWs, password });
      localStorage.setItem('paiji_token', data.token);
      localStorage.setItem('workshop', data.workshop);
      message.success('登录成功');
      setLoginWs(null); setPassword('');
      onEnter(data.workshop);
    } catch (e) {
      message.error(e.response?.data?.message || '登录失败');
    }
    setLogging(false);
  };

  useEffect(() => {
    WORKSHOPS.forEach(async (ws) => {
      try {
        const [ordersRes, machinesRes] = await Promise.all([
          axios.get(`/api/orders?workshop=${ws.key}&status=pending`),
          axios.get(`/api/machines?workshop=${ws.key}`),
        ]);
        setStats(prev => ({
          ...prev,
          [ws.key]: {
            pending: ordersRes.data.length,
            machines: machinesRes.data.length,
          },
        }));
      } catch (e) {
        setStats(prev => ({ ...prev, [ws.key]: { pending: 0, machines: 0 } }));
      }
    });
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f0f2f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* 标题区 */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>
          🏭 AI注塑啤机排产系统
        </div>
        <div style={{ fontSize: 16, color: '#666' }}>兴信塑胶制品有限公司 · 请选择车间</div>
      </div>

      {/* 车间卡片 */}
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center', padding: '0 24px' }}>
        {WORKSHOPS.map(ws => {
          const s = stats[ws.key] || {};
          return (
            <div key={ws.key} style={{
              width: 280,
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              background: '#fff',
              transition: 'transform 0.2s, box-shadow 0.2s',
              cursor: 'pointer',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 16px 40px rgba(0,0,0,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.15)'; }}
            >
              {/* 卡片头部 */}
              <div style={{ background: ws.bg, padding: '24px 24px 20px', color: '#fff' }}>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
                  {ws.icon} {ws.label}
                </div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>注塑啤机排产系统</div>
              </div>

              {/* 统计数字 */}
              <div style={{ padding: '20px 24px', display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: ws.color }}>
                    {s.pending ?? '-'}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>待排订单</div>
                </div>
                <div style={{ width: 1, background: '#f0f0f0' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#333' }}>
                    {s.machines ?? '-'}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>机台数量</div>
                </div>
              </div>

              {/* 进入按钮（点击 → 弹密码框） */}
              <div style={{ padding: '0 24px 24px' }}>
                <button
                  onClick={() => { setLoginWs(ws.key); setPassword(''); }}
                  style={{
                    width: '100%',
                    padding: '12px 0',
                    background: ws.bg,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: 1,
                  }}
                >
                  进入{ws.label}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 48, color: '#aaa', fontSize: 13 }}>
        数据按车间独立隔离 · 每个车间需密码登录
      </div>

      <Modal
        title={loginWs ? `登录 ${WORKSHOPS.find(w => w.key === loginWs)?.label}` : ''}
        open={!!loginWs}
        onCancel={() => { setLoginWs(null); setPassword(''); }}
        onOk={tryLogin}
        okText="登录"
        cancelText="取消"
        confirmLoading={logging}
        destroyOnClose
        afterOpenChange={(open) => {
          if (open) setTimeout(() => document.getElementById('ws-pwd')?.focus(), 100);
        }}
      >
        <Input.Password
          id="ws-pwd"
          placeholder="请输入车间密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onPressEnter={tryLogin}
          size="large"
        />
        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
          忘记密码请联系系统管理员
        </div>
      </Modal>
    </div>
  );
}
