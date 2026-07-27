import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, DatePicker, Drawer, Input, InputNumber, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { orderApi, type OrderListRow } from '../api/orders';
import { qualityApi, type DefectUpsert, type OrderLineOptionDto, type QualityRow, type QualitySummaryRow } from '../api/qualityInspections';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { palette } from '../theme';

/* 品质管理 · 录入页 —— 选订单带出加工厂/货号/款式，填验货+不良类型，自动算次品率。
   汇总页(各加工厂滚动)是下一步。 */

const TODAY = new Date().toISOString().slice(0, 10);
const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });
const dash = <span style={{ color: palette.inkSoft }}>—</span>;
const pct = (v?: number | null) => (v == null ? dash : <span style={{ color: palette.ok }}>{(v * 100).toFixed(1)}%</span>);
const pctText = (v?: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const FIXED_DEFECTS = ['爆口', '线头', '污染']; // 固定3类不良类型

export default function QualityPage() {
  const { message } = App.useApp();
  const { role } = useAuth();
  const canEdit = can.editQuality(role); // 验货入库由跟单/品质录入，管理员可维护
  const [data, setData] = useState<QualityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const load = (k = kw) => {
    setLoading(true);
    qualityApi.list({ keyword: k || undefined }).then(setData).finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const del = async (id: number) => {
    await qualityApi.remove(id);
    message.success('已删除');
    load();
  };

  const columns: ColumnsType<QualityRow> = [
    { title: '加工厂', dataIndex: 'supplierName', width: 130, fixed: 'left', onHeaderCell: hcell },
    { title: '货号', dataIndex: 'seriesCode', width: 100, onHeaderCell: hcell, render: (v) => v || dash },
    { title: '款式/品名', dataIndex: 'productName', width: 130, onHeaderCell: hcell, render: (v) => v || dash },
    { title: '收货日期', dataIndex: 'receivedDate', width: 110, onHeaderCell: hcell },
    { title: '送货单号', dataIndex: 'deliveryNo', width: 120, onHeaderCell: hcell, render: (v) => v || dash },
    { title: '收货数量', dataIndex: 'receivedQty', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => v ?? dash },
    { title: '质检数量', dataIndex: 'qcQty', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => v ?? dash },
    { title: '验货后入库数', dataIndex: 'stockInQty', width: 120, align: 'right', onHeaderCell: hcell, render: (v) => v ?? dash },
    { title: '抽检/全检', dataIndex: 'inspectMode', width: 90, align: 'center', onHeaderCell: hcell, render: (v) => <Tag>{v}</Tag> },
    { title: '检验比例', dataIndex: 'inspectRatio', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => pct(v) },
    { title: '平均次品率', dataIndex: 'avgDefectRate', width: 100, align: 'right', onHeaderCell: hcell, render: (v) => pct(v) },
    { title: '主要质量短板', dataIndex: 'mainDefect', width: 130, onHeaderCell: hcell, render: (v) => v || dash },
    { title: '检验员', dataIndex: 'inspector', width: 90, onHeaderCell: hcell, render: (v) => v || dash },
    {
      title: '操作',
      key: 'op',
      width: 110,
      align: 'center',
      fixed: 'right',
      onHeaderCell: hcell,
      // 无写权角色(业务/外发/跟单/管理层)只读，不显示编辑/删除
      render: (_, r) =>
        canEdit ? (
          <Space size={8}>
            <a onClick={() => { setEditId(r.inspectionId); setFormOpen(true); }}>编辑</a>
            <Popconfirm title="删除该品质记录？" onConfirm={() => del(r.inspectionId)} okText="删除" cancelText="取消">
              <a style={{ color: palette.bad }}>删除</a>
            </Popconfirm>
          </Space>
        ) : (
          dash
        ),
    },
  ];

  const recordTab = (
    <div style={{ background: palette.raised, border: `1px solid ${palette.line}`, borderRadius: 18, boxShadow: '0 2px 8px rgba(31,99,216,0.05)', padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search prefix={<SearchOutlined style={{ color: palette.inkSoft }} />} placeholder="搜加工厂 / 货号 / 品名" allowClear onSearch={(v) => { setKw(v); load(v); }} style={{ width: 280 }} />
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={() => { setEditId(null); setFormOpen(true); }}>
            新建品质录入
          </Button>
        )}
      </div>
      <Table<QualityRow>
        rowKey="inspectionId"
        size="small"
        columns={columns}
        dataSource={data}
        loading={loading}
        scroll={{ x: 1600 }}
        expandable={{ expandedRowRender: (r) => <DefectMini defects={r.defects} /> }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>品质管理</div>

      <Tabs
        style={{ marginTop: 12 }}
        items={[
          { key: 'summary', label: '加工厂汇总', children: <QualitySummary /> },
          { key: 'record', label: '品质录入', children: recordTab },
        ]}
      />

      <QualityFormDrawer open={formOpen} editId={editId} onClose={() => setFormOpen(false)} onDone={() => { setFormOpen(false); load(); }} />
    </div>
  );
}

/* —— 加工厂品质汇总（各厂一行，本期/上期次品率 + 趋势 + QC评分） —— */
function QualitySummary() {
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf('month'));
  const [to, setTo] = useState<Dayjs>(dayjs());
  const [kw, setKw] = useState('');
  const [rows, setRows] = useState<QualitySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    qualityApi
      .summary({ from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [from, to]);

  const shown = kw.trim() ? rows.filter((r) => r.supplierName.includes(kw.trim())) : rows;

  const thisMonth = () => { setFrom(dayjs().startOf('month')); setTo(dayjs()); };
  const lastMonth = () => { setFrom(dayjs().subtract(1, 'month').startOf('month')); setTo(dayjs().subtract(1, 'month').endOf('month')); };

  // 趋势：百分点；升=变差(红↑) 降=变好(绿↓)
  const trendCell = (pp?: number | null) => {
    if (pp == null) return dash;
    if (pp > 0) return <span style={{ color: palette.ok, fontWeight: 600 }}>↑ {pp.toFixed(1)} 个百分点</span>;
    if (pp < 0) return <span style={{ color: palette.ok, fontWeight: 600 }}>↓ {Math.abs(pp).toFixed(1)} 个百分点</span>;
    return <span style={{ color: palette.inkSoft }}>持平</span>;
  };
  const GRADE_COLOR: Record<string, string> = { 优秀: 'success', 良好: 'blue', 差: 'orange', 极差: 'error' };

  const columns: ColumnsType<QualitySummaryRow> = [
    { title: '加工厂', dataIndex: 'supplierName', width: 140, fixed: 'left', onHeaderCell: hcell },
    { title: '记录条数', dataIndex: 'recordCount', width: 90, align: 'right', onHeaderCell: hcell },
    { title: '总数量', dataIndex: 'totalQty', width: 100, align: 'right', onHeaderCell: hcell },
    { title: '总不良数', dataIndex: 'totalDefect', width: 100, align: 'right', onHeaderCell: hcell },
    { title: '不良占比', dataIndex: 'defectRatio', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => pct(v) },
    { title: '本期次品率', dataIndex: 'curRate', width: 100, align: 'right', onHeaderCell: hcell, render: (v) => <b style={{ color: palette.ok }}>{pctText(v)}</b> },
    { title: '上期次品率', dataIndex: 'prevRate', width: 100, align: 'right', onHeaderCell: hcell, render: (v) => pct(v) },
    { title: '趋势(环比)', dataIndex: 'trendPp', width: 150, onHeaderCell: hcell, render: (v) => trendCell(v) },
    { title: 'QC评分', dataIndex: 'grade', width: 90, align: 'center', onHeaderCell: hcell, render: (v) => (v && v !== '—' ? <Tag color={GRADE_COLOR[v]}>{v}</Tag> : dash) },
  ];

  return (
    <div style={{ background: palette.raised, border: `1px solid ${palette.line}`, borderRadius: 18, boxShadow: '0 2px 8px rgba(31,99,216,0.05)', padding: '22px 24px' }}>
      <Space size={12} wrap style={{ marginBottom: 16 }}>
        <Button onClick={thisMonth}>本月</Button>
        <Button onClick={lastMonth}>上月</Button>
        <DatePicker.RangePicker
          value={[from, to]}
          onChange={(v) => { if (v && v[0] && v[1]) { setFrom(v[0]); setTo(v[1]); } }}
          allowClear={false}
        />
        <Input.Search placeholder="搜加工厂" allowClear value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 200 }} />
        <span style={{ color: palette.inkSoft }}>
          {from.format('YYYY-MM-DD')} ~ {to.format('YYYY-MM-DD')} · 共 {shown.length} 家加工厂
        </span>
      </Space>
      <Table<QualitySummaryRow> rowKey="supplierId" size="small" columns={columns} dataSource={shown} loading={loading} scroll={{ x: 960 }} pagination={false} />
    </div>
  );
}

// 展开行：该条的不良类型明细
function DefectMini({ defects }: { defects: QualityRow['defects'] }) {
  if (!defects.length) return <span style={{ color: palette.inkSoft }}>无不良类型记录</span>;
  return (
    <Space size={[8, 8]} wrap>
      {defects.map((d) => (
        <Tag key={d.defectId} color={(d.qty ?? 0) > 0 ? 'red' : 'default'}>
          {d.defectType} {d.qty ?? 0}（<span style={{ color: palette.ok }}>{pctText(d.rate)}</span>）
        </Tag>
      ))}
    </Space>
  );
}

/* —— 品质录入 / 编辑 抽屉 —— */
interface DefectRow {
  id: number;
  defectType: string;
  qty?: number;
  fixed: boolean; // 爆口/线头/污染=固定（类型名只读）；其它=可改可删
}
const initDefects = (): DefectRow[] => FIXED_DEFECTS.map((t, i) => ({ id: i + 1, defectType: t, fixed: true }));

function QualityFormDrawer({ open, editId, onClose, onDone }: { open: boolean; editId: number | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [orderId, setOrderId] = useState<number>();
  const [orderLines, setOrderLines] = useState<OrderLineOptionDto[]>([]);
  const [lineId, setLineId] = useState<number>();
  const [receivedDate, setReceivedDate] = useState(TODAY);
  const [checkDate, setCheckDate] = useState('');
  const [maNo, setMaNo] = useState('');
  const [deliveryNo, setDeliveryNo] = useState('');
  const [receivedQty, setReceivedQty] = useState<number>();
  const [qcQty, setQcQty] = useState<number>();
  const [stockInQty, setStockInQty] = useState<number>();
  const [abGroup, setAbGroup] = useState('');
  const [inspector, setInspector] = useState('');
  const [rectification, setRectification] = useState('');
  const [remark, setRemark] = useState('');
  const [defects, setDefects] = useState<DefectRow[]>(initDefects());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    orderApi.list().then(setOrders);
    if (editId) {
      qualityApi.get(editId).then(async (q) => {
        const ops = await qualityApi.orderLines(q.orderId);
        setOrderLines(ops);
        setOrderId(q.orderId);
        setLineId(q.lineId ?? undefined);
        setReceivedDate(q.receivedDate);
        setCheckDate(q.checkDate ?? '');
        setMaNo(q.maNo ?? '');
        setDeliveryNo(q.deliveryNo ?? '');
        setReceivedQty(q.receivedQty ?? undefined);
        setQcQty(q.qcQty ?? undefined);
        setStockInQty(q.stockInQty ?? undefined);
        setAbGroup(q.abGroup ?? '');
        setInspector(q.inspector ?? '');
        setRectification(q.rectification ?? '');
        setRemark(q.remark ?? '');
        const fixed: DefectRow[] = FIXED_DEFECTS.map((t, i) => ({ id: i + 1, defectType: t, fixed: true, qty: q.defects.find((d) => d.defectType === t)?.qty ?? undefined }));
        const others: DefectRow[] = q.defects.filter((d) => !FIXED_DEFECTS.includes(d.defectType)).map((d, i) => ({ id: 1000 + i, defectType: d.defectType, fixed: false, qty: d.qty ?? undefined }));
        setDefects([...fixed, ...others]);
      });
    } else {
      setOrderId(undefined); setOrderLines([]); setLineId(undefined);
      setReceivedDate(TODAY); setCheckDate(''); setMaNo(''); setDeliveryNo('');
      setReceivedQty(undefined); setQcQty(undefined); setStockInQty(undefined); setAbGroup(''); setInspector('');
      setRectification(''); setRemark(''); setDefects(initDefects());
    }
  }, [open, editId]);

  const onSelectOrder = async (oid: number) => {
    setOrderId(oid); setLineId(undefined);
    setOrderLines(await qualityApi.orderLines(oid));
  };

  const supplierName = orders.find((o) => o.orderId === orderId)?.supplierName ?? '';
  const orderOpts = orders.map((o) => ({ value: o.orderId, label: `${o.orderNo} · ${o.supplierName}` }));
  const lineOpts = orderLines.map((l) => ({
    value: l.lineId,
    label: `${l.seriesCode} · ${l.productName} · 下单 ${l.qty ?? '—'} PCS`,
  }));

  // —— 实时计算（与后端口径一致）——
  const mode = qcQty != null && receivedQty != null ? (qcQty >= receivedQty ? '全检' : '抽检') : '—';
  const ratio = receivedQty && receivedQty > 0 && qcQty != null ? qcQty / receivedQty : null;
  const rate = (qty?: number) => (qcQty && qcQty > 0 && qty != null ? qty / qcQty : null);
  const bad = defects.filter((d) => (d.qty ?? 0) > 0);
  const avg = bad.length && qcQty && qcQty > 0 ? bad.reduce((s, d) => s + d.qty! / qcQty, 0) / bad.length : null;
  const main = bad.length ? [...bad].sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))[0].defectType : null;

  const patchDefect = (id: number, key: keyof DefectRow, val: unknown) => setDefects((ds) => ds.map((d) => (d.id === id ? { ...d, [key]: val } : d)));
  const addOther = () => setDefects((ds) => [...ds, { id: Date.now(), defectType: '', fixed: false }]);
  const delOther = (id: number) => setDefects((ds) => ds.filter((d) => d.id !== id));

  const save = async () => {
    if (!orderId) return message.warning('请选采购订单');
    if (!lineId) return message.warning('请选择具体订单款式');
    if (!receivedDate.trim()) return message.warning('请填收货日期');
    const ds: DefectUpsert[] = defects
      .filter((d) => (d.fixed ? d.qty != null : d.defectType.trim() !== '' && d.qty != null))
      .map((d) => ({ defectType: d.defectType.trim(), qty: d.qty ?? null }));
    setSaving(true);
    try {
      const body = {
        orderId,
        lineId,
        receivedDate: receivedDate.trim(),
        checkDate: checkDate.trim() || null,
        maNo: maNo.trim() || null,
        deliveryNo: deliveryNo.trim() || null,
        receivedQty: receivedQty ?? null,
        qcQty: qcQty ?? null,
        stockInQty: stockInQty ?? null,
        abGroup: abGroup.trim() || null,
        inspector: inspector.trim() || null,
        rectification: rectification.trim() || null,
        remark: remark.trim() || null,
        defects: ds,
      };
      if (editId) await qualityApi.update(editId, body);
      else await qualityApi.create(body);
      message.success('已保存');
      onDone();
    } catch (e) {
      message.error((e as Error)?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const lb = (s: string) => <span style={{ color: palette.inkSoft, marginRight: 8 }}>{s}</span>;

  return (
    <Drawer
      title={editId ? '编辑品质记录' : '新建品质录入'}
      width={880}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={save}>保存</Button>
        </Space>
      }
    >
      {/* 关联：订单 → 具体款式 → 带出加工厂 */}
      <div style={{ background: palette.blueSoft, padding: '12px 16px', borderRadius: 10, marginBottom: 16 }}>
        <Space size={12} wrap>
          <span>{lb('采购订单 *')}<Select showSearch value={orderId} onChange={onSelectOrder} options={orderOpts} style={{ width: 240 }} placeholder="选订单" filterOption={(i, o) => (o?.label ?? '').toString().includes(i)} /></span>
          <span>{lb('订单款式 *')}<Select showSearch value={lineId} onChange={setLineId} options={lineOpts} style={{ width: 430 }} placeholder="选择货号和款式" disabled={!orderId} filterOption={(i, o) => (o?.label ?? '').toString().includes(i)} /></span>
          <span>{lb('加工厂')}<b>{supplierName || '—'}</b></span>
        </Space>
      </div>

      {/* 基础 */}
      <Space size={12} wrap style={{ marginBottom: 12 }}>
        <span>{lb('收货日期 *')}<DatePicker value={receivedDate ? dayjs(receivedDate) : null} onChange={(d) => setReceivedDate(d ? d.format('YYYY-MM-DD') : '')} format="YYYY-MM-DD" allowClear={false} style={{ width: 140 }} placeholder="选收货日" /></span>
        <span>{lb('查货/返工日')}<DatePicker value={checkDate ? dayjs(checkDate) : null} onChange={(d) => setCheckDate(d ? d.format('YYYY-MM-DD') : '')} format="YYYY-MM-DD" style={{ width: 140 }} placeholder="选填" /></span>
        <span>{lb('MA号')}<Input value={maNo} onChange={(e) => setMaNo(e.target.value)} style={{ width: 120 }} /></span>
        <span>{lb('送货单号')}<Input value={deliveryNo} onChange={(e) => setDeliveryNo(e.target.value)} style={{ width: 150 }} /></span>
      </Space>
      <Space size={12} wrap style={{ marginBottom: 12 }}>
        <span>{lb('收货数量')}<InputNumber min={0} value={receivedQty} onChange={(v) => setReceivedQty(v ?? undefined)} style={{ width: 120 }} /></span>
        <span>{lb('质检数量')}<InputNumber min={0} value={qcQty} onChange={(v) => setQcQty(v ?? undefined)} style={{ width: 120 }} /></span>
        <span>{lb('验货后入库数')}<InputNumber min={0} value={stockInQty} onChange={(v) => setStockInQty(v ?? undefined)} style={{ width: 130 }} /></span>
        <span>{lb('抽检/全检')}<Tag>{mode}</Tag></span>
        <span>{lb('检验比例')}<b style={{ color: palette.ok }}>{ratio == null ? '—' : pctText(ratio)}</b></span>
        <span>{lb('A/B组')}<Input value={abGroup} onChange={(e) => setAbGroup(e.target.value)} style={{ width: 80 }} /></span>
        <span>{lb('检验员')}<Input value={inspector} onChange={(e) => setInspector(e.target.value)} style={{ width: 100 }} /></span>
      </Space>

      {/* 不良类型 */}
      <div style={{ fontWeight: 700, margin: '8px 0' }}>不良类型（占比 = 数量 ÷ 质检）</div>
      <div style={{ border: `1px solid ${palette.line}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
        {defects.map((d) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {d.fixed ? (
              <span style={{ width: 120, fontWeight: 600 }}>{d.defectType}</span>
            ) : (
              <Input placeholder="不良类型" value={d.defectType} onChange={(e) => patchDefect(d.id, 'defectType', e.target.value)} style={{ width: 120 }} />
            )}
            <InputNumber min={0} placeholder="数量" value={d.qty} onChange={(v) => patchDefect(d.id, 'qty', v ?? undefined)} style={{ width: 110 }} />
            <span style={{ color: palette.ok }}>占比 {pctText(rate(d.qty))}</span>
            {!d.fixed && <a style={{ color: palette.bad }} onClick={() => delOther(d.id)}><DeleteOutlined /></a>}
          </div>
        ))}
        <Button size="small" icon={<PlusOutlined />} onClick={addOther} style={{ borderStyle: 'dashed', marginTop: 4 }}>加其它类型</Button>
        <div style={{ marginTop: 12, color: palette.ink }}>
          平均次品率 <b style={{ color: palette.ok }}>{pctText(avg)}</b>
          <span style={{ marginLeft: 24 }}>主要质量短板 <b>{main ?? '—'}</b></span>
        </div>
      </div>

      {/* 跟踪 */}
      <Space size={12} wrap>
        <span>{lb('整改情况')}<Input value={rectification} onChange={(e) => setRectification(e.target.value)} style={{ width: 260 }} placeholder="选填" /></span>
        <span>{lb('备注')}<Input value={remark} onChange={(e) => setRemark(e.target.value)} style={{ width: 260 }} placeholder="选填" /></span>
      </Space>
    </Drawer>
  );
}
