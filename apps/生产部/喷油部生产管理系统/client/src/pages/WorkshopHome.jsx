import { useEffect, useState } from 'react';
import { Card, Button, Spin } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

// 不走全局 api(避免被拦截器加 workshop_id;此页本身就是没选 workshop)
const api = axios.create({ baseURL: '/api' });

export default function WorkshopHome() {
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data: workshops } = await api.get('/workshops');
        setList(workshops);
        const all = await Promise.all(workshops.map(w => api.get(`/workshops/${w.id}/stats`)));
        const m = {};
        workshops.forEach((w, i) => { m[w.id] = all[i].data; });
        setStats(m);
      } catch (e) {
        // ignore — display empty
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onEnter = (w) => {
    localStorage.setItem('workshop_id', String(w.id));
    localStorage.setItem('workshop_name', w.name);
    navigate('/products');
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', padding: '60px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, marginBottom: 8, color: '#262626' }}>
          <ShopOutlined style={{ marginRight: 12, color: '#1677ff' }} />
          喷油部生产管理系统
        </h1>
        <p style={{ color: '#8c8c8c', marginBottom: 48, fontSize: 14 }}>
          兴信塑胶制品有限公司 · 请选择车间
        </p>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {list.map(w => {
            const s = stats[w.id] || {};
            return (
              <Card
                key={w.id}
                style={{ width: 320, overflow: 'hidden', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{
                  background: w.color,
                  color: '#fff',
                  padding: '24px 20px',
                  textAlign: 'left',
                }}>
                  <h2 style={{ color: '#fff', margin: 0, fontSize: 28, fontWeight: 600 }}>
                    <ShopOutlined style={{ marginRight: 10 }} />
                    {w.name}
                  </h2>
                  <p style={{ color: '#fff', opacity: 0.85, marginTop: 6, marginBottom: 0, fontSize: 13 }}>
                    注塑啤机排产系统
                  </p>
                </div>
                <div style={{ padding: '20px 20px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16, padding: '8px 0' }}>
                    <Stat label="待排订单" value={s.pending_orders} />
                    <Stat label="机台数" value={s.machine_count} />
                  </div>
                  <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px', background: '#fafafa', borderRadius: 6 }}>
                    <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 4 }}>本月产值</div>
                    <div style={{ color: '#cf1322', fontSize: 22, fontWeight: 600 }}>
                      ¥{Number(s.monthly_output || 0).toFixed(2)}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    block
                    size="large"
                    onClick={() => onEnter(w)}
                    style={{ background: w.color, borderColor: w.color, height: 44, fontSize: 16 }}
                  >
                    进入 {w.name}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        <p style={{ marginTop: 48, color: '#bfbfbf', fontSize: 13 }}>
          数据按车间独立隔离 · 局域网内任意设备均可访问
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 28, fontWeight: 600, color: '#262626', lineHeight: 1.2 }}>
        {value ?? '-'}
      </div>
      <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>{label}</div>
    </div>
  );
}
