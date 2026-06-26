import { useEffect, useState } from 'react';
import { getAllWeeks, getWeekly, getMatrix, listCustomers, exportWeeklyUrl } from '../api.js';
import ReportView from '../ReportView.jsx';

export default function Weekly() {
  const [weeks, setWeeks] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [matrixWeeks, setMatrixWeeks] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [filterCustomer, setFilterCustomer] = useState('');

  async function loadMatrix(n) {
    const r = await getMatrix(n);
    setMatrix(r);
  }

  useEffect(() => {
    listCustomers().then(r => setCustomers(r.list || []));
    getAllWeeks().then(r => {
      setWeeks(r.weeks || []);
      if (r.weeks && r.weeks.length > 0) setSelected(r.weeks[0].weekKey);
    });
    loadMatrix(matrixWeeks);
  }, []);

  useEffect(() => { loadMatrix(matrixWeeks); }, [matrixWeeks]);

  useEffect(() => {
    if (!selected) { setData(null); return; }
    setLoading(true);
    getWeekly(selected, filterCustomer)
      .then(r => setData(r))
      .finally(() => setLoading(false));
  }, [selected, filterCustomer]);

  const passRate = data && data.totalRows > 0
    ? (((data.totalRows - data.totalFail) / data.totalRows) * 100).toFixed(2) + '%'
    : '—';

  return (
    <div className="page">
      <h2>周报视图</h2>

      <h3 style={{ marginTop: 8 }}>客户 × 周 不合格数交叉表</h3>
      <div className="form-row">
        <label>显示最近：</label>
        <select value={matrixWeeks} onChange={e => setMatrixWeeks(parseInt(e.target.value, 10))}>
          <option value={1}>1 周（只看本周）</option>
          <option value={2}>2 周</option>
          <option value={4}>4 周</option>
          <option value={8}>8 周</option>
          <option value={12}>12 周</option>
          <option value={26}>26 周</option>
        </select>
      </div>
      {matrix && matrix.rows.length === 0 && <p className="hint">还没有数据。</p>}
      {matrix && matrix.rows.length > 0 && (
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th className="sticky-col">客户</th>
                {matrix.weeks.map(w => <th key={w}>{w}</th>)}
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(row => {
                const total = matrix.weeks.reduce((s, w) => s + (row.cells[w] ? row.cells[w].totalFail : 0), 0);
                return (
                  <tr key={row.customerId || row.customerName}>
                    <td className="sticky-col"><b>{row.customerName}</b></td>
                    {matrix.weeks.map(w => {
                      const c = row.cells[w];
                      if (!c) return <td key={w} className="muted">—</td>;
                      return (
                        <td key={w} title={`${c.reports} 份报告 / ${c.totalRows} 行`}>
                          <span style={{ color: c.totalFail > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                            {c.totalFail}
                          </span>
                        </td>
                      );
                    })}
                    <td><b style={{ color: total > 0 ? '#dc2626' : '#16a34a' }}>{total}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: '32px 0 24px', border: 0, borderTop: '1px solid #e5e7eb' }} />

      <h3>单周明细</h3>
      {weeks.length === 0 && <p className="hint">还没有任何报告，请先上传。</p>}
      {weeks.length > 0 && (
        <div className="form-row">
          <label>选择周次：</label>
          <select value={selected} onChange={e => setSelected(e.target.value)}>
            {weeks.map(w => (
              <option key={w.weekKey} value={w.weekKey}>
                {w.weekKey}（{w.reports} 份报告 · {w.totalFail} 项不合格）
              </option>
            ))}
          </select>
          <label>客户：</label>
          <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
            <option value="">全部</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selected && data && data.totalReports > 0 && (
            <a
              className="btn-export"
              href={exportWeeklyUrl(selected, filterCustomer)}
              download
              target="_blank"
              rel="noreferrer"
            >
              ⬇ 导出 Excel（保留原报告布局）
            </a>
          )}
        </div>
      )}
      {loading && <p className="hint">加载中…</p>}
      {!loading && data && (
        <>
          <div className="summary">
            <span>报告数：<b>{data.totalReports}</b></span>
            <span>有效行数总计：{data.totalRows}</span>
            <span>不合格行数总计：<b style={{ color: '#dc2626' }}>{data.totalFail}</b></span>
            <span>合格率：<b>{passRate}</b></span>
          </div>
          {data.customers && data.customers.length > 1 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>报告数</th>
                    <th>有效行</th>
                    <th>不合格</th>
                    <th>合格率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map(c => {
                    const rate = c.totalRows > 0 ? (((c.totalRows - c.totalFail) / c.totalRows) * 100).toFixed(2) + '%' : '—';
                    return (
                      <tr key={c.customerId || c.customerName}>
                        <td><b>{c.customerName}</b></td>
                        <td>{c.reports}</td>
                        <td>{c.totalRows}</td>
                        <td style={{ color: '#dc2626', fontWeight: 'bold' }}>{c.totalFail}</td>
                        <td>{rate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <h3 style={{ marginTop: 24 }}>本周报告明细</h3>
          {(!data.reports || data.reports.length === 0) ? (
            <p className="hint">本周无报告</p>
          ) : (
            data.reports.map(rep => (
              <div key={rep.id} className="report-block">
                <ReportView report={rep} />
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
