import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReports, deleteReport, listCustomers } from '../api.js';

export default function ReportList() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [filterCustomer, setFilterCustomer] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const r = await listReports(filterCustomer);
      setList(r.list || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { listCustomers().then(r => setCustomers(r.list || [])); }, []);
  useEffect(() => { refresh(); }, [filterCustomer]);

  async function onDelete(id) {
    if (!window.confirm('确认删除这条报告记录？')) return;
    await deleteReport(id);
    refresh();
  }

  return (
    <div className="page">
      <h2>历史报告</h2>
      <div className="form-row">
        <label>按客户筛选：</label>
        <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
          <option value="">全部客户</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="hint">共 {list.length} 条</span>
      </div>
      {loading && <p className="hint">加载中…</p>}
      {!loading && list.length === 0 && (
        <p className="hint">暂无记录，去 <Link to="/">上传</Link> 一份吧。</p>
      )}
      {!loading && list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>客户</th>
                <th>文件名</th>
                <th>归属周</th>
                <th>上传时间</th>
                <th>有效行</th>
                <th>不合格</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id}>
                  <td><b>{r.customerName}</b></td>
                  <td><Link to={`/reports/${r.id}`}>{r.originalName}</Link></td>
                  <td>{r.weekKey}</td>
                  <td>{new Date(r.uploadedAt).toLocaleString('zh-CN')}</td>
                  <td>{r.totalRows}</td>
                  <td style={{ color: '#dc2626', fontWeight: 'bold' }}>{r.failCount}</td>
                  <td><button className="btn-danger" onClick={() => onDelete(r.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
