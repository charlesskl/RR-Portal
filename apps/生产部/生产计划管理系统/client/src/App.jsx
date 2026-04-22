import { useState, useEffect } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import axios from 'axios';
import WorkshopPortal from './pages/WorkshopPortal';
import SchedulingSheet from './pages/SchedulingSheet';

const TABS = [
  { key: 'active', label: '在产订单' },
  { key: 'completed', label: '完成订单' },
  { key: 'cancel1', label: '取消单' },
  { key: 'outsource', label: '外发货号' },
  { key: 'cancel2', label: '取消订单' },
];

const WORKSHOP_NAMES = { A: 'A车间', B: 'B车间', C: '华登' };

export default function App() {
  const [workshop, setWorkshop] = useState(null);
  const [tab, setTab] = useState('active');
  const [lines, setLines] = useState([]);
  const [currentLine, setCurrentLine] = useState('all');
  const [editingLine, setEditingLine] = useState(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (!workshop) return;
    axios.get('/api/orders/lines', { params: { workshop } })
      .then(res => {
        setLines(res.data.lines || []);
        setCurrentLine('all');
      })
      .catch(() => setLines([]));
  }, [workshop]);

  if (!workshop) {
    return (
      <ConfigProvider locale={zhCN}>
        <WorkshopPortal onEnter={(ws) => { setWorkshop(ws); setTab('active'); }} />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{
          background: '#fff', padding: '0 24px', display: 'flex',
          alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          height: 48, position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div
            style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#1890ff', marginRight: 32 }}
            onClick={() => setWorkshop(null)}
          >
            ← 返回
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginRight: 32 }}>
            {WORKSHOP_NAMES[workshop]} · 生产计划
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map(t => (
              <div
                key={t.key}
                onClick={() => { setTab(t.key); setCurrentLine('all'); }}
                style={{
                  padding: '12px 20px', cursor: 'pointer', fontSize: 14,
                  borderBottom: tab === t.key ? '2px solid #1890ff' : '2px solid transparent',
                  color: tab === t.key ? '#1890ff' : '#666',
                  fontWeight: tab === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {tab === 'active' && lines.length > 0 && (
          <div style={{
            background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center',
            borderTop: '1px solid #f0f0f0', height: 40,
          }}>
            <span style={{ fontSize: 13, color: '#999', marginRight: 12 }}>拉：</span>
            <div
              key="all"
              onClick={() => setCurrentLine('all')}
              style={{
                padding: '8px 16px', cursor: 'pointer', fontSize: 13,
                borderBottom: currentLine === 'all' ? '2px solid #fa8c16' : '2px solid transparent',
                color: currentLine === 'all' ? '#fa8c16' : '#666',
                fontWeight: currentLine === 'all' ? 600 : 400,
              }}
            >全部</div>
            {lines.map(l => (
              <div
                key={l.key}
                onClick={() => setCurrentLine(l.key)}
                onDoubleClick={() => { setEditingLine(l.key); setEditName(l.name); }}
                style={{
                  padding: '8px 16px', cursor: 'pointer', fontSize: 13,
                  borderBottom: currentLine === l.key ? '2px solid #fa8c16' : '2px solid transparent',
                  color: currentLine === l.key ? '#fa8c16' : '#666',
                  fontWeight: currentLine === l.key ? 600 : 400,
                }}
              >
                {editingLine === l.key ? (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => {
                      axios.put('/api/orders/line-config', { workshop, lineKey: l.key, name: editName });
                      setLines(prev => prev.map(x => x.key === l.key ? { ...x, name: editName } : x));
                      setEditingLine(null);
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    style={{ width: 60, fontSize: 13, border: '1px solid #fa8c16', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
                  />
                ) : `${l.key}(${l.name})`}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '12px 16px' }}>
          <SchedulingSheet
            workshop={workshop}
            tab={tab}
            lineName={tab === 'active' ? currentLine : 'all'}
            lines={lines}
          />
        </div>
      </div>
    </ConfigProvider>
  );
}
