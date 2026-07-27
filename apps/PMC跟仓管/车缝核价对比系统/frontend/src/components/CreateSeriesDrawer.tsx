import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Input, InputNumber, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { deptApi } from '../api/depts';
import { productApi } from '../api/products';
import { productQuoteApi } from '../api/productQuotes';
import { palette } from '../theme';

/* 共享 · 新建货号 / 款（一个货号一次建多个款，款号 #1/#2… 自动排）
   录入只有一个口：产品库与核价录入页都复用本组件落库（走 POST /api/products/series）。
   建好后通过 onCreated 回传货号，调用方可定位到该货号继续录价。 */

interface KuanRow {
  id: number;
  productName: string;
  customerName: string;
  customerQuoteExcl?: number;
  internalPriceExcl?: number;
  dongguanPriceExcl?: number;
  hunanPriceExcl?: number;
  remark: string;
}

interface Props {
  /** 建成功后回调：返回新建的货号 + 款数 */
  onCreated: (seriesCode: string, count: number) => void;
  /** 触发按钮文字，默认「新建货号」 */
  triggerText?: string;
  /** 触发按钮类型，默认 primary */
  triggerType?: 'primary' | 'default';
}

export default function CreateSeriesDrawer({ onCreated, triggerText = '新建货号', triggerType = 'primary' }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [seriesCode, setSeriesCode] = useState('');
  const [deptId, setDeptId] = useState<number | undefined>();
  const [depts, setDepts] = useState<{ label: string; value: number }[]>([]);
  const emptyRow = (id: number): KuanRow => ({ id, productName: '', customerName: '', remark: '' });
  const [rows, setRows] = useState<KuanRow[]>([emptyRow(1)]);
  const [saving, setSaving] = useState(false);

  const openDrawer = async () => {
    setOpen(true);
    if (depts.length === 0) {
      const ds = await deptApi.list();
      const opts = ds.map((d) => ({ label: d.deptName, value: d.deptId }));
      setDepts(opts);
      if (opts.length) setDeptId(opts[0].value);
    }
  };
  const reset = () => {
    setSeriesCode('');
    setRows([emptyRow(1)]);
  };
  const patch = (id: number, k: keyof KuanRow, v: string | number | undefined) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow(Date.now())]);
  const delRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const submit = async () => {
    const code = seriesCode.trim();
    if (!code) return message.warning('请填货号');
    if (!deptId) return message.warning('请选择部门');
    const activeRows = rows.filter((r) => r.productName.trim());
    const items = activeRows.map((r) => ({ productName: r.productName.trim(), spec: null }));
    if (items.length === 0) return message.warning('至少填一个款名');
    setSaving(true);
    try {
      const count = await productApi.createSeries({ seriesCode: code, deptId, isActive: true, items });
      const created = await productApi.list({ keyword: code, deptId, pageSize: 500 });
      for (const row of activeRows) {
        const product = created.items.find((p) =>
          (p.seriesCode ?? p.productCode) === code && p.productName === row.productName.trim());
        if (!product) continue;
        await productQuoteApi.save(product.productId, deptId, {
          customerName: row.customerName.trim() || null,
          customerQuoteExcl: row.customerQuoteExcl ?? null,
          internalPriceExcl: row.internalPriceExcl ?? 0,
          dongguanPriceExcl: row.dongguanPriceExcl ?? null,
          hunanPriceExcl: row.hunanPriceExcl ?? null,
          remark: row.remark.trim() || null,
        });
      }
      message.success(`货号 ${code} 已新建 ${count} 个款`);
      setOpen(false);
      reset();
      onCreated(code, count);
    } catch (e) {
      message.error((e as Error)?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const cols: ColumnsType<KuanRow> = [
    {
      title: '款式 *',
      dataIndex: 'productName',
      render: (_, r) => (
        <Input value={r.productName} onChange={(e) => patch(r.id, 'productName', e.target.value)} />
      ),
    },
    { title: '客户', dataIndex: 'customerName', width: 115, render: (_, r) => <Input value={r.customerName} onChange={(e) => patch(r.id, 'customerName', e.target.value)} /> },
    { title: '报客价', dataIndex: 'customerQuoteExcl', width: 110, render: (_, r) => <InputNumber min={0} precision={4} value={r.customerQuoteExcl} onChange={(v) => patch(r.id, 'customerQuoteExcl', v ?? undefined)} style={{ width: '100%' }} /> },
    { title: '本厂核价', dataIndex: 'internalPriceExcl', width: 110, render: (_, r) => <InputNumber min={0} precision={4} value={r.internalPriceExcl} onChange={(v) => patch(r.id, 'internalPriceExcl', v ?? undefined)} style={{ width: '100%' }} /> },
    { title: '外发东莞价', dataIndex: 'dongguanPriceExcl', width: 120, render: (_, r) => <InputNumber min={0} precision={4} value={r.dongguanPriceExcl} onChange={(v) => patch(r.id, 'dongguanPriceExcl', v ?? undefined)} style={{ width: '100%' }} /> },
    { title: '外发湖南价', dataIndex: 'hunanPriceExcl', width: 120, render: (_, r) => <InputNumber min={0} precision={4} value={r.hunanPriceExcl} onChange={(v) => patch(r.id, 'hunanPriceExcl', v ?? undefined)} style={{ width: '100%' }} /> },
    { title: '备注', dataIndex: 'remark', width: 150, render: (_, r) => <Input value={r.remark} onChange={(e) => patch(r.id, 'remark', e.target.value)} /> },
    {
      title: '',
      width: 44,
      align: 'center',
      render: (_, r) => (
        <a style={{ color: palette.bad }} onClick={() => delRow(r.id)}>
          <DeleteOutlined />
        </a>
      ),
    },
  ];

  return (
    <>
      <Button type={triggerType} icon={<PlusOutlined />} onClick={openDrawer}>
        {triggerText}
      </Button>
      <Drawer
        title="新建货号 / 产品价格"
        width={1280}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={submit}>
              保存
            </Button>
          </Space>
        }
      >
        <Space size={12} style={{ display: 'flex', marginBottom: 16 }} align="start">
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 6, color: palette.inkSoft }}>货号 *</div>
            <Input value={seriesCode} onChange={(e) => setSeriesCode(e.target.value)} placeholder="如 15783" />
          </div>
          <div style={{ width: 180 }}>
            <div style={{ marginBottom: 6, color: palette.inkSoft }}>部门 *</div>
            <Select value={deptId} onChange={setDeptId} options={depts} style={{ width: '100%' }} placeholder="选择部门" />
          </div>
        </Space>

        <div style={{ marginBottom: 8, color: palette.inkSoft, fontSize: 13 }}>
          每款直接维护产品总价；款号 #1 / #2… 自动生成
        </div>
        <Table<KuanRow> rowKey="id" size="small" bordered columns={cols} dataSource={rows} pagination={false} />
        <Button icon={<PlusOutlined />} onClick={addRow} style={{ borderStyle: 'dashed', marginTop: 12 }}>
          再加一个款
        </Button>
      </Drawer>
    </>
  );
}
