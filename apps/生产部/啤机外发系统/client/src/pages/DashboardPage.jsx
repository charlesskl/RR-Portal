import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n) => (n === null || n === undefined || n === '') ? '0' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function DashboardPage() {
  const [s, setS] = useState(null);

  useEffect(() => {
    api.summary().then(setS);
  }, []);

  if (!s) return <div className="empty">加载中...</div>;

  const supplierEntries = Object.entries(s.by_supplier || {}).sort((a, b) => b[1] - a[1]);

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

      <div className="section-title">按供应商订单分布</div>
      <div className="table-wrap" style={{ maxHeight: 'unset' }}>
        <table>
          <thead><tr><th>供应商</th><th className="num">订单数</th><th>占比</th></tr></thead>
          <tbody>
            {supplierEntries.map(([name, count]) => {
              const pct = s.total > 0 ? (count / s.total * 100).toFixed(1) : '0';
              return (
                <tr key={name}>
                  <td>{name}</td>
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
