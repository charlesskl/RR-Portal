import { useState, useEffect, useMemo } from 'react';
import { Card, Space, Button, Table, Tag, message, Drawer, Form, Input, InputNumber, DatePicker, Select, Popconfirm, AutoComplete } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const API = '/api/warehouse-orders';
const STATUS_META = {
  'pending':    { color: 'orange',  label: '待入库' },
  'checked-in': { color: 'blue',    label: '已入库' },
  'settled':    { color: 'green',   label: '已结算' },
};

export default function WarehouseOrders({ workshop = 'B' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ month: dayjs().format('YYYY-MM'), pmc: null, status: null });
  const [pmcOptions, setPmcOptions] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop, ...filter } });
      setRows(data);
    } catch (e) {
      message.error('查询失败');
    }
    setLoading(false);
  };
  const fetchPmcOptions = async () => {
    const { data } = await axios.get(`${API}/_/pmc-options`, { params: { workshop } });
    setPmcOptions(data);
  };

  useEffect(() => { fetchList(); }, [workshop, filter]);
  useEffect(() => { fetchPmcOptions(); }, [workshop]);

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      delivery_date: dayjs(),
      workshop,
      status: 'pending',
    });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    form.resetFields();
    form.setFieldsValue({
      ...row,
      delivery_date: row.delivery_date ? dayjs(row.delivery_date) : null,
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    try {
      const v = await form.validateFields();
      const payload = {
        ...v,
        workshop,
        delivery_date: v.delivery_date ? v.delivery_date.format('YYYY-MM-DD') : null,
      };
      if (editingId) {
        await axios.put(`${API}/${editingId}`, payload);
        message.success('已保存');
      } else {
        await axios.post(API, payload);
        message.success('已新建');
      }
      setDrawerOpen(false);
      fetchList(); fetchPmcOptions();
    } catch (e) {
      if (e?.errorFields) return; // form validation
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      message.success('已删除');
      fetchList();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleCheckIn = async (row) => {
    const undo = row.status === 'checked-in';
    try {
      await axios.post(`${API}/${row.id}/check-in`, { undo });
      message.success(undo ? '已取消入库' : '已入库');
      fetchList();
    } catch (e) {
      message.error('操作失败');
    }
  };

  // 实时算金额展示
  const watchedShots = Form.useWatch('delivery_shots', form);
  const watchedPrice = Form.useWatch('unit_price', form);
  const previewAmount = useMemo(() => {
    if (watchedShots != null && watchedPrice != null) {
      return Math.round(Number(watchedShots) * Number(watchedPrice) * 100) / 100;
    }
    return null;
  }, [watchedShots, watchedPrice]);

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalKg = rows.reduce((s, r) => s + (Number(r.material_kg) || 0), 0);
    const checked = rows.filter(r => r.status === 'checked-in').length;
    const pending = rows.filter(r => r.status === 'pending').length;
    return { totalAmount, totalKg, checked, pending };
  }, [rows]);

  const columns = [
    { title: '送货日', dataIndex: 'delivery_date', width: 100 },
    { title: '送货单号', dataIndex: 'delivery_code', width: 110 },
    { title: '班', dataIndex: 'shift', width: 50,
      render: v => v ? <Tag color={v === '夜班' ? 'volcano' : 'cyan'} style={{ margin: 0 }}>{v[0]}</Tag> : '' },
    { title: '下单号', dataIndex: 'order_no', width: 130 },
    { title: '货号', dataIndex: 'mold_no', width: 90 },
    { title: '部件名称', dataIndex: 'part_name', width: 180 },
    { title: '颜色/色粉', width: 130,
      render: (_, r) => <span>{r.color}{r.color_powder_no ? <span style={{ color: '#999' }}> · {r.color_powder_no}</span> : ''}</span> },
    { title: '件数(PCS)', dataIndex: 'delivery_pcs', width: 85, align: 'right' },
    { title: '出模数', dataIndex: 'cavity', width: 60, align: 'center' },
    { title: '送货啤数', dataIndex: 'delivery_shots', width: 80, align: 'right' },
    { title: '料(kg)', dataIndex: 'material_kg', width: 75, align: 'right', render: v => v != null ? Number(v).toFixed(1) : '' },
    { title: '料型', dataIndex: 'material_type', width: 110 },
    { title: '单价', dataIndex: 'unit_price', width: 70, align: 'right', render: v => v != null ? Number(v).toFixed(4) : '' },
    { title: '金额', dataIndex: 'amount', width: 90, align: 'right',
      render: v => v != null ? <b>{Number(v).toFixed(2)}</b> : '' },
    { title: 'PMC', dataIndex: 'pmc_follow', width: 80,
      render: v => v ? <Tag>{v}</Tag> : '' },
    { title: '状态', dataIndex: 'status', width: 75,
      render: s => { const m = STATUS_META[s] || { color: 'default', label: s }; return <Tag color={m.color}>{m.label}</Tag>; } },
    { title: '操作', width: 180, fixed: 'right',
      render: (_, r) => (
        <Space size={2}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>改</Button>
          {r.status === 'checked-in'
            ? <Button size="small" icon={<RollbackOutlined />} onClick={() => handleCheckIn(r)}>取消</Button>
            : <Button size="small" type="primary" ghost icon={<CheckCircleOutlined />} onClick={() => handleCheckIn(r)}>入库</Button>}
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建入库单</Button>
          <span>月份：</span>
          <DatePicker.MonthPicker
            value={filter.month ? dayjs(filter.month) : null}
            onChange={d => setFilter(f => ({ ...f, month: d ? d.format('YYYY-MM') : null }))}
            allowClear
            placeholder="全部"
          />
          <span>PMC：</span>
          <Select
            style={{ width: 140 }}
            value={filter.pmc}
            onChange={v => setFilter(f => ({ ...f, pmc: v }))}
            options={pmcOptions.map(p => ({ value: p, label: p }))}
            placeholder="全部"
            allowClear
          />
          <span>状态：</span>
          <Select
            style={{ width: 110 }}
            value={filter.status}
            onChange={v => setFilter(f => ({ ...f, status: v }))}
            options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))}
            placeholder="全部"
            allowClear
          />
          <span style={{ color: '#999', marginLeft: 12 }}>
            共 {rows.length} 单 · 待入库 {summary.pending} · 已入库 {summary.checked}
            <span style={{ marginLeft: 12, color: '#1677ff' }}>
              总料 {summary.totalKg.toFixed(1)} kg · 总金额 ¥{summary.totalAmount.toFixed(2)}
            </span>
          </span>
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 50 }}
        scroll={{ x: 1700 }}
      />

      <Drawer
        title={editingId ? `修改入库单 #${editingId}` : '新建入库单'}
        width={560}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" onClick={handleSave}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical" size="small">
          {/* === 实物入库单字段（兴信塑胶 NO:A...） === */}
          <div style={{ fontWeight: 600, color: '#1677ff', margin: '4px 0 8px' }}>① 实物入库单</div>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="delivery_date" label="送货日期" rules={[{ required: true }]} style={{ width: '40%' }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="delivery_code" label="送货单号 NO" style={{ width: '35%' }}>
              <Input placeholder="A2511514" />
            </Form.Item>
            <Form.Item name="shift" label="班次" style={{ width: '25%' }}>
              <Select options={[{value:'白班'},{value:'夜班'}]} allowClear placeholder="-" />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="order_no" label="啤机生产单号（下单号）">
            <Input placeholder="CMC260234 / ZWZ20260021" />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="mold_no" label="货号" style={{ width: '40%' }}>
              <Input placeholder="77858" />
            </Form.Item>
            <Form.Item name="part_name" label="部件名称" style={{ width: '60%' }}>
              <Input placeholder="MCKP-17M-01 喷水" />
            </Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="color" label="颜色" style={{ width: '50%' }}>
              <Input placeholder="877C(金属银)" />
            </Form.Item>
            <Form.Item name="color_powder_no" label="色粉编号" style={{ width: '25%' }}>
              <Input placeholder="8773" />
            </Form.Item>
            <Form.Item name="color_powder_batch" label="色粉生产批号" style={{ width: '25%' }}>
              <Input />
            </Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="order_qty" label="下单啤数" style={{ width: '33%' }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="delivery_shots" label="数量（啤数）" style={{ width: '34%' }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="delivery_pcs" label="件数（PCS）" style={{ width: '33%' }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="cavity" label="出模数" style={{ width: '33%' }}>
              <Input placeholder="1/2" />
            </Form.Item>
            <Form.Item name="shot_weight" label="料重 g（啤重）" style={{ width: '34%' }}>
              <InputNumber step={0.1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="material_kg" label="料 kg" style={{ width: '33%' }}>
              <InputNumber step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="material_type" label="料号 / 料型">
            <Input placeholder="ABS KF-740" />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="material_pickup_no" label="胶料提货单号" style={{ width: '50%' }}>
              <Input placeholder="CMC..." />
            </Form.Item>
            <Form.Item name="color_powder_pickup_no" label="色粉提货单号" style={{ width: '50%' }}>
              <Input placeholder="CM10617-28477" />
            </Form.Item>
          </Space.Compact>

          {/* === 签字栏（一/二/三/四） === */}
          <div style={{ fontWeight: 600, color: '#52c41a', margin: '12px 0 8px' }}>② 签字</div>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="applicant" label="(一) 入仓申请人" style={{ width: '25%' }}>
              <Input />
            </Form.Item>
            <Form.Item name="dept_supervisor" label="(一) 部门主管" style={{ width: '25%' }}>
              <Input />
            </Form.Item>
            <Form.Item name="warehouse_keeper" label="(三) 仓管" style={{ width: '25%' }}>
              <Input />
            </Form.Item>
            <Form.Item name="pmc_follow" label="(四) PMC" style={{ width: '25%' }}>
              <AutoComplete
                options={pmcOptions.map(p => ({ value: p }))}
                placeholder="陈梦楚"
                allowClear
              />
            </Form.Item>
          </Space.Compact>

          {/* === 月结字段（月底统计补） === */}
          <div style={{ fontWeight: 600, color: '#fa8c16', margin: '12px 0 8px' }}>③ 月结字段（月底补）</div>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="unit_price" label="单价 ¥/啤" style={{ width: '50%' }}>
              <InputNumber step={0.0001} precision={4} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={`金额 ¥${previewAmount != null ? `（预计 ${previewAmount}）` : ''}`} name="amount" style={{ width: '50%' }}>
              <InputNumber step={0.01} precision={2} placeholder="自动算" style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="box_glue" label="胶箱" style={{ width: '33%' }}><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="box_paper" label="纸箱" style={{ width: '34%' }}><InputNumber style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="pallet" label="卡板" style={{ width: '33%' }}><InputNumber style={{ width: '100%' }} /></Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="status" label="状态" style={{ width: '50%' }}>
              <Select options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))} />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
