import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, Tag, Space, message, Popconfirm, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Title } = Typography;

const statusOptions = [
  { value: 'pending',  label: '待审核' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'revision', label: '需修改' },
];
const statusColors = { pending: 'default', approved: 'green', rejected: 'red', revision: 'orange' };

const currencyOptions = [
  { value: 'USD', label: 'USD' },
  { value: 'CNY', label: 'CNY' },
  { value: 'EUR', label: 'EUR' },
];

const API = '/api/pricings';

export default function Pricing() {
  const [items, setItems]       = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [filterStatus, setFilterStatus] = useState(undefined);
  const [form] = Form.useForm();

  const loadData = (status) => {
    setLoading(true);
    const qs = status ? `?status=${status}` : '';
    axios.get(`${API}${qs}`)
      .then(res => setItems(res.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    axios.get('/api/products').then(res => setProducts(res.data)).catch(() => {});
    loadData();
  }, []);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await axios.put(`${API}/${editing._id}`, values);
        message.success('核价记录已更新');
      } else {
        await axios.post(API, values);
        message.success('核价记录已创建');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      loadData(filterStatus);
    } catch (err) {
      if (err.message) message.error(err.message);
    }
  };

  const handleEdit = (record) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      message.success('记录已删除');
      loadData(filterStatus);
    } catch (err) {
      message.error(err.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '走货明细',
      key: 'product',
      render: (_, r) => r.product ? (
        <span style={{ color: '#1677ff' }}>{r.product.name}</span>
      ) : (r.productName || '-'),
    },
    { title: '产品编号', dataIndex: 'productNo', key: 'productNo' },
    { title: '产品名称', dataIndex: 'productName', key: 'productName' },
    { title: '类别', dataIndex: 'category', key: 'category' },
    {
      title: '预估成本',
      key: 'estimatedCost',
      render: (_, r) => r.estimatedCost != null
        ? `${r.currency || 'USD'} ${Number(r.estimatedCost).toFixed(2)}` : '-',
    },
    {
      title: '实际成本',
      key: 'actualCost',
      render: (_, r) => r.actualCost != null
        ? `${r.currency || 'USD'} ${Number(r.actualCost).toFixed(2)}` : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s) => <Tag color={statusColors[s]}>{statusOptions.find(o => o.value === s)?.label}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (d) => d ? dayjs(d).format('YYYY-MM-DD') : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除此记录？" onConfirm={() => handleDelete(record._id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>核价管理</Title>
        <Space>
          <Select
            placeholder="按状态筛选"
            allowClear
            style={{ width: 160 }}
            options={statusOptions}
            onChange={(v) => { setFilterStatus(v); loadData(v); }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}
          >
            新增核价
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={items}
        rowKey="_id"
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal
        title={editing ? '编辑核价' : '新增核价'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="productId" label="关联走货明细">
            <Select placeholder="选择走货明细（可选）" allowClear>
              {products.map(p => (
                <Select.Option key={p._id} value={p._id}>
                  {p.name}{p.prodNo ? ` (${p.prodNo})` : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="productNo" label="产品编号" style={{ width: 200 }}>
              <Input placeholder="如：#47716A" />
            </Form.Item>
            <Form.Item name="productName" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]} style={{ width: 280 }}>
              <Input placeholder="产品名称" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }}>
            <Form.Item name="category" label="类别" style={{ width: 180 }}>
              <Input placeholder="如：玩具车" />
            </Form.Item>
            <Form.Item name="currency" label="币种" initialValue="USD" style={{ width: 120 }}>
              <Select options={currencyOptions} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }}>
            <Form.Item name="estimatedCost" label="预估成本" style={{ width: 200 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" />
            </Form.Item>
            <Form.Item name="actualCost" label="实际成本" style={{ width: 200 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="状态" initialValue="pending">
            <Select options={statusOptions} style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
