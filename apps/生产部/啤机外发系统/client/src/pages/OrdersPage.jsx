import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';

const EMPTY = {
  workshop: '', item_code: '', mold: '',
  order_qty_pcs: '', order_qty_shots: '',
  quoted_capacity: '', actual_capacity: '',
  quote_price_usd: '', supplier_price_rmb: '', supplier_price_usd: '',
  supplier: '', pmc_follow: '',
  order_date: '', production_start: '', estimated_delivery: '',
  remark: '', status: 'open',
};

const fmt = (n, digits = 2) => {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (!isFinite(num)) return '';
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
};

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const isNewOrder = (createdAt) => {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (!isFinite(t)) return false;
  return (Date.now() - t) < NEW_WINDOW_MS;
};

export default function OrdersPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    setLoading(true);
    api.listOrders().then((data) => { setList(data); setLoading(false); });
  };
  useEffect(load, []);

  const suppliers = useMemo(() => {
    const s = new Set(list.map((x) => x.supplier).filter(Boolean));
    return Array.from(s).sort();
  }, [list]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const matched = list.filter((x) => {
      if (supplierFilter && x.supplier !== supplierFilter) return false;
      if (!kw) return true;
      return ['mold', 'item_code', 'supplier', 'pmc_follow', 'workshop', 'remark']
        .some((k) => (x[k] || '').toString().toLowerCase().includes(kw));
    });
    // Sort by workshop (non-empty first, alphabetic), then created_at ascending
    // so newer imports go to the bottom of their workshop group.
    return matched.sort((a, b) => {
      const aw = a.workshop || '';
      const bw = b.workshop || '';
      if (!!aw !== !!bw) return aw ? -1 : 1;       // non-empty workshops first
      if (aw !== bw) return aw.localeCompare(bw, 'zh');
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
  }, [list, q, supplierFilter]);

  const openNew = () => { setEditing({}); setForm(EMPTY); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ ...EMPTY, ...row });
  };

  const save = async () => {
    const body = { ...form };
    ['order_qty_pcs', 'order_qty_shots', 'quoted_capacity', 'actual_capacity',
     'quote_price_usd', 'supplier_price_rmb', 'supplier_price_usd']
      .forEach((k) => { body[k] = body[k] === '' ? null : Number(body[k]); });
    if (editing && editing.id) await api.updateOrder(editing.id, body);
    else await api.createOrder(body);
    setEditing(null);
    load();
  };

  const remove = async (row) => {
    if (!confirm(`删除 ${row.mold} ?`)) return;
    await api.deleteOrder(row.id);
    load();
  };

  const exportAllExcel = () => {
    window.location.href = '/api/orders/export.xlsx';
  };

  const exportFilteredExcel = async () => {
    if (filtered.length === 0) { alert('当前筛选结果为空'); return; }
    const resp = await fetch('/api/orders/export.xlsx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: filtered }),
    });
    if (!resp.ok) { alert('导出失败：' + await resp.text()); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `外发明细_筛选_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">
          外发明细 <span className="badge">{filtered.length}</span>
          {(() => {
            const newCount = filtered.filter((x) => isNewOrder(x.created_at)).length;
            return newCount > 0 ? <span className="badge" style={{ background: '#fef9c3', color: '#92400e', marginLeft: 4 }}>{newCount} 条 24h 内新增</span> : null;
          })()}
        </div>
        <div className="toolbar">
          <input className="search" placeholder="搜索：模具/货号/供应商/PMC/备注" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">全部供应商</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={exportFilteredExcel}>📥 导出Excel（{filtered.length} 条）</button>
          <button onClick={exportAllExcel}>📥 导出全部</button>
          <button className="primary" onClick={openNew}>+ 新增订单</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num" style={{ width: 50 }}>序号</th>
              <th>车间</th>
              <th>货号</th>
              <th>模具</th>
              <th className="num">订单数(PCS)</th>
              <th className="num">订单数(啤)</th>
              <th className="num">报价产能</th>
              <th className="num">实际产能</th>
              <th className="num">预计天数</th>
              <th className="num">核价$</th>
              <th className="num">外发￥</th>
              <th className="num">外发$</th>
              <th>供应商</th>
              <th>跟进PMC</th>
              <th>下单日</th>
              <th>上机日</th>
              <th>交期</th>
              <th className="num">本厂产值</th>
              <th className="num">外发产值</th>
              <th className="num">供应商扣税产值</th>
              <th className="num">扣税后外发产值</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={23} className="empty">加载中...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={23} className="empty">暂无数据</td></tr>}
            {!loading && filtered.map((r, i) => {
              const prevWs = i > 0 ? (filtered[i - 1].workshop || '') : null;
              const isBoundary = i > 0 && (r.workshop || '') !== prevWs;
              const cls = [
                isNewOrder(r.created_at) ? 'order-new' : '',
                isBoundary ? 'workshop-boundary' : '',
              ].filter(Boolean).join(' ');
              return (
              <tr key={r.id} className={cls}>
                <td className="num">{i + 1}</td>
                <td>{r.workshop}</td>
                <td>{r.item_code}</td>
                <td>{isNewOrder(r.created_at) && <span className="new-badge">新</span>}{r.mold}</td>
                <td className="num">{fmt(r.order_qty_pcs, 0)}</td>
                <td className="num">{fmt(r.order_qty_shots, 0)}</td>
                <td className="num">{fmt(r.quoted_capacity, 0)}</td>
                <td className="num">{fmt(r.actual_capacity, 0)}</td>
                <td className="num">{fmt(r.estimated_days)}</td>
                <td className="num">{fmt(r.quote_price_usd, 4)}</td>
                <td className="num">{fmt(r.supplier_price_rmb, 2)}</td>
                <td className="num">{fmt(r.supplier_price_usd, 4)}</td>
                <td>{r.supplier}</td>
                <td>{r.pmc_follow}</td>
                <td>{r.order_date}</td>
                <td>{r.production_start}</td>
                <td>{r.estimated_delivery}</td>
                <td className="num">{fmt(r.in_house_output)}</td>
                <td className="num">{fmt(r.outsource_output)}</td>
                <td className="num">{fmt(r.supplier_tax_output)}</td>
                <td className="num">{fmt(r.net_outsource_output)}</td>
                <td>{r.remark}</td>
                <td>
                  <button className="ghost" onClick={() => openEdit(r)}>编辑</button>
                  <button className="ghost" onClick={() => remove(r)} style={{ color: '#b91c1c' }}>删除</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={editing.id ? '编辑订单' : '新增订单'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="primary" onClick={save}>保存</button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="车间" v={form.workshop} on={(v) => setForm({ ...form, workshop: v })} />
            <Field label="货号" v={form.item_code} on={(v) => setForm({ ...form, item_code: v })} />
            <Field className="full" label="模具" v={form.mold} on={(v) => setForm({ ...form, mold: v })} />
            <Field label="订单数量 (PCS)" type="number" v={form.order_qty_pcs} on={(v) => setForm({ ...form, order_qty_pcs: v })} />
            <Field label="订单数量 (啤)" type="number" v={form.order_qty_shots} on={(v) => setForm({ ...form, order_qty_shots: v })} />
            <Field label="报价日产能" type="number" v={form.quoted_capacity} on={(v) => setForm({ ...form, quoted_capacity: v })} />
            <Field label="实际产能" type="number" v={form.actual_capacity} on={(v) => setForm({ ...form, actual_capacity: v })} />
            <Field label="核价 $" type="number" step="0.0001" v={form.quote_price_usd} on={(v) => setForm({ ...form, quote_price_usd: v })} />
            <Field label="供应商外发价 ￥" type="number" step="0.0001" v={form.supplier_price_rmb} on={(v) => setForm({ ...form, supplier_price_rmb: v })} />
            <Field label="供应商外发价 $" type="number" step="0.0001" v={form.supplier_price_usd} on={(v) => setForm({ ...form, supplier_price_usd: v })} />
            <Field label="供应商" v={form.supplier} on={(v) => setForm({ ...form, supplier: v })} />
            <Field label="跟进 PMC" v={form.pmc_follow} on={(v) => setForm({ ...form, pmc_follow: v })} />
            <Field label="下单日期" type="date" v={form.order_date} on={(v) => setForm({ ...form, order_date: v })} />
            <Field label="上机时间" type="date" v={form.production_start} on={(v) => setForm({ ...form, production_start: v })} />
            <Field label="预计交货期" type="date" v={form.estimated_delivery} on={(v) => setForm({ ...form, estimated_delivery: v })} />
            <div className="field">
              <label>状态</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="open">进行中</option>
                <option value="done">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            <div className="field full">
              <label>备注</label>
              <textarea rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, padding: 10, background: '#f9fafb', borderRadius: 4, fontSize: 12, color: '#6b7280' }}>
            预计天数、本厂产值、外发产值、扣税后产值会按填入的数量、产能、价格自动计算。
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, v, on, type = 'text', step, className }) {
  return (
    <div className={'field ' + (className || '')}>
      <label>{label}</label>
      <input type={type} step={step} value={v ?? ''} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
