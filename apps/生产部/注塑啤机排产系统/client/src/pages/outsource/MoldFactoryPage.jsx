import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const fmt = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString();

export default function MoldFactoryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);   // { mold_code, current_supplier }
  const [collapsed, setCollapsed] = useState({}); // { supplierName: bool }
  const [supplierOptions, setSupplierOptions] = useState([]);

  const load = () => {
    setLoading(true);
    Promise.all([api.moldFactoryMap(), api.listSuppliers()]).then(([d, s]) => {
      setData(d);
      setSupplierOptions(s.map((x) => x.name).filter(Boolean));
      setLoading(false);
    });
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!data) return null;
    const kw = q.trim().toLowerCase();
    if (!kw) return data.suppliers;
    return data.suppliers
      .map((sup) => ({
        ...sup,
        molds: sup.molds.filter((m) =>
          (m.mold_code || '').toLowerCase().includes(kw) ||
          (m.mold_name || '').toLowerCase().includes(kw) ||
          sup.name.toLowerCase().includes(kw)
        ),
      }))
      .filter((sup) => sup.molds.length > 0);
  }, [data, q]);

  const reassign = async (mold, newSupplier) => {
    if (!newSupplier || newSupplier === mold.supplier) { setEditing(null); return; }
    await api.updateMoldMapping(mold.mold_code, { supplier: newSupplier });
    setEditing(null);
    load();
  };

  const editTarget = async (mold) => {
    const v = prompt(`修改「${mold.mold_code}」目标数（留空清除）：`, mold.target_qty ?? '');
    if (v === null) return;
    await api.updateMoldMapping(mold.mold_code, { target_qty: v === '' ? null : Number(v) });
    load();
  };

  const removeMapping = async (mold) => {
    if (!confirm(`确认取消「${mold.mold_code}」的加工厂分配？\n该操作只清除映射记忆，不影响已入库的订单数据。`)) return;
    await api.deleteMoldMapping(mold.mold_code);
    load();
  };

  if (loading || !data) return <div className="empty">加载中...</div>;

  const totalMapped = data.suppliers.reduce((a, s) => a + (s.name === '(未分配)' ? 0 : s.mold_count), 0);
  const unassigned = data.suppliers.find((s) => s.name === '(未分配)')?.mold_count || 0;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">加工厂模具分布</div>
        <div className="toolbar">
          <input
            className="search"
            placeholder="搜索：模具号 / 品名 / 加工厂"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button onClick={load}>↻ 刷新</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">已分配加工厂的模具</div><div className="value">{totalMapped}</div></div>
        <div className="kpi"><div className="label">未分配模具</div><div className="value" style={{ color: unassigned > 0 ? '#b91c1c' : '#111827' }}>{unassigned}</div></div>
        <div className="kpi"><div className="label">加工厂数量</div><div className="value">{data.suppliers.filter((s) => s.name !== '(未分配)').length}</div></div>
        <div className="kpi"><div className="label">模具总数</div><div className="value">{data.total_molds}</div></div>
      </div>

      <datalist id="mfp-supplier-options">
        {supplierOptions.map((s) => <option key={s} value={s} />)}
      </datalist>

      {filtered.length === 0 && <div className="empty">没有匹配的记录</div>}

      {filtered.map((sup) => {
        const isCollapsed = collapsed[sup.name];
        const totalShots = sup.molds.reduce((a, m) => a + (m.total_shots || 0), 0);
        return (
          <div key={sup.name} className="factory-card">
            <div className="factory-header" onClick={() => setCollapsed({ ...collapsed, [sup.name]: !isCollapsed })}>
              <div>
                <span className="factory-name" style={{ color: sup.name === '(未分配)' ? '#b91c1c' : '#111827' }}>
                  {sup.name === '(未分配)' ? '⚠️ 未分配' : '🏭 ' + sup.name}
                </span>
                <span className="factory-badge">{sup.mold_count} 套模</span>
                {totalShots > 0 && <span className="factory-badge" style={{ background: '#eff6ff', color: '#1e40af' }}>累计 {fmt(totalShots)} 啤</span>}
              </div>
              <span style={{ color: '#9ca3af' }}>{isCollapsed ? '▶' : '▼'}</span>
            </div>
            {!isCollapsed && (
              <div className="table-wrap" style={{ maxHeight: 'unset', borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>模具编号</th>
                      <th>品名</th>
                      <th className="num">目标数</th>
                      <th className="num">关联订单</th>
                      <th className="num">累计啤数</th>
                      <th>最近订单</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sup.molds.map((m) => (
                      <tr key={m.mold_code}>
                        <td><b>{m.mold_code}</b>{!m.mapped && <span title="此模未在映射表中，仅从历史订单推断" style={{ marginLeft: 6, color: '#9ca3af', fontSize: 11 }}>(推断)</span>}</td>
                        <td>{m.mold_name || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td className="num">
                          {m.target_qty !== null && m.target_qty !== undefined ? fmt(m.target_qty) : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td className="num">{m.order_count}</td>
                        <td className="num">{fmt(m.total_shots)}</td>
                        <td>{m.latest_date || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                        <td>
                          {editing?.mold_code === m.mold_code ? (
                            <ReassignInput
                              defaultValue={m.supplier === '(未分配)' ? '' : m.supplier}
                              options={supplierOptions}
                              onConfirm={(v) => reassign(m, v)}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <>
                              <button className="ghost" onClick={() => setEditing({ mold_code: m.mold_code })}>换厂</button>
                              <button className="ghost" onClick={() => editTarget(m)}>改目标</button>
                              {m.mapped && <button className="ghost" onClick={() => removeMapping(m)} style={{ color: '#b91c1c' }}>清除映射</button>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReassignInput({ defaultValue, options, onConfirm, onCancel }) {
  const [v, setV] = useState(defaultValue || '');
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        list="mfp-supplier-options"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="选/输入加工厂"
        style={{ width: 130 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm(v);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button className="primary" onClick={() => onConfirm(v)} style={{ padding: '4px 8px' }}>确定</button>
      <button onClick={onCancel} style={{ padding: '4px 8px' }}>取消</button>
    </span>
  );
}
