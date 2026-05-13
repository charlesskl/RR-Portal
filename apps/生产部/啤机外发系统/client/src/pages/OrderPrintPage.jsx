import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';

const fmt = (n, d = 2) => {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (!isFinite(num)) return '';
  return num.toLocaleString('en-US', { maximumFractionDigits: d });
};

export default function OrderPrintPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listOrders().then((all) => {
      setOrder(all.find((x) => x.id === id) || null);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!loading && order) {
      // Slight delay so layout paints before print dialog
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [loading, order]);

  if (loading) return <div className="print-page" style={{ padding: 40 }}>加载中...</div>;
  if (!order) return <div className="print-page" style={{ padding: 40 }}>未找到该订单</div>;

  const today = new Date().toLocaleDateString('zh-CN');

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button onClick={() => window.print()} className="primary">打印 / 另存为 PDF</button>
        <button onClick={() => window.close()}>关闭</button>
        <span style={{ marginLeft: 16, color: '#6b7280', fontSize: 12 }}>
          在打印对话框中选择"另存为 PDF"即可导出 PDF 文件
        </span>
      </div>

      <div className="print-sheet">
        <div className="print-title">
          <div className="company">东莞兴信</div>
          <div className="doc-title">啤机外发模具单</div>
          <div className="print-meta">
            <span>单号：{order.id}</span>
            <span style={{ marginLeft: 24 }}>打印日期：{today}</span>
          </div>
        </div>

        <table className="print-table">
          <tbody>
            <tr>
              <th>车间</th><td>{order.workshop || ''}</td>
              <th>货号</th><td>{order.item_code || ''}</td>
            </tr>
            <tr>
              <th>模具</th><td colSpan={3}>{order.mold || ''}</td>
            </tr>
            <tr>
              <th>订单数量 (PCS)</th><td>{fmt(order.order_qty_pcs, 0)}</td>
              <th>订单数量 (啤)</th><td>{fmt(order.order_qty_shots, 0)}</td>
            </tr>
            <tr>
              <th>报价日产能</th><td>{fmt(order.quoted_capacity, 0)}</td>
              <th>实际产能</th><td>{fmt(order.actual_capacity, 0)}</td>
            </tr>
            <tr>
              <th>预计天数</th><td>{fmt(order.estimated_days)}</td>
              <th>核价 $</th><td>{fmt(order.quote_price_usd, 4)}</td>
            </tr>
            <tr>
              <th>供应商外发价 ￥</th><td>{fmt(order.supplier_price_rmb, 4)}</td>
              <th>供应商外发价 $</th><td>{fmt(order.supplier_price_usd, 4)}</td>
            </tr>
            <tr>
              <th>供应商</th><td>{order.supplier || ''}</td>
              <th>跟进 PMC</th><td>{order.pmc_follow || ''}</td>
            </tr>
            <tr>
              <th>下单日期</th><td>{order.order_date || ''}</td>
              <th>上机时间</th><td>{order.production_start || ''}</td>
            </tr>
            <tr>
              <th>预计交货期</th><td>{order.estimated_delivery || ''}</td>
              <th>状态</th><td>{statusLabel(order.status)}</td>
            </tr>
            <tr>
              <th>本厂产值 ($)</th><td>{fmt(order.in_house_output)}</td>
              <th>外发产值 ($)</th><td>{fmt(order.outsource_output)}</td>
            </tr>
            <tr>
              <th>供应商扣税产值 ($)</th><td>{fmt(order.supplier_tax_output)}</td>
              <th>扣税后外发产值 ($)</th><td>{fmt(order.net_outsource_output)}</td>
            </tr>
            <tr>
              <th>备注</th><td colSpan={3} style={{ minHeight: 60 }}>{order.remark || ''}</td>
            </tr>
          </tbody>
        </table>

        <div className="signature-block">
          <div className="sig"><div className="sig-label">制单：</div><div className="sig-line" /></div>
          <div className="sig"><div className="sig-label">审核：</div><div className="sig-line" /></div>
          <div className="sig"><div className="sig-label">供应商签收：</div><div className="sig-line" /></div>
          <div className="sig"><div className="sig-label">日期：</div><div className="sig-line" /></div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s) {
  return ({ open: '进行中', done: '已完成', cancelled: '已取消' })[s] || s || '';
}
