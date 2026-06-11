import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, apiUrl } from './api.js';
import Modal from './components/Modal.jsx';

const EMPTY = {
  workshop: '', item_code: '', mold: '',
  order_qty_pcs: '', order_qty_shots: '',
  quoted_capacity: '', actual_capacity: '',
  quote_price_usd: '', supplier_price_rmb: '', supplier_price_usd: '',
  supplier: '', pmc_follow: '',
  order_date: '', production_start: '', estimated_delivery: '',
  remark: '', status: 'open',
  net_outsource_output: '',   // 扣税后外发产值, PDF imports leave blank for manual entry
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
  const location = useLocation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [wsOrder, setWsOrder] = useState({});  // { '兴信A': 1, '兴信B': 2, '华登': 3 }
  const [scrollToId, setScrollToId] = useState(null);  // row to re-focus after save

  const load = () => {
    setLoading(true);
    return api.listOrders().then((data) => { setList(data); setLoading(false); });
  };

  // After list re-renders, scroll the target row into view (center).
  // Don't clear scrollToId until the DOM row actually exists (avoids racing the
  // initial empty render); if the list loaded but no match exists, give up.
  useEffect(() => {
    if (!scrollToId) return;
    const el = document.querySelector(`tr[data-order-id="${scrollToId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('row-flash');
      setTimeout(() => el.classList.remove('row-flash'), 1600);
      setScrollToId(null);
    } else if (list.length > 0 && !list.find((x) => x.id === scrollToId)) {
      setScrollToId(null);  // list loaded but id missing — abort
    }
    // else: list still loading; keep scrollToId, will retry on next render
  }, [list, scrollToId]);
  useEffect(() => {
    load();
    api.workshopOrder().then(setWsOrder).catch(() => {});
  }, []);

  // If we arrived from PDF Import with focusIds in nav state, queue a scroll-to.
  // The scrollToId useEffect already handles smooth-scroll + flash.
  useEffect(() => {
    const ids = location.state?.focusIds;
    if (ids && ids.length > 0) {
      setScrollToId(ids[0]);   // 滚到第一条新导入的；后续条目用闪烁高亮看到
      // Clear nav state so refresh doesn't re-scroll
      window.history.replaceState({}, '');
    }
  }, [location.state]);
  const workshopRank = (ws) => {
    if (!ws) return 999;
    return wsOrder[ws] ?? 998;
  };

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
    // Sort by workshop rank (兴信A → 兴信B → 华登 → 其他/空) then by created_at
    return matched.sort((a, b) => {
      const ra = workshopRank(a.workshop);
      const rb = workshopRank(b.workshop);
      if (ra !== rb) return ra - rb;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
  }, [list, q, supplierFilter, wsOrder]);

  // Display number with fixed decimals as a string (preserves trailing zeros in the input)
  const toFixedStr = (n, d) => (n === null || n === undefined || n === '') ? '' : Number(n).toFixed(d);

  const openNew = () => { setEditing({}); setForm(EMPTY); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      ...EMPTY,
      ...row,
      // Force 4-decimal display on price fields so 0.438 shows as 0.4380
      quote_price_usd:    toFixedStr(row.quote_price_usd, 4),
      supplier_price_rmb: toFixedStr(row.supplier_price_rmb, 4),
      supplier_price_usd: toFixedStr(row.supplier_price_usd, 4),
    });
  };

  const save = async () => {
    const body = { ...form };
    ['order_qty_pcs', 'order_qty_shots', 'quoted_capacity', 'actual_capacity',
     'quote_price_usd', 'supplier_price_rmb', 'supplier_price_usd']
      .forEach((k) => { body[k] = body[k] === '' ? null : Number(body[k]); });
    // Persist 扣税后外发产值 only if user provided a value; '' means "use default"
    if (body.net_outsource_output === '') delete body.net_outsource_output;
    else if (body.net_outsource_output !== null && body.net_outsource_output !== undefined) {
      body.net_outsource_output = Number(body.net_outsource_output);
    }
    let targetId;
    if (editing && editing.id) {
      await api.updateOrder(editing.id, body);
      targetId = editing.id;
    } else {
      const created = await api.createOrder(body);
      targetId = created && created.id;
    }
    setEditing(null);
    await load();
    if (targetId) setScrollToId(targetId);
  };

  const remove = async (row) => {
    if (!confirm(`删除 ${row.mold} ?`)) return;
    // Find the neighbor to focus after deletion so the view doesn't jump to top
    const idx = filtered.findIndex((x) => x.id === row.id);
    const neighbor = filtered[idx + 1] || filtered[idx - 1];
    await api.deleteOrder(row.id);
    await load();
    if (neighbor) setScrollToId(neighbor.id);
  };

  const exportAllExcel = () => {
    window.location.href = api.exportAllUrl();
  };

  const exportFilteredExcel = async () => {
    if (filtered.length === 0) { alert('当前筛选结果为空'); return; }
    const resp = await fetch(apiUrl('/api/outsource/orders/export.xlsx'), {
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
              const cls = isNewOrder(r.created_at) ? 'order-new' : '';
              return (
              <React.Fragment key={r.id}>
              {isBoundary && (
                <tr className="workshop-separator"><td colSpan={23}></td></tr>
              )}
              <tr className={cls} data-order-id={r.id}>
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
              </React.Fragment>
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
            <Field label="核价 $" type="text" inputMode="decimal" v={form.quote_price_usd} on={(v) => setForm({ ...form, quote_price_usd: v })} />
            <Field
              label="供应商外发价 ￥"
              type="text"
              inputMode="decimal"
              v={form.supplier_price_rmb}
              on={(v) => {
                const rmb = v === '' ? null : Number(v);
                const usd = (rmb !== null && isFinite(rmb) && rmb > 0) ? (rmb / 0.88).toFixed(4) : '';
                setForm({ ...form, supplier_price_rmb: v, supplier_price_usd: usd });
              }}
            />
            <Field
              label="供应商外发价 $（自动 = ￥ / 0.88）"
              type="text"
              inputMode="decimal"
              v={form.supplier_price_usd}
              on={(v) => setForm({ ...form, supplier_price_usd: v })}
            />
            <Field label="供应商" v={form.supplier} on={(v) => setForm({ ...form, supplier: v })} />
            <Field label="跟进 PMC" v={form.pmc_follow} on={(v) => setForm({ ...form, pmc_follow: v })} />
            <Field label="下单日期" type="date" v={form.order_date} on={(v) => setForm({ ...form, order_date: v })} />
            <Field label="上机时间" type="date" v={form.production_start} on={(v) => setForm({ ...form, production_start: v })} />
            <Field label="预计交货期" type="date" v={form.estimated_delivery} on={(v) => setForm({ ...form, estimated_delivery: v })} />
            <Field
              label="扣税后外发产值 (留空 = 自动按公式)"
              type="text"
              inputMode="decimal"
              v={form.net_outsource_output}
              on={(v) => setForm({ ...form, net_outsource_output: v })}
            />
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

function Field({ label, v, on, type = 'text', step, className, inputMode }) {
  return (
    <div className={'field ' + (className || '')}>
      <label>{label}</label>
      <input type={type} step={step} inputMode={inputMode} value={v ?? ''} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
