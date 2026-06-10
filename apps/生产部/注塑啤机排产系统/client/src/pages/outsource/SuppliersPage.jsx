import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import Modal from './components/Modal.jsx';

const EMPTY = {
  name: '', total_machines: '', machines_for_xx: '', actual_running: '',
  contact: '', address: '', mold_count: '', remark: '',
};

const fmt = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString();
const pct = (n) => (n === null || n === undefined || n === '') ? '' : (Number(n) * 100).toFixed(1) + '%';

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = () => {
    setLoading(true);
    api.listSuppliers().then((d) => { setList(d); setLoading(false); });
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return list;
    return list.filter((x) =>
      ['name', 'contact', 'address', 'remark'].some((k) => (x[k] || '').toString().toLowerCase().includes(kw))
    );
  }, [list, q]);

  const openNew = () => { setEditing({}); setForm(EMPTY); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row }); };

  const save = async () => {
    const body = { ...form };
    ['total_machines', 'machines_for_xx', 'actual_running', 'mold_count']
      .forEach((k) => { body[k] = body[k] === '' ? null : Number(body[k]); });
    // ratio & rate auto-derived
    if (body.total_machines > 0) {
      body.xx_ratio = body.machines_for_xx / body.total_machines;
      body.running_rate = (body.actual_running || 0) / body.total_machines;
    }
    if (editing && editing.id) await api.updateSupplier(editing.id, body);
    else await api.createSupplier(body);
    setEditing(null);
    load();
  };

  const remove = async (row) => {
    if (!confirm(`删除 ${row.name} ?`)) return;
    await api.deleteSupplier(row.id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">外发加工厂明细 <span className="badge">{filtered.length}</span></div>
        <div className="toolbar">
          <input className="search" placeholder="搜索：名称/联系人/地址/备注" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary" onClick={openNew}>+ 新增加工厂</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>加工厂名称</th>
              <th className="num">总机台</th>
              <th className="num">可生产兴信机台</th>
              <th className="num">机台占比</th>
              <th className="num">实际开机</th>
              <th className="num">开机率</th>
              <th>联系电话/联系人</th>
              <th>地址</th>
              <th className="num">啤货模具套数</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={11} className="empty">加载中...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={11} className="empty">暂无数据</td></tr>}
            {!loading && filtered.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td>
                <td className="num">{fmt(r.total_machines)}</td>
                <td className="num">{fmt(r.machines_for_xx)}</td>
                <td className="num">{pct(r.xx_ratio)}</td>
                <td className="num">{fmt(r.actual_running)}</td>
                <td className="num">{pct(r.running_rate)}</td>
                <td>{r.contact}</td>
                <td>{r.address}</td>
                <td className="num">{fmt(r.mold_count)}</td>
                <td>{r.remark}</td>
                <td>
                  <button className="ghost" onClick={() => openEdit(r)}>编辑</button>
                  <button className="ghost" onClick={() => remove(r)} style={{ color: '#b91c1c' }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={editing.id ? '编辑加工厂' : '新增加工厂'}
          onClose={() => setEditing(null)}
          footer={<>
            <button onClick={() => setEditing(null)}>取消</button>
            <button className="primary" onClick={save}>保存</button>
          </>}
        >
          <div className="form-grid">
            <Field label="加工厂名称" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <Field label="总机台数" type="number" v={form.total_machines} on={(v) => setForm({ ...form, total_machines: v })} />
            <Field label="可生产兴信机台数" type="number" v={form.machines_for_xx} on={(v) => setForm({ ...form, machines_for_xx: v })} />
            <Field label="实际开机台数" type="number" v={form.actual_running} on={(v) => setForm({ ...form, actual_running: v })} />
            <Field label="啤货模具套数" type="number" v={form.mold_count} on={(v) => setForm({ ...form, mold_count: v })} />
            <Field label="联系电话/联系人" v={form.contact} on={(v) => setForm({ ...form, contact: v })} />
            <Field className="full" label="地址" v={form.address} on={(v) => setForm({ ...form, address: v })} />
            <div className="field full">
              <label>备注</label>
              <textarea rows={2} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, v, on, type = 'text', className }) {
  return (
    <div className={'field ' + (className || '')}>
      <label>{label}</label>
      <input type={type} value={v ?? ''} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
