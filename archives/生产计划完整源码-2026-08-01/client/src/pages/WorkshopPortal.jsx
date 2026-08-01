import { useEffect, useState } from 'react';
import axios from 'axios';

const WORKSHOPS = [
  { key: 'A', label: 'A车间', color: '#1565c0', bg: 'linear-gradient(135deg,#1565c0,#1976d2)' },
  { key: 'B', label: 'B车间', color: '#e65100', bg: 'linear-gradient(135deg,#e65100,#f57c00)' },
  { key: 'C', label: '华登',  color: '#2e7d32', bg: 'linear-gradient(135deg,#2e7d32,#388e3c)' },
];

export default function WorkshopPortal({ onEnter }) {
  const [stats, setStats] = useState({});

  useEffect(() => {
    WORKSHOPS.forEach(async (ws) => {
      try {
        const res = await axios.get(`/api/orders`, { params: { workshop: ws.key, status: 'active' } });
        setStats(prev => ({ ...prev, [ws.key]: { active: res.data.length } }));
      } catch {
        setStats(prev => ({ ...prev, [ws.key]: { active: 0 } }));
      }
    });
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#f0f2f5',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>
          生产计划管理系统
        </div>
        <div style={{ fontSize: 16, color: '#666' }}>兴信塑胶制品有限公司 · 请选择车间</div>
      </div>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center', padding: '0 24px' }}>
        {WORKSHOPS.map(ws => {
          const s = stats[ws.key] || {};
          return (
            <div key={ws.key} style={{
              width: 280, borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)', background: '#fff',
              transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer',
            }}
              onClick={() => onEnter(ws.key)}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 16px 40px rgba(0,0,0,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.15)'; }}
            >
              <div style={{ background: ws.bg, padding: '24px', color: '#fff' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{ws.label}</div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>生产计划管理系统</div>
              </div>
              <div style={{ padding: '20px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: ws.color }}>{s.active ?? '-'}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>进行中订单</div>
              </div>
              <div style={{ padding: '0 24px 24px' }}>
                <button onClick={(e) => { e.stopPropagation(); onEnter(ws.key); }} style={{
                  width: '100%', padding: '12px 0', background: ws.bg, color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  进入{ws.label}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 48, color: '#aaa', fontSize: 13 }}>
        数据按车间独立隔离 · 局域网内任意设备均可访问
      </div>
    </div>
  );
}
