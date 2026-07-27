import { SaveOutlined } from '@ant-design/icons';
import { Alert, App, Button, Input, InputNumber, Select, Space, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { productApi } from '../api/products';
import { productQuoteApi, type ProductPrice } from '../api/productQuotes';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { palette } from '../theme';
import CreateSeriesDrawer from './CreateSeriesDrawer';

const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });

export default function ProductQuoteLibrary() {
  const { message } = App.useApp();
  const { user, role } = useAuth();
  const editable = can.editSelfCost(role);
  const deptId = user?.deptId ?? 1;
  const [seriesOptions, setSeriesOptions] = useState<{ value: string; label: string }[]>([]);
  const [seriesCode, setSeriesCode] = useState('');
  const [rows, setRows] = useState<ProductPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const refreshSeries = async () => {
    const prods = await productApi.list({ pageSize: 1000 });
    const series = [...new Set(prods.items.map((p) => p.seriesCode ?? p.productCode).filter(Boolean))];
    setSeriesOptions(series.map((s) => ({ value: s, label: s })));
    if (!seriesCode && series.length) setSeriesCode(series[0]);
  };
  useEffect(() => { refreshSeries(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const load = async () => {
    if (!seriesCode) return;
    setLoading(true);
    try { setRows(await productQuoteApi.getBySeries(seriesCode)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seriesCode]);

  const patch = (id: number, key: keyof ProductPrice, value: unknown) =>
    setRows((all) => all.map((r) => r.productId === id ? { ...r, [key]: value } : r));
  const save = async (row: ProductPrice) => {
    setSavingId(row.productId);
    try {
      await productQuoteApi.save(row.productId, deptId, {
        customerName: row.customerName?.trim() || null,
        customerQuoteExcl: row.customerQuoteExcl ?? null,
        internalPriceExcl: row.internalPriceExcl ?? 0,
        dongguanPriceExcl: row.dongguanPriceExcl ?? null,
        hunanPriceExcl: row.hunanPriceExcl ?? null,
        remark: row.remark?.trim() || null,
      });
      message.success(`${seriesCode} ${row.productName} 已保存`);
      load();
    } finally { setSavingId(null); }
  };
  const price = (id: number, key: 'customerQuoteExcl' | 'internalPriceExcl' | 'dongguanPriceExcl' | 'hunanPriceExcl', value: number | null) =>
    patch(id, key, value ?? undefined);
  const columns: ColumnsType<ProductPrice> = [
    { title: '客户', dataIndex: 'customerName', width: 120, onHeaderCell: hcell, render: (v, r) => <Input value={v ?? ''} disabled={!editable} onChange={(e) => patch(r.productId, 'customerName', e.target.value)} /> },
    { title: '货号', width: 110, onHeaderCell: hcell, render: () => <b>{seriesCode}</b> },
    { title: '款式', dataIndex: 'productName', width: 190, onHeaderCell: hcell, render: (v) => <b>{v}</b> },
    { title: '报客价', dataIndex: 'customerQuoteExcl', width: 130, onHeaderCell: hcell, render: (v, r) => <InputNumber min={0} precision={4} value={v} disabled={!editable} onChange={(x) => price(r.productId, 'customerQuoteExcl', x)} style={{ width: '100%' }} /> },
    { title: '本厂核价', dataIndex: 'internalPriceExcl', width: 130, onHeaderCell: hcell, render: (v, r) => <InputNumber min={0} precision={4} value={v} disabled={!editable} onChange={(x) => price(r.productId, 'internalPriceExcl', x)} style={{ width: '100%' }} /> },
    { title: '外发东莞价', dataIndex: 'dongguanPriceExcl', width: 130, onHeaderCell: hcell, render: (v, r) => <InputNumber min={0} precision={4} value={v} disabled={!editable} onChange={(x) => price(r.productId, 'dongguanPriceExcl', x)} style={{ width: '100%' }} /> },
    { title: '外发湖南价', dataIndex: 'hunanPriceExcl', width: 130, onHeaderCell: hcell, render: (v, r) => <InputNumber min={0} precision={4} value={v} disabled={!editable} onChange={(x) => price(r.productId, 'hunanPriceExcl', x)} style={{ width: '100%' }} /> },
    { title: '备注', dataIndex: 'remark', width: 180, onHeaderCell: hcell, render: (v, r) => <Input value={v ?? ''} disabled={!editable} onChange={(e) => patch(r.productId, 'remark', e.target.value)} /> },
    { title: '操作', width: 110, fixed: 'right', onHeaderCell: hcell, render: (_, r) => editable ? <Button type="primary" size="small" icon={<SaveOutlined />} loading={savingId === r.productId} onClick={() => save(r)}>保存</Button> : <Tag>只读</Tag> },
  ];
  return (
    <div style={{ background: palette.raised, border: `1px solid ${palette.line}`, borderRadius: 16, padding: 20, marginTop: 16 }}>
      <Alert type="info" showIcon message="每个款式维护一组产品总价，全部为人民币不含税单价；核价库不做占比和节约分析。" style={{ marginBottom: 14 }} />
      <Space wrap style={{ marginBottom: 14 }}>
        <span>货号</span>
        <Select showSearch value={seriesCode || undefined} onChange={setSeriesCode} options={seriesOptions} style={{ width: 180 }} />
        {editable && <CreateSeriesDrawer onCreated={async (code) => { await refreshSeries(); setSeriesCode(code); }} triggerText="新建货号 / 款式" />}
      </Space>
      <Spin spinning={loading}>
        <Table rowKey="productId" size="small" bordered columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1200 }} />
      </Spin>
    </div>
  );
}
