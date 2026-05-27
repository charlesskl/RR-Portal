import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (n === null || n === undefined || n === '') ? '0' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function DashboardPage() {
  const [s, setS] = useState(null);
  const [editing, setEditing] = useState(null); // { name, value }

  const load = () => api.summary().then(setS);
  useEffect(() => { load(); }, []);

  if (!s) return <div className="empty">加载中...</div>;

  const supplierEntries = Object.entries(s.by_supplier || {}).sort((a, b) => b[1] - a[1]);

  const startEdit = (name) => setEditing({ name, value: name === '(空)' ? '' : name });
  const cancelEdit = () => setEditing(null);

  const commit = async () => {
    if (!editing) return;
    const from = editing.name;
    const to = editing.value.trim();
    if (!to) { alert('新名称不能为空'); return; }
    if (to === from) { setEditing(null); return; }
    const count = s.by_supplier[from] || 0;
    const verb = from === '(空)' ? `把 ${count} 条「无供应商」订单分配给「${to}」` : `把 ${count} 条订单的供应商从「${from}」改为「${to}」`;
    if (!confirm(verb + '，继续？\n\n（同时更新模具映射和加工厂明细里的同名记录）')) return;
    try {
      const r = await api.renameSupplier(from, to);
      alert(`完成：订单 ${r.orders_updated} 条、模具映射 ${r.mappings_updated} 条、加工厂明细 ${r.suppliers_updated} 条已更新`);
      setEditing(null);
      load();
    } catch (e) {
      alert('失败：' + e.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">概览</div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">外发订单总数</div><div className="value">{fmt(s.total)}</div></div>
        <div className="kpi"><div className="label">本厂产值合计 ($)</div><div className="value">{fmt(s.total_in_house_output)}</div></div>
        <div className="kpi"><div className="label">外发产值合计 ($)</div><div className="value">{fmt(s.total_outsource_output)}</div></div>
        <div className="kpi"><div className="label">扣税后外发产值 ($)</div><div className="value">{fmt(s.total_net_outsource_output)}</div></div>
      </div>

      <div className="section-title">
        按供应商订单分布
        <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 400, color: '#9ca3af' }}>
          双击供应商名可重命名（会批量更新订单 + 映射 + 加工厂明细）
        </span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 'unset' }}>
        <table>
          <thead><tr><th>供应商</th><th className="num">订单数</th><th>占比</th></tr></thead>
          <tbody>
            {supplierEntries.map(([name, count]) => {
              const pct = s.total > 0 ? (count / s.total * 100).toFixed(1) : '0';
              const isEditingThis = editing && editing.name === name;
              return (
                <tr key={name}>
                  <td>
                    {isEditingThis ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          placeholder={name === '(空)' ? '分配给哪家?' : '新名称'}
                          style={{ width: 140 }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <button className="primary" onClick={commit} style={{ padding: '4px 8px' }}>确定</button>
                        <button onClick={cancelEdit} style={{ padding: '4px 8px' }}>取消</button>
                      </span>
                    ) : (
                      <span
                        onDoubleClick={() => startEdit(name)}
                        style={{ cursor: 'pointer', userSelect: 'none', borderBottom: '1px dashed #cbd5e1', paddingBottom: 1 }}
                        title="双击重命名"
                      >
                        {name}
                      </span>
                    )}
                  </td>
                  <td className="num">{count}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, background: '#2563eb', height: '100%' }} />
                      </div>
                      <span style={{ minWidth: 50 }}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
