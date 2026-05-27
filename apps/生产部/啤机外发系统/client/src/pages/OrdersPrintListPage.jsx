import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (n, d = 2) => {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (!isFinite(num)) return '';
  return num.toLocaleString('en-US', { maximumFractionDigits: d });
};

export default function OrdersPrintListPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ids passed via URL hash (avoid query length limits with hundreds of ids)
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const idSet = hash ? new Set(hash.split(',').filter(Boolean)) : null;
    api.listOrders().then((all) => {
      setOrders(idSet ? all.filter((x) => idSet.has(x.id)) : all);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && orders.length > 0) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [loading, orders]);

  if (loading) return <div className="print-page" style={{ padding: 40 }}>加载中...</div>;

  const today = new Date().toLocaleDateString('zh-CN');
  const totals = orders.reduce(
    (a, o) => ({
      pcs: a.pcs + (Number(o.order_qty_pcs) || 0),
      shots: a.shots + (Number(o.order_qty_shots) || 0),
      in_house: a.in_house + (Number(o.in_house_output) || 0),
      out: a.out + (Number(o.outsource_output) || 0),
      net: a.net + (Number(o.net_outsource_output) || 0),
    }),
    { pcs: 0, shots: 0, in_house: 0, out: 0, net: 0 }
  );

  return (
    <div className="print-page list">
      <div className="print-toolbar no-print">
        <button onClick={() => window.print()} className="primary">打印 / 另存为 PDF</button>
        <button onClick={() => window.close()}>关闭</button>
        <span style={{ marginLeft: 16, color: '#6b7280', fontSize: 12 }}>
          打印对话框中选择"另存为 PDF"。建议在"更多设置"里把方向改为"横向"。
        </span>
      </div>

      <div className="print-title list">
        <div className="company">东莞兴信</div>
        <div className="doc-title">啤机外发模具汇总表</div>
        <div className="print-meta">
          <span>共 {orders.length} 条</span>
          <span style={{ marginLeft: 24 }}>打印日期：{today}</span>
        </div>
      </div>

      <table className="print-list-table">
        <thead>
          <tr>
            <th>#</th>
            <th>车间</th>
            <th>货号</th>
            <th>模具</th>
            <th>订单(PCS)</th>
            <th>订单(啤)</th>
            <th>实际产能</th>
            <th>预计天数</th>
            <th>核价$</th>
            <th>外发$</th>
            <th>供应商</th>
            <th>PMC</th>
            <th>下单</th>
            <th>上机</th>
            <th>交期</th>
            <th>外发产值$</th>
            <th>扣税后$</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={o.id}>
              <td>{i + 1}</td>
              <td>{o.workshop}</td>
              <td>{o.item_code}</td>
              <td className="mold-cell">{o.mold}</td>
              <td className="num">{fmt(o.order_qty_pcs, 0)}</td>
              <td className="num">{fmt(o.order_qty_shots, 0)}</td>
              <td className="num">{fmt(o.actual_capacity, 0)}</td>
              <td className="num">{fmt(o.estimated_days)}</td>
              <td className="num">{fmt(o.quote_price_usd, 4)}</td>
              <td className="num">{fmt(o.supplier_price_usd, 4)}</td>
              <td>{o.supplier}</td>
              <td>{o.pmc_follow}</td>
              <td>{o.order_date}</td>
              <td>{o.production_start}</td>
              <td>{o.estimated_delivery}</td>
              <td className="num">{fmt(o.outsource_output)}</td>
              <td className="num">{fmt(o.net_outsource_output)}</td>
              <td>{o.remark}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>合计</td>
            <td className="num"><b>{fmt(totals.pcs, 0)}</b></td>
            <td className="num"><b>{fmt(totals.shots, 0)}</b></td>
            <td colSpan={8}></td>
            <td className="num"><b>{fmt(totals.out)}</b></td>
            <td className="num"><b>{fmt(totals.net)}</b></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
