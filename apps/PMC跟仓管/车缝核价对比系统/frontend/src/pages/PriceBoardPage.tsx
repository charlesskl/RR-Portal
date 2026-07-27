import { Alert, DatePicker, Empty, Segmented, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { priceBoardApi, type PriceBoardByStyle, type PriceBoardBySupplier, type PriceBoardDto } from '../api/priceBoard';
import { palette } from '../theme';

const C = {
  head: palette.blueSoft,
  headInk: palette.blueDark,
  pink: '#fdeaf1',
  pinkInk: '#d84f7f',
  calc: '#efeafe',
  ok: palette.ok,
  okSoft: palette.okSoft,
  bad: palette.bad,
  ink: palette.ink,
  inkSoft: palette.inkSoft,
  line: palette.line,
};
const yuan = (n: number, d = 2) => `¥${n.toFixed(d)}`;
const dash = <span style={{ color: C.inkSoft }}>—</span>;
const headCell = (bg = C.head, color = C.headInk) => () => ({
  style: { background: bg, color, fontWeight: 700, textAlign: 'center' as const },
});
const cardStyle: React.CSSProperties = { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, boxShadow: '0 2px 10px rgba(31,99,216,0.05)' };
const saveText = (n: number, rate?: number | null) => <span style={{ color: n >= 0 ? C.ok : C.bad, fontWeight: 700 }}>{n < 0 ? '-' : ''}¥{Math.abs(n).toFixed(2)}{rate != null && ` ${n >= 0 ? '↓' : '↑'}${Math.abs(rate).toFixed(1)}%`}</span>;
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rangeOf(period: '本周' | '本月') {
  const now = new Date();
  if (period === '本周') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { from: fmt(monday), to: fmt(sunday) };
  }
  return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

export default function PriceBoardPage() {
  const initial = rangeOf('本月');
  const [period, setPeriod] = useState<'本周' | '本月' | '自定义'>('本月');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs(initial.from), dayjs(initial.to)]);
  const [dim, setDim] = useState('按产品看');
  const [data, setData] = useState<PriceBoardDto | null>(null);
  const [loading, setLoading] = useState(false);
  const from = dateRange[0].format('YYYY-MM-DD');
  const to = dateRange[1].format('YYYY-MM-DD');
  useEffect(() => {
    setLoading(true);
    priceBoardApi.get(from, to).then(setData).finally(() => setLoading(false));
  }, [from, to]);
  const selectPeriod = (v: string | number) => {
    const p = v as '本周' | '本月';
    const r = rangeOf(p);
    setPeriod(p);
    setDateRange([dayjs(r.from), dayjs(r.to)]);
  };

  const productCols: ColumnsType<PriceBoardByStyle> = [
    { title: '外发单号', dataIndex: 'orderNo', width: 150, onHeaderCell: headCell(), render: (v) => <b>{v}</b> },
    { title: '货号+款式', width: 240, onHeaderCell: headCell(), render: (_, r) => `${r.series} ${r.style}` },
    { title: '报客价', dataIndex: 'customerQuote', width: 120, align: 'right', onHeaderCell: headCell(C.pink, C.pinkInk), render: (v) => v == null ? dash : <span style={{ color: C.pinkInk, fontWeight: 600 }}>{yuan(v, 4)}</span> },
    { title: '本厂核价', dataIndex: 'selfUnitSum', width: 120, align: 'right', onHeaderCell: headCell(), render: (v) => <span style={{ color: palette.blueDark, fontWeight: 600 }}>{yuan(v, 4)}</span> },
    { title: '外发价', dataIndex: 'outUnitSum', width: 120, align: 'right', onHeaderCell: headCell(), render: (v) => <b style={{ color: palette.amber }}>{yuan(v, 4)}</b> },
    { title: '外发&本厂占比', dataIndex: 'outSelfRate', width: 145, align: 'right', onHeaderCell: headCell(C.okSoft, C.ok), render: (v) => v == null ? dash : <span style={{ color: C.ok, fontWeight: 600 }}>{v.toFixed(2)}%</span> },
    { title: '订单数量', dataIndex: 'qty', width: 110, align: 'right', onHeaderCell: headCell() },
    { title: '节约总价', dataIndex: 'saveValue', width: 130, align: 'right', onHeaderCell: headCell(C.calc), render: (v) => saveText(v) },
  ];

  const supplierCols: ColumnsType<PriceBoardBySupplier> = [
    { title: '加工厂', dataIndex: 'supplier', width: 150, fixed: 'left', onHeaderCell: headCell(), render: (v) => <b>{v}</b> },
    { title: '承接业务', width: 220, align: 'center', onHeaderCell: headCell(), render: (_, r) => `${r.orderCount} 单 / ${r.styleCount} 款 / ${r.qty.toFixed(0)} 件` },
    { title: '外发金额', dataIndex: 'outValue', width: 150, align: 'right', onHeaderCell: headCell(), render: (v) => <b style={{ color: palette.amber, fontSize: 16 }}>{yuan(v)}</b> },
    { title: '节约金额 / 节约率', dataIndex: 'saveValue', width: 190, align: 'right', onHeaderCell: headCell(C.calc), render: (v, r) => saveText(v, r.savingRate) },
    { title: '价格状态', dataIndex: 'overPriceCount', width: 130, align: 'center', onHeaderCell: headCell(), render: (v) => v > 0
      ? <span style={{ color: C.bad, fontWeight: 700 }}>{v} 款异常</span>
      : <span style={{ color: C.ok, fontWeight: 700 }}>正常</span> },
  ];

  const rangeName = period === '自定义' ? '所选日期内' : period;
  const totalOrderCount = data ? new Set(data.byStyle.map((row) => row.orderId)).size : 0;
  const totalSavingRate = data && data.selfValueTotal > 0 ? data.saveValueTotal / data.selfValueTotal * 100 : null;
  const summaryCard = (label: string, value: React.ReactNode, tone = C.ink) => (
    <div style={{ flex: 1, minWidth: 220, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '15px 18px' }}>
      <div style={{ color: C.inkSoft, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: tone, fontSize: 23, fontWeight: 800 }}>{value}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>核价对比</div>
        <Segmented value={period === '自定义' ? undefined : period} onChange={selectPeriod} options={['本周', '本月']} />
        <DatePicker.RangePicker value={dateRange} onChange={(v) => { if (v?.[0] && v[1]) { setPeriod('自定义'); setDateRange([v[0], v[1]]); } }} allowClear={false} format="YYYY-MM-DD" />
        <span style={{ color: C.inkSoft, fontSize: 12 }}>{from} ~ {to}（按下单日期）</span>
      </div>

      <Alert type="info" showIcon message="价格口径：人民币（CNY）、不含税；税率统一13%；数量口径：产品数量；差额＝本厂核价－外发价。" style={{ marginBottom: 14 }} />

      <Spin spinning={loading}>
        {!data || data.outStyleCount === 0 ? <div style={{ ...cardStyle, padding: '60px 18px' }}><Empty description={`${rangeName}暂无外发订单`} /></div> : <>
          <Segmented value={dim} onChange={(v) => setDim(v as string)} options={['按产品看', '按加工厂看']} style={{ marginBottom: 14 }} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            {summaryCard('外发总单数', `${totalOrderCount} 单`, palette.blue)}
            {summaryCard('外发总金额', yuan(data.outValueTotal), palette.amber)}
            {summaryCard('节约金额 / 节约率', <>{yuan(data.saveValueTotal)} <span style={{ fontSize: 15 }}>{totalSavingRate == null ? '—' : `${totalSavingRate.toFixed(1)}%`}</span></>, data.saveValueTotal >= 0 ? C.ok : C.bad)}
          </div>
          {dim === '按产品看' ? <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>按产品看 · 订单价格对比</div>
            <Table rowKey="lineId" size="middle" bordered columns={productCols} dataSource={data.byStyle} />
          </div> : <>
            <div style={cardStyle}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>加工厂业务对比</div>
              <Table rowKey="supplierId" size="middle" bordered pagination={false} columns={supplierCols} dataSource={data.bySupplier} scroll={{ x: 840 }}
                rowClassName={(r) => r.overPriceCount > 0 ? 'row-over' : ''} />
            </div>
          </>}
        </>}
      </Spin>
    </div>
  );
}
