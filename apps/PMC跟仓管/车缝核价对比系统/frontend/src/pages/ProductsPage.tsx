import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Empty, Input, InputNumber, Popconfirm, Space, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { productApi, type ProductSeriesRow } from '../api/products';
import { productQuoteApi, type ProductPrice } from '../api/productQuotes';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { palette } from '../theme';
import CreateSeriesDrawer from '../components/CreateSeriesDrawer';
import ImportPricesDrawer from '../components/ImportPricesDrawer';

/* 模块一 · 阶段A —— 产品库（产品核价表）
   一个货号(系列)一行；款数=该货号下款数。新建货号可一次建多个款（款号 #1/#2… 自动排）。
   产品库只读查看核价；货号无历史业务关联时支持永久删除。 */

const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700 } });
const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString('zh-CN') : '—');

export default function ProductsPage() {
  const { message } = App.useApp();
  const { user, role } = useAuth();
  const canEdit = can.editProducts(role); // 产品库写权：业务/管理员
  const canViewPrices = can.viewPrices(role);
  const [data, setData] = useState<ProductSeriesRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailCode, setDetailCode] = useState<string | null>(null); // 当前查看明细的货号

  const load = (p = page, ps = pageSize, k = kw) => {
    setLoading(true);
    productApi
      .seriesSummary({ keyword: k || undefined, page: p, pageSize: ps })
      .then((res) => {
        setData(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = (value: string) => {
    setKw(value);
    setPage(1);
    load(1, pageSize, value);
  };

  const remove = async (code: string) => {
    const result = await productApi.removeSeries(code);
    message.success(`货号 ${code} 已永久删除（${result.productCount} 个款式）`);
    load();
  };

  const columns: ColumnsType<ProductSeriesRow> = [
    {
      title: '产品货号',
      dataIndex: 'code',
      width: 220,
      onHeaderCell: hcell,
      // 点货号 → 右侧抽屉维护该货号下 每款×工艺×内部核价
      render: (v: string) => canViewPrices ? (
        <a style={{ fontWeight: 700, color: palette.blue }} onClick={() => setDetailCode(v)}>{v}</a>
      ) : <b>{v}</b>,
    },
    { title: '款数', dataIndex: 'styleCount', width: 110, align: 'center', onHeaderCell: hcell },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 110,
      align: 'center',
      onHeaderCell: hcell,
      render: (v: boolean) => (v ? <Tag color="success">已生效</Tag> : <Tag>停用</Tag>),
    },
    { title: '修改日期', dataIndex: 'lastModified', width: 150, onHeaderCell: hcell, render: (v) => fmtDate(v) },
    {
      title: '修改人',
      dataIndex: 'lastModifiedBy',
      width: 120,
      onHeaderCell: hcell,
      render: (v) => v ?? <span style={{ color: palette.inkSoft }}>—</span>,
    },
    {
      title: '操作',
      key: 'op',
      width: 140,
      onHeaderCell: hcell,
      // 无写权角色(外发/跟单/管理层)只读查看，不显示删除
      render: (_, row) =>
        canEdit ? (
          <Space size={12}>
            <Popconfirm
              title={`永久删除货号 ${row.code}？`}
              description="系统会先检查历史业务；有关联时将阻止删除。无关联时会同时删除该货号的款式、核价和别名，且无法恢复。"
              onConfirm={() => remove(row.code)}
              okText="永久删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <a style={{ color: palette.bad }}>删除</a>
            </Popconfirm>
          </Space>
        ) : (
          <span style={{ color: palette.inkSoft }}>—</span>
        ),
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>产品核价库</div>

      <div
        style={{
          background: palette.raised,
          border: `1px solid ${palette.line}`,
          borderRadius: 18,
          boxShadow: '0 2px 8px rgba(31,99,216,0.05)',
          padding: '22px 24px',
          marginTop: 16,
        }}
      >
        {/* 工具条 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Input.Search
            prefix={<SearchOutlined style={{ color: palette.inkSoft }} />}
            placeholder="搜货号"
            allowClear
            onSearch={onSearch}
            style={{ width: 320 }}
          />
          {canEdit && <CreateSeriesDrawer onCreated={() => load()} triggerText="新建货号 / 产品" />}
          {canEdit && <ImportPricesDrawer deptId={user?.deptId ?? 1} onDone={() => load()} />}
          <span style={{ color: palette.inkSoft, marginLeft: 'auto' }}>有关联业务的货号需先清理关联业务后才能删除</span>
        </div>

        <Table<ProductSeriesRow>
          rowKey="code"
          size="middle"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个货号`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </div>

      {/* 点货号 → 在抽屉中查看或维护核价 */}
      <ProductDetailDrawer code={detailCode} onClose={() => setDetailCode(null)} />

    </div>
  );
}

/* —— 货号明细：保留原抽屉交互；每款维护一组产品总价 —— */
function ProductDetailDrawer({ code, onClose }: { code: string | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { user, role } = useAuth();
  const editable = can.editSelfCost(role);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [data, setData] = useState<ProductPrice[]>([]);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    productQuoteApi.getBySeries(code).then(setData)
      .finally(() => setLoading(false));
  }, [code]);

  const patch = (productId: number, key: keyof ProductPrice, value: unknown) =>
    setData((rows) => rows.map((row) => row.productId === productId ? { ...row, [key]: value } : row));

  const saveProduct = async (row: ProductPrice) => {
    setSavingId(row.productId);
    try {
      await productQuoteApi.save(row.productId, user?.deptId ?? 1, {
        customerName: row.customerName?.trim() || null,
        customerQuoteExcl: row.customerQuoteExcl ?? null,
        internalPriceExcl: row.internalPriceExcl ?? 0,
        dongguanPriceExcl: row.dongguanPriceExcl ?? null,
        hunanPriceExcl: row.hunanPriceExcl ?? null,
        remark: row.remark?.trim() || null,
      });
      message.success(`${row.styleNo ?? ''} ${row.productName} 的产品总价已保存`);
    } finally {
      setSavingId(null);
    }
  };

  const money = (productId: number, key: 'customerQuoteExcl' | 'internalPriceExcl' | 'dongguanPriceExcl' | 'hunanPriceExcl', value: number | null) =>
    patch(productId, key, value ?? undefined);
  const cols: ColumnsType<ProductPrice> = [
    { title: '客户', dataIndex: 'customerName', width: 120, onHeaderCell: hcell, render: (v, r) => editable ? <Input value={v ?? ''} onChange={(e) => patch(r.productId, 'customerName', e.target.value)} /> : v || '—' },
    { title: '款式', dataIndex: 'productName', width: 170, onHeaderCell: hcell, render: (v, r) => <b>{r.styleNo} {v}</b> },
    { title: '报客价', dataIndex: 'customerQuoteExcl', width: 120, onHeaderCell: hcell, render: (v, r) => editable ? <InputNumber min={0} precision={4} value={v} onChange={(x) => money(r.productId, 'customerQuoteExcl', x)} style={{ width: '100%' }} /> : v == null ? '—' : `¥${v.toFixed(4)}` },
    { title: '本厂核价', dataIndex: 'internalPriceExcl', width: 120, onHeaderCell: hcell, render: (v, r) => editable ? <InputNumber min={0} precision={4} value={v} onChange={(x) => money(r.productId, 'internalPriceExcl', x)} style={{ width: '100%' }} /> : `¥${v.toFixed(4)}` },
    { title: '外发东莞价', dataIndex: 'dongguanPriceExcl', width: 125, onHeaderCell: hcell, render: (v, r) => editable ? <InputNumber min={0} precision={4} value={v} onChange={(x) => money(r.productId, 'dongguanPriceExcl', x)} style={{ width: '100%' }} /> : v == null ? '—' : `¥${v.toFixed(4)}` },
    { title: '外发湖南价', dataIndex: 'hunanPriceExcl', width: 125, onHeaderCell: hcell, render: (v, r) => editable ? <InputNumber min={0} precision={4} value={v} onChange={(x) => money(r.productId, 'hunanPriceExcl', x)} style={{ width: '100%' }} /> : v == null ? '—' : `¥${v.toFixed(4)}` },
    { title: '备注', dataIndex: 'remark', width: 170, onHeaderCell: hcell, render: (v, r) => editable ? <Input value={v ?? ''} onChange={(e) => patch(r.productId, 'remark', e.target.value)} /> : v || '—' },
    { title: '操作', width: 95, fixed: 'right', onHeaderCell: hcell, render: (_, r) => editable ? <Button type="primary" size="small" icon={<SaveOutlined />} loading={savingId === r.productId} onClick={() => saveProduct(r)}>保存</Button> : '—' },
  ];

  return (
    <Drawer
      title={code ? `货号 ${code}（共 ${data.length} 个款）` : '货号明细'}
      width={1280}
      open={!!code}
      onClose={onClose}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {data.length === 0 && !loading ? (
          <Empty description="该货号下暂无款 / 核价" />
        ) : (
          <Table rowKey="productId" size="small" bordered columns={cols} dataSource={data} pagination={false} scroll={{ x: 1200 }} />
        )}
      </Spin>
    </Drawer>
  );
}
