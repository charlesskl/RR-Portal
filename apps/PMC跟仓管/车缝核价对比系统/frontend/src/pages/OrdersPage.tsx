import { DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Drawer, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { orderApi, type OrderDetailDto, type OrderListRow } from '../api/orders';
import { orderPricingApi, type OrderPriceHistory } from '../api/orderPricing';
import { deliveryNoteApi, type DeliveryNoteDto } from '../api/deliveryNotes';
import { productApi } from '../api/products';
import { supplierApi, type SupplierDto } from '../api/suppliers';
import type { Product } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { palette } from '../theme';
import ImportOrdersDrawer from '../components/ImportOrdersDrawer';

/* 模块一 · 阶段3 —— 采购订单（主干）
   订单头 + 款式明细；价格在订单明细中轻量维护。 */

const TODAY = new Date().toISOString().slice(0, 10);
const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });
const dash = <span style={{ color: palette.inkSoft }}>—</span>;
const yuan = (n?: number | null, d = 2) => (n == null ? dash : `¥${n.toFixed(d)}`);
// 未交货时：今天 − 交货期 的天数（>0 表示当前已超期）。无交货期返回 0。用本地日期避免时区错位。
function overdueDays(deliveryDate?: string | null): number {
  if (!deliveryDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${deliveryDate}T00:00:00`);
  return Math.round((today.getTime() - due.getTime()) / 86400000);
}
// 状态由回货 QC 自动流转，前端只读展示，按状态着色
const STATUS_COLOR: Record<string, string> = { 待核价: 'warning', 已下单: 'default', 生产中: 'processing', 已交货: 'success' };
// 每列固定 120px；12 个普通列 + 操作列(冻结右侧, 150px)。超出屏幕时表格底部出横向滚动条
const COL_W = 120;
const TABLE_MIN_W = COL_W * 12 + 150;

export default function OrdersPage() {
  const { message } = App.useApp();
  const { role } = useAuth();
  const canDetail = can.viewOrderDetail(role); // 能否看含价明细弹窗（跟单/品质不能）
  const canEdit = can.editOrderTracking(role); // 业务/外发/跟单/管理员可打开独立编辑窗口
  const canManage = can.editOrderDetail(role); // 能否删除订单（业务/外发/管理员）
  const [data, setData] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = (k = kw) => {
    setLoading(true);
    orderApi
      .list(k || undefined)
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const del = async (id: number) => {
    await orderApi.remove(id);
    message.success('已删除');
    load();
  };

  // 所有列统一居中对齐：列宽都是 120px，文字居中后每列间距节奏一致，看起来整齐均匀
  const columns: ColumnsType<OrderListRow> = [
    { title: '订单号', dataIndex: 'orderNo', width: COL_W, align: 'center', onHeaderCell: hcell, render: (v) => <b>{v}</b> },
    { title: '加工厂', dataIndex: 'supplierName', width: COL_W, align: 'center', onHeaderCell: hcell },
    { title: '货号', dataIndex: 'seriesCodes', width: COL_W, align: 'center', onHeaderCell: hcell, render: (v) => v || dash },
    { title: '款式', dataIndex: 'styleNames', width: COL_W, align: 'center', onHeaderCell: hcell, render: (v) => v || dash },
    { title: '订单数量', dataIndex: 'totalQty', width: COL_W, align: 'center', onHeaderCell: hcell, render: (v) => v ?? dash },
    { title: '下单日期', dataIndex: 'orderDate', width: COL_W, align: 'center', onHeaderCell: hcell },
    { title: '交货日期', dataIndex: 'deliveryDate', width: COL_W, align: 'center', onHeaderCell: hcell, render: (v) => v ?? dash },
    {
      // 只读·自动：进度 = 累计实际交货 ÷ 订单数量（回货 QC 录入后由后端算）
      title: '生产完成进度',
      dataIndex: 'productionProgress',
      width: COL_W,
      align: 'center',
      onHeaderCell: hcell,
      render: (v: number) => <Progress percent={v} size="small" format={(p) => <span style={{ color: palette.ok }}>{p}%</span>} />,
    },
    {
      // 只读·自动：进度 0→已下单 / 0~100→生产中 / 100→已交货
      title: '状态',
      dataIndex: 'status',
      width: COL_W,
      align: 'center',
      onHeaderCell: hcell,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      // 延期天数：①已交货→记录的最终延期(延N天/准时) ②未交货但已过交货期→实时延期(今天−交货期) ③未到期/无交货期→横杆
      title: '延期天数',
      width: COL_W,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, r) => {
        if (r.status === '已交货') {
          return r.delayDays > 0 ? (
            <b style={{ color: palette.bad }}>延 {r.delayDays} 天</b>
          ) : (
            <b style={{ color: palette.ok }}>准时</b>
          );
        }
        const overdue = overdueDays(r.deliveryDate);
        return overdue > 0 ? <b style={{ color: palette.bad }}>延期 {overdue} 天</b> : dash;
      },
    },
    {
      title: '延期原因',
      width: COL_W,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, r) => r.delayReason || dash,
    },
    {
      title: '备注',
      width: COL_W,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, r) => r.remark || dash,
    },
    {
      title: '操作',
      key: 'op',
      width: 160,
      align: 'center',
      fixed: 'right',
      onHeaderCell: hcell,
      render: (_, r) => (
        <Space size={10}>
          {canEdit && <a onClick={() => setEditId(r.orderId)}>编辑</a>}
          {/* 跟单/品质看不到"明细"(明细含价) */}
          {canDetail && <a onClick={() => setDetailId(r.orderId)}>明细</a>}
          {/* 删除仅订单管理角色(业务/外发/管理员) */}
          {canManage && (
            <Popconfirm title={`删除订单 ${r.orderNo}？`} onConfirm={() => del(r.orderId)} okText="删除" cancelText="取消">
              <a style={{ color: palette.bad }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>外发订单</div>

      <div
        style={{
          background: palette.raised,
          border: `1px solid ${palette.line}`,
          borderRadius: 18,
          boxShadow: '0 2px 8px rgba(31,99,216,0.05)',
          padding: '22px 24px',
          marginTop: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input.Search
            prefix={<SearchOutlined style={{ color: palette.inkSoft }} />}
            placeholder="搜订单号"
            allowClear
            onSearch={(v) => {
              setKw(v);
              load(v);
            }}
            style={{ width: 280 }}
          />
          {/* 只有订单管理角色(业务/外发/管理员)能新建外发订单 */}
          {canManage && (
            <Space style={{ marginLeft: 'auto' }}>
              <ImportOrdersDrawer onDone={() => load()} />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                新建外发订单
              </Button>
            </Space>
          )}
        </div>

        <Table<OrderListRow>
          rowKey="orderId"
          size="small"
          columns={columns}
          dataSource={data}
          loading={loading}
          tableLayout="fixed"
          scroll={{ x: TABLE_MIN_W }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 张订单` }}
        />
      </div>

      <OrderFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); load(); }} />
      <OrderEditDrawer id={editId} onClose={() => setEditId(null)} onDone={() => { setEditId(null); load(); }} />
      <OrderDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

/* —— 新建采购订单 —— */
interface FormLine {
  id: number;
  lineId?: number | null;
  productId?: number;
  qty?: number;
}

/* —— 编辑采购订单（独立窗口，不接收/显示任何价格）—— */
function OrderEditDrawer({ id, onClose, onDone }: { id: number | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sups, setSups] = useState<SupplierDto[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [orderNo, setOrderNo] = useState('');
  const [supplierId, setSupplierId] = useState<number>();
  const [orderDate, setOrderDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [remark, setRemark] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lines, setLines] = useState<FormLine[]>([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([orderApi.getEdit(id), supplierApi.list(), productApi.list({ pageSize: 1000 })])
      .then(([order, ss, ps]) => {
        setOrderNo(order.orderNo);
        setSupplierId(order.supplierId);
        setOrderDate(order.orderDate);
        setDeliveryDate(order.deliveryDate ?? '');
        setDelayReason(order.delayReason ?? '');
        setRemark(order.remark ?? '');
        setStatus(order.status);
        setProgress(order.productionProgress);
        setLocked(order.hasLinkedRecords);
        setLines(order.lines.map((l) => ({
          id: l.lineId ?? Date.now() + Math.random(),
          lineId: l.lineId,
          productId: l.productId,
          qty: l.qty ?? undefined,
        })));
        setSups(ss);
        setProds(ps.items);
      })
      .catch((e) => {
        message.error((e as Error)?.message ?? '订单加载失败');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [id, message, onClose]);

  const supOpts = sups.map((s) => ({ value: s.supplierId, label: s.supplierName }));
  const prodOpts = prods.map((p) => ({ value: p.productId, label: `${p.seriesCode ?? p.productCode} ${p.styleNo ?? ''} ${p.productName}`.trim() }));
  const patchLine = (rowId: number, key: keyof FormLine, value: unknown) =>
    setLines((rows) => rows.map((r) => (r.id === rowId ? { ...r, [key]: value } : r)));
  const addLine = () => setLines((rows) => [...rows, { id: Date.now() }]);
  const removeLine = (rowId: number) => setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== rowId) : rows));

  const save = async () => {
    if (!id || !supplierId) return message.warning('请选择加工厂');
    if (!orderDate) return message.warning('请选择下单日期');
    if (!lines.length || lines.some((l) => !l.productId))
      return message.warning('每行都必须选择款式');
    setSaving(true);
    try {
      await orderApi.update(id, {
        supplierId,
        orderDate,
        deliveryDate: deliveryDate || null,
        delayReason: delayReason.trim() || null,
        remark: remark.trim() || null,
        lines: lines.map((l) => ({
          lineId: l.lineId ?? null,
          productId: l.productId!,
          qty: l.qty ?? null,
          unit: null,
        })),
      });
      message.success('订单已更新');
      onDone();
    } catch {
      // 请求层已显示后端返回的具体中文原因，避免再用英文状态码覆盖提示。
    } finally {
      setSaving(false);
    }
  };

  const cols: ColumnsType<FormLine> = [
    {
      title: '产品(款)',
      width: 280,
      onHeaderCell: hcell,
      render: (_, r) => (
        <Select
          size="small"
          showSearch
          disabled={locked}
          value={r.productId}
          onChange={(v) => patchLine(r.id, 'productId', v)}
          options={prodOpts}
          style={{ width: '100%' }}
          placeholder="选产品"
          filterOption={(input, option) => (option?.label ?? '').toString().includes(input)}
        />
      ),
    },
    {
      title: '数量',
      width: 130,
      onHeaderCell: hcell,
      render: (_, r) => <InputNumber size="small" disabled={locked} value={r.qty} min={0} onChange={(v) => patchLine(r.id, 'qty', v ?? undefined)} style={{ width: '100%' }} />,
    },
    {
      title: '',
      width: 50,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, r) => locked ? null : <a style={{ color: palette.bad }} onClick={() => removeLine(r.id)}><DeleteOutlined /></a>,
    },
  ];

  return (
    <Drawer
      title={`编辑外发订单 · ${orderNo}`}
      width={850}
      open={!!id}
      onClose={onClose}
      destroyOnHidden
      extra={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存修改</Button></Space>}
    >
      <Spin spinning={loading}>
        {locked && <Alert type="warning" showIcon message="该订单已有回货或质检记录，加工厂、款式和数量已锁定。" style={{ marginBottom: 14 }} />}
        <Alert type="info" showIcon message="订单编号不可修改；外发价格请在订单明细中维护。" style={{ marginBottom: 14 }} />
        <div style={{ background: palette.blueSoft, padding: '12px 16px', borderRadius: 10, marginBottom: 16 }}>
          <Space size={12} wrap>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>订单号</span><Input value={orderNo} disabled style={{ width: 170 }} /></span>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>加工厂 *</span><Select showSearch disabled={locked} value={supplierId} onChange={setSupplierId} options={supOpts} style={{ width: 180 }} filterOption={(input, option) => (option?.label ?? '').toString().includes(input)} /></span>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>下单日 *</span><DatePicker value={orderDate ? dayjs(orderDate) : null} onChange={(d) => setOrderDate(d ? d.format('YYYY-MM-DD') : '')} allowClear={false} /></span>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>交付日</span><DatePicker value={deliveryDate ? dayjs(deliveryDate) : null} onChange={(d) => setDeliveryDate(d ? d.format('YYYY-MM-DD') : '')} /></span>
            <span style={{ minWidth: 240 }}>状态 <Tag color={STATUS_COLOR[status] ?? 'default'}>{status || '—'}</Tag></span>
            <span style={{ width: 250 }}>生产完成进度 <Progress percent={progress} size="small" style={{ width: 130, marginLeft: 8 }} format={(p) => <span style={{ color: palette.ok }}>{p}%</span>} /></span>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>延期原因</span><Input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} style={{ width: 220 }} /></span>
            <span><span style={{ color: palette.inkSoft, marginRight: 8 }}>备注</span><Input value={remark} onChange={(e) => setRemark(e.target.value)} style={{ width: 280 }} /></span>
          </Space>
        </div>
        <Table<FormLine> rowKey="id" size="small" bordered columns={cols} dataSource={lines} pagination={false} />
        {!locked && <Button icon={<PlusOutlined />} onClick={addLine} style={{ borderStyle: 'dashed', marginTop: 12 }}>加一行</Button>}
      </Spin>
    </Drawer>
  );
}
function OrderFormDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [sups, setSups] = useState<SupplierDto[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [orderNo, setOrderNo] = useState('');
  const [supplierId, setSupplierId] = useState<number>();
  const [orderDate, setOrderDate] = useState(TODAY);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<FormLine[]>([{ id: 1 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrderNo('');
    setSupplierId(undefined);
    setOrderDate(TODAY);
    setDeliveryDate('');
    setRemark('');
    setLines([{ id: 1 }]);
    Promise.all([supplierApi.list(), productApi.list({ pageSize: 1000 })]).then(([ss, ps]) => {
      setSups(ss);
      setProds(ps.items);
    });
  }, [open]);

  const supOpts = sups.map((s) => ({ value: s.supplierId, label: s.supplierName }));
  const prodOpts = prods.map((p) => ({ value: p.productId, label: `${p.seriesCode ?? p.productCode} ${p.styleNo ?? ''} ${p.productName}`.trim() }));

  const patch = (id: number, key: keyof FormLine, val: unknown) => setLines((ls) => ls.map((r) => (r.id === id ? { ...r, [key]: val } : r)));
  const addLine = () => setLines((ls) => [...ls, { id: Date.now() }]);
  const delLine = (id: number) => setLines((ls) => (ls.length > 1 ? ls.filter((r) => r.id !== id) : ls));

  const save = async () => {
    if (!orderNo.trim()) return message.warning('请填订单号');
    if (!supplierId) return message.warning('请选加工厂');
    if (!orderDate.trim()) return message.warning('请填下单日');
    const valid = lines.filter((l) => l.productId && l.qty != null);
    if (!valid.length) return message.warning('至少填一行完整明细（款式 / 数量）');
    setSaving(true);
    try {
      await orderApi.create({
        orderNo: orderNo.trim(),
        supplierId,
        orderDate: orderDate.trim(),
        deliveryDate: deliveryDate.trim() || null,
        remark: remark.trim() || null,
        lines: valid.map((l) => ({ productId: l.productId!, qty: l.qty ?? null, unit: 'PCS' })),
      });
      message.success('订单已建立，可在订单明细中填写外发价格');
      onDone();
    } catch (e) {
      message.error((e as Error)?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const cols: ColumnsType<FormLine> = [
    {
      title: '产品(款)',
      width: 220,
      onHeaderCell: hcell,
      render: (_, r) => (
        <Select
          size="small"
          showSearch
          value={r.productId}
          onChange={(v) => patch(r.id, 'productId', v)}
          options={prodOpts}
          style={{ width: '100%' }}
          placeholder="选产品"
          filterOption={(i, o) => (o?.label ?? '').toString().includes(i)}
        />
      ),
    },
    {
      title: '订单数量',
      width: 90,
      onHeaderCell: hcell,
      render: (_, r) => <InputNumber size="small" value={r.qty} onChange={(v) => patch(r.id, 'qty', v ?? undefined)} min={0} style={{ width: '100%' }} />,
    },
    {
      title: '',
      width: 40,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, r) => (
        <a style={{ color: palette.bad }} onClick={() => delLine(r.id)}>
          <DeleteOutlined />
        </a>
      ),
    },
  ];

  return (
    <Drawer
      title="新建外发订单"
      width={920}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={save}>
            建立订单
          </Button>
        </Space>
      }
    >
      {/* 订单头 */}
      <Space size={12} wrap style={{ marginBottom: 16, background: palette.blueSoft, padding: '12px 16px', borderRadius: 10 }}>
        <span>
          <span style={{ color: palette.inkSoft, marginRight: 8 }}>订单号 *</span>
          <Input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} style={{ width: 160 }} placeholder="按你的编号规则" />
        </span>
        <span>
          <span style={{ color: palette.inkSoft, marginRight: 8 }}>加工厂 *</span>
          <Select showSearch value={supplierId} onChange={setSupplierId} options={supOpts} style={{ width: 180 }} placeholder="选加工厂" filterOption={(i, o) => (o?.label ?? '').toString().includes(i)} />
        </span>
        <span>
          <span style={{ color: palette.inkSoft, marginRight: 8 }}>下单日 *</span>
          <DatePicker
            value={orderDate ? dayjs(orderDate) : null}
            onChange={(d) => setOrderDate(d ? d.format('YYYY-MM-DD') : '')}
            format="YYYY-MM-DD"
            allowClear={false}
            style={{ width: 140 }}
            placeholder="选下单日"
          />
        </span>
        <span>
          <span style={{ color: palette.inkSoft, marginRight: 8 }}>交付日</span>
          <DatePicker
            value={deliveryDate ? dayjs(deliveryDate) : null}
            onChange={(d) => setDeliveryDate(d ? d.format('YYYY-MM-DD') : '')}
            format="YYYY-MM-DD"
            style={{ width: 140 }}
            placeholder="选填"
          />
        </span>
        <span>
          <span style={{ color: palette.inkSoft, marginRight: 8 }}>备注</span>
          <Input value={remark} onChange={(e) => setRemark(e.target.value)} style={{ width: 180 }} placeholder="选填" />
        </span>
      </Space>

      <Table<FormLine> rowKey="id" size="small" bordered columns={cols} dataSource={lines} pagination={false} />
      <Button icon={<PlusOutlined />} onClick={addLine} style={{ borderStyle: 'dashed', marginTop: 12 }}>
        加一行
      </Button>
    </Drawer>
  );
}

/* —— 订单明细（只读查看·含价）—— */
function OrderDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { role } = useAuth();
  const canPrice = can.editOutPrice(role);
  const canDeleteDelivery = role === '管理员';
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingLine, setEditingLine] = useState<OrderDetailDto['lines'][number] | null>(null);
  const [editPrice, setEditPrice] = useState<number | null>(null);
  const [editReason, setEditReason] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [historyLine, setHistoryLine] = useState<OrderDetailDto['lines'][number] | null>(null);
  const [history, setHistory] = useState<OrderPriceHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNoteDto[]>([]);

  useEffect(() => {
    if (!id) {
      setOrder(null);
      setDeliveryNotes([]);
      return;
    }
    setLoading(true);
    Promise.all([orderApi.get(id), deliveryNoteApi.listByOrder(id)])
      .then(([orderResult, noteResult]) => {
        setOrder(orderResult);
        setDeliveryNotes(noteResult);
      })
      .finally(() => setLoading(false));
  }, [id]);
  const removeDeliveryNote = async (deliveryNoteId: number) => {
    await deliveryNoteApi.remove(deliveryNoteId);
    message.success('回货批次已删除');
    if (id) {
      const [orderResult, noteResult] = await Promise.all([orderApi.get(id), deliveryNoteApi.listByOrder(id)]);
      setOrder(orderResult);
      setDeliveryNotes(noteResult);
    }
  };
  const openPriceEditor = (line: OrderDetailDto['lines'][number]) => {
    setEditingLine(line);
    setEditPrice(line.outsourcePriceExcl ?? null);
    setEditReason('');
  };
  const savePrice = async () => {
    if (!editingLine || editPrice == null) {
      message.warning('请填写外发价');
      return;
    }
    const isChange = editingLine.outsourcePriceExcl != null && editingLine.outsourcePriceExcl !== editPrice;
    const isOver = editingLine.internalPriceExcl != null && editPrice > editingLine.internalPriceExcl;
    if ((isChange || isOver) && !editReason.trim()) {
      message.warning(isOver ? '外发价高于本厂核价，请填写原因' : '修改已有价格必须填写原因');
      return;
    }
    setSavingPrice(true);
    try {
      await orderPricingApi.updateLine(editingLine.lineId, editPrice, editReason.trim() || null);
      message.success('外发价已保存');
      setEditingLine(null);
      if (id) setOrder(await orderApi.get(id));
    } finally {
      setSavingPrice(false);
    }
  };
  const openHistory = async (line: OrderDetailDto['lines'][number]) => {
    setHistoryLine(line);
    setHistoryLoading(true);
    try {
      setHistory(await orderPricingApi.history(line.lineId));
    } finally {
      setHistoryLoading(false);
    }
  };

  const cols: ColumnsType<OrderDetailDto['lines'][number]> = [
    { title: '产品(款)', dataIndex: 'productLabel', onHeaderCell: hcell },
    { title: '数量', dataIndex: 'qty', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => v ?? dash },
    { title: '报客价', dataIndex: 'customerQuoteExcl', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => yuan(v) },
    { title: '本厂核价', dataIndex: 'internalPriceExcl', width: 90, align: 'right', onHeaderCell: hcell, render: (v) => yuan(v) },
    {
      title: '外发价', dataIndex: 'outsourcePriceExcl', width: 120, align: 'right', onHeaderCell: hcell,
      render: (v, l) => (
        <Space size={5}>
          <span style={{ color: palette.amber }}>{yuan(v)}</span>
          {canPrice && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openPriceEditor(l)} />}
        </Space>
      ),
    },
    { title: '外发&本厂占比', dataIndex: 'outsourceInternalRate', width: 130, align: 'right', onHeaderCell: hcell, render: (v) => v == null ? dash : `${v.toFixed(2)}%` },
    {
      title: '省 / 超标',
      key: 'cmp',
      width: 130,
      align: 'right',
      onHeaderCell: hcell,
      render: (_, l) => {
        if (l.compliance == null) return dash;
        const over = l.compliance === '超标';
        return <span style={{ color: over ? palette.bad : palette.ok, fontWeight: 600 }}>{over ? '超标' : '节约'} ¥{Math.abs(l.saving ?? 0).toFixed(2)}</span>;
      },
    },
    {
      title: '记录',
      key: 'history',
      width: 72,
      align: 'center',
      onHeaderCell: hcell,
      render: (_, line) => <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => void openHistory(line)}>历史</Button>,
    },
  ];

  return (
    <Drawer title={`订单明细 · ${order?.orderNo ?? ''}`} width={760} open={!!id} onClose={onClose} destroyOnHidden>
      <Spin spinning={loading}>
        {order && (
          <>
            <Space size={20} wrap style={{ marginBottom: 14, color: palette.ink }}>
              <span>加工厂 <b>{order.supplierName}</b></span>
              <span>下单 {order.orderDate}</span>
              <span>交付 {order.deliveryDate ?? '—'}</span>
              <Tag color="blue">{order.status}</Tag>
            </Space>
            {order.isPricingComplete ? <div
              style={{
                background: order.hasOver ? '#fdeef1' : palette.okSoft,
                border: `1px solid ${order.hasOver ? palette.bad : palette.ok}`,
                borderRadius: 10,
                padding: '10px 16px',
                marginBottom: 14,
                display: 'flex',
                gap: 24,
              }}
            >
              {/* 内部核价总价 = 外发合计 + 共省（saving = 内部核价 − 外发）*/}
              <span>内部核价总价 <b style={{ color: palette.blueDark }}>¥{((order.outsourceTotal ?? 0) + (order.saving ?? 0)).toFixed(2)}</b></span>
              <span>外发合计 <b style={{ color: palette.amber }}>¥{(order.outsourceTotal ?? 0).toFixed(2)}</b></span>
              {order.hasOver ? (
                <span style={{ color: palette.bad, fontWeight: 700 }}>有超标（外发价高于内部核价）</span>
              ) : (
                <span style={{ color: palette.ok, fontWeight: 700 }}>共省 ¥{(order.saving ?? 0).toFixed(2)}</span>
              )}
            </div> : <Alert type="warning" showIcon message="该订单尚未完成核价，暂不计算外发金额和节约金额。" style={{ marginBottom: 14 }} />}

            <Table rowKey="lineId" size="small" bordered columns={cols} dataSource={order.lines} pagination={false} />
            <div style={{ marginTop: 20, marginBottom: 8, fontWeight: 700 }}>回货批次</div>
            <Table<DeliveryNoteDto>
              rowKey="deliveryNoteId"
              size="small"
              bordered
              dataSource={deliveryNotes}
              pagination={false}
              locale={{ emptyText: '暂无回货批次' }}
              columns={[
                { title: '送货单号', dataIndex: 'noteNo', onHeaderCell: hcell },
                { title: '回货日期', dataIndex: 'receivedDate', width: 120, onHeaderCell: hcell },
                { title: '明细数', dataIndex: 'items', width: 90, align: 'center', onHeaderCell: hcell, render: (items) => items.length },
                {
                  title: '操作',
                  width: 90,
                  align: 'center',
                  onHeaderCell: hcell,
                  render: (_, note) => canDeleteDelivery ? (
                    <Popconfirm
                      title={`删除回货批次 ${note.noteNo}？`}
                      description="该批次及其回货明细将永久删除。"
                      onConfirm={() => removeDeliveryNote(note.deliveryNoteId)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <a style={{ color: palette.bad }}>删除</a>
                    </Popconfirm>
                  ) : dash,
                },
              ]}
            />
            <Modal
              title={`维护外发价 · ${editingLine?.productLabel ?? ''}`}
              open={!!editingLine}
              onCancel={() => setEditingLine(null)}
              onOk={() => void savePrice()}
              confirmLoading={savingPrice}
              okText="保存"
            >
              <Space direction="vertical" style={{ width: '100%' }} size={14}>
                <div>
                  <div style={{ marginBottom: 6 }}>外发价（不含税）</div>
                  <InputNumber min={0} precision={4} value={editPrice} onChange={setEditPrice} style={{ width: '100%' }} />
                </div>
                <div>
                  <div style={{ marginBottom: 6 }}>修改原因</div>
                  <Input.TextArea
                    value={editReason}
                    onChange={(event) => setEditReason(event.target.value)}
                    rows={3}
                    maxLength={300}
                    placeholder="首次填写可选；修改已有价格、超价或入库后改价时必填"
                  />
                </div>
              </Space>
            </Modal>
            <Drawer
              title={`价格历史 · ${historyLine?.productLabel ?? ''}`}
              width={620}
              open={!!historyLine}
              onClose={() => setHistoryLine(null)}
            >
              <Table<OrderPriceHistory>
                rowKey="historyId"
                loading={historyLoading}
                dataSource={history}
                pagination={false}
                columns={[
                  { title: '原价', dataIndex: 'oldPriceExcl', width: 90, render: (value) => yuan(value, 4) },
                  { title: '新价', dataIndex: 'newPriceExcl', width: 90, render: (value) => yuan(value, 4) },
                  { title: '原因', dataIndex: 'changeReason', render: (value) => value || '—' },
                  { title: '修改人', dataIndex: 'changedByName', width: 90, render: (value) => value || '—' },
                  { title: '时间', dataIndex: 'changedAt', width: 155, render: (value) => dayjs(value).format('YYYY-MM-DD HH:mm') },
                ]}
              />
            </Drawer>
          </>
        )}
      </Spin>
    </Drawer>
  );
}
