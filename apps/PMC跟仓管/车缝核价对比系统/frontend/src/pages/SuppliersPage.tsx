import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { deptApi } from '../api/depts';
import { supplierApi, type SupplierDto, type SupplierUpsert } from '../api/suppliers';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { palette } from '../theme';
import ImportSuppliersDrawer from '../components/ImportSuppliersDrawer';

/* 模块一 · 阶段2 —— 加工厂管理库（对齐《车缝-加工厂信息统计表》字段）
   列表 + 新建/编辑。导入 Excel 留下一步。 */

const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });
const dash = <span style={{ color: palette.inkSoft }}>—</span>;
const txt = (v?: string | null) => v ?? dash;
const n = (v?: number | null) => (v == null ? dash : v);

export default function SuppliersPage() {
  const { message } = App.useApp();
  const { user, role } = useAuth();
  const canEdit = can.editSuppliers(role); // 加工厂写权：外发/跟单/管理员
  const [data, setData] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [depts, setDepts] = useState<{ label: string; value: number }[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const [form] = Form.useForm<SupplierUpsert>();

  const load = () => {
    setLoading(true);
    supplierApi
      .list()
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    deptApi.list().then((ds) => setDepts(ds.map((d) => ({ label: d.deptName, value: d.deptId }))));
  }, []);

  const shown = useMemo(() => {
    const k = kw.trim();
    if (!k) return data;
    return data.filter((s) => `${s.supplierName}${s.contact ?? ''}${s.phone ?? ''}`.includes(k));
  }, [data, kw]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, mainProcess: '车缝', scope: '车缝部', deptId: user?.deptId } as Partial<SupplierUpsert>);
    setDrawerOpen(true);
  };
  const openEdit = (s: SupplierDto) => {
    setEditing(s);
    form.resetFields();
    form.setFieldsValue({
      supplierName: s.supplierName, contact: s.contact ?? undefined, phone: s.phone ?? undefined, address: s.address ?? undefined,
      equipmentCount: s.equipmentCount ?? undefined, machinesForUs: s.machinesForUs ?? undefined, employeeCount: s.employeeCount ?? undefined,
      monthlyCapacity: s.monthlyCapacity ?? undefined, mainProcess: s.mainProcess ?? undefined, qualification: s.qualification ?? undefined,
      scope: s.scope ?? undefined, deptId: s.deptId, isActive: s.isActive,
    } as SupplierUpsert);
    setDrawerOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    const body: SupplierUpsert = { ...v, deptId: v.deptId ?? user?.deptId ?? 1 };
    if (editing) await supplierApi.update(editing.supplierId, body);
    else await supplierApi.create(body);
    message.success(editing ? '已更新' : '已新建');
    setDrawerOpen(false);
    load();
  };
  const del = async (id: number) => {
    await supplierApi.remove(id);
    message.success('已删除');
    load();
  };

  const columns: ColumnsType<SupplierDto> = [
    { title: '加工厂名称', dataIndex: 'supplierName', width: 130, fixed: 'left', onHeaderCell: hcell, render: (v) => <b>{v}</b> },
    { title: '联系人', dataIndex: 'contact', width: 90, onHeaderCell: hcell, render: txt },
    { title: '联系电话', dataIndex: 'phone', width: 130, onHeaderCell: hcell, render: txt },
    { title: '工厂地址', dataIndex: 'address', width: 240, className: 'cell-left', onHeaderCell: hcell, render: txt },
    { title: '设备台数', dataIndex: 'equipmentCount', width: 90, align: 'right', onHeaderCell: hcell, render: n },
    { title: '机台数', dataIndex: 'machinesForUs', width: 90, align: 'right', onHeaderCell: hcell, render: n },
    { title: '员工人数', dataIndex: 'employeeCount', width: 90, align: 'right', onHeaderCell: hcell, render: n },
    { title: '月产能', dataIndex: 'monthlyCapacity', width: 90, onHeaderCell: hcell, render: txt },
    { title: '加工类型', dataIndex: 'mainProcess', width: 90, onHeaderCell: hcell, render: txt },
    { title: '资质', dataIndex: 'qualification', width: 110, onHeaderCell: hcell, render: txt },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      align: 'center',
      onHeaderCell: hcell,
      render: (v: boolean) => (v ? <Tag color="success">已生效</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'op',
      width: 100,
      fixed: 'right',
      onHeaderCell: hcell,
      // 无写权角色(业务/品质/管理层)只读，不显示编辑/删除
      render: (_, s) =>
        canEdit ? (
          <Space size={10}>
            <a style={{ color: palette.blue }} onClick={() => openEdit(s)}>
              编辑
            </a>
            <Popconfirm title={`删除加工厂「${s.supplierName}」？`} onConfirm={() => del(s.supplierId)} okText="删除" cancelText="取消">
              <a style={{ color: palette.bad }}>删除</a>
            </Popconfirm>
          </Space>
        ) : (
          dash
        ),
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>加工厂</div>

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
          <Input
            prefix={<SearchOutlined style={{ color: palette.inkSoft }} />}
            placeholder="搜加工厂 / 联系人 / 电话"
            allowClear
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            style={{ width: 320 }}
          />
          {canEdit && (
            <Space style={{ marginLeft: 'auto' }}>
              <ImportSuppliersDrawer deptId={user?.deptId ?? 1} onDone={load} />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建加工厂</Button>
            </Space>
          )}
        </div>

        <Table<SupplierDto>
          rowKey="supplierId"
          size="middle"
          columns={columns}
          dataSource={shown}
          loading={loading}
          scroll={{ x: 1410 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 家加工厂` }}
        />
      </div>

      <Drawer
        title={editing ? `编辑加工厂 ${editing.supplierName}` : '新建加工厂'}
        width={560}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={submit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="supplierName" label="加工厂名称" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="如 益沣" />
            </Form.Item>
            <Form.Item name="contact" label="联系人" style={{ width: 140 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="phone" label="联系电话" style={{ width: 200 }}>
              <Input placeholder="13725669920" />
            </Form.Item>
            <Form.Item name="mainProcess" label="加工类型" style={{ flex: 1 }}>
              <Input placeholder="车缝" />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="工厂地址">
            <Input.TextArea rows={2} placeholder="广东省…" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="equipmentCount" label="设备台数" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="machinesForUs" label="帮我们的机台" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="employeeCount" label="员工人数" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="monthlyCapacity" label="月产能" style={{ flex: 1 }}>
              <Input placeholder="如 100万" />
            </Form.Item>
            <Form.Item name="qualification" label="环评/消防/安监资质" style={{ flex: 1 }}>
              <Input placeholder="有效期内" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="scope" label="所属范围" style={{ flex: 1 }}>
              <Input placeholder="车缝部" />
            </Form.Item>
            <Form.Item name="deptId" label="部门" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={depts} placeholder="选择部门" />
            </Form.Item>
            <Form.Item name="isActive" label="启用" valuePropName="checked" style={{ width: 80 }}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Drawer>
    </div>
  );
}
