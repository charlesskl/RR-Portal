import { useState, useEffect } from 'react';
import {
  Table, Button, Space, Upload, message, Popconfirm,
  Modal, Form, Input, InputNumber, Tag,
} from 'antd';
import {
  UploadOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, ClearOutlined, InboxOutlined,
} from '@ant-design/icons';
import axios from 'axios';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/orders');
      setOrders(res.data);
    } catch {
      message.error('加载订单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditRecord(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditRecord(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editRecord) {
        await axios.put(`/api/orders/${editRecord.id}`, values);
        message.success('已更新');
      } else {
        await axios.post('/api/orders', values);
        message.success('已新增');
      }
      setModalOpen(false);
      load();
    } catch {
      message.error('保存失败');
    }
  };

  const handleDelete = async (id) => {
    await axios.delete(`/api/orders/${id}`);
    message.success('已删除');
    load();
  };

  const handleClearAll = async () => {
    await axios.delete('/api/orders');
    message.success('已清空所有订单');
    load();
  };

  const handleImport = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/orders/import', formData);
      message.success(res.data.message);
      load();
    } catch (err) {
      message.error(err.response?.data?.message || '导入失败');
    }
    return false;
  };

  const columns = [
    { title: '款号', dataIndex: '款号', width: 100 },
    { title: '模具编号', dataIndex: '模具编号', width: 130 },
    { title: '工模名称', dataIndex: '工模名称', width: 160, ellipsis: true },
    {
      title: '啤数', dataIndex: '啤数', width: 90,
      render: v => <Tag color="blue">{Number(v).toLocaleString()}</Tag>,
    },
    { title: '颜色', dataIndex: '颜色', width: 80 },
    { title: '材料', dataIndex: '材料', width: 80 },
    {
      title: '操作', width: 100, fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增订单</Button>
        <Upload beforeUpload={handleImport} showUploadList={false} accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.bmp">
          <Button icon={<UploadOutlined />}>导入 Excel / PDF / 图片</Button>
        </Upload>
        <Popconfirm title="确认清空所有订单？" onConfirm={handleClearAll}>
          <Button danger icon={<ClearOutlined />}>清空订单</Button>
        </Popconfirm>
        <Tag color="geekblue">共 {orders.length} 条订单</Tag>
      </Space>

      <Table
        dataSource={orders}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      {/* Excel导入说明 */}
      {orders.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
          <InboxOutlined style={{ fontSize: 48, marginBottom: 12 }} />
          <div>暂无订单数据</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            Excel 表头支持：款号、模具编号、工模名称、啤数、颜色、材料<br/>
            PDF 支持含上述字段的表格格式
          </div>
        </div>
      )}

      <Modal
        title={editRecord ? '编辑订单' : '新增订单'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="款号" label="款号" rules={[{ required: true, message: '请填写款号' }]}>
            <Input placeholder="如：77858" />
          </Form.Item>
          <Form.Item name="模具编号" label="模具编号" rules={[{ required: true, message: '请填写模具编号' }]}>
            <Input placeholder="如：MCKP-01M-01" />
          </Form.Item>
          <Form.Item name="工模名称" label="工模名称">
            <Input placeholder="模具名称" />
          </Form.Item>
          <Form.Item name="啤数" label="啤数（生产数量）" rules={[{ required: true, message: '请填写啤数' }]}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="如：10500" />
          </Form.Item>
          <Form.Item name="颜色" label="颜色">
            <Input placeholder="如：红色" />
          </Form.Item>
          <Form.Item name="材料" label="材料">
            <Input placeholder="如：ABS" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
