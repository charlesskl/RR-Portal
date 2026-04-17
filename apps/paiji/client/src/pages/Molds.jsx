import { useState, useEffect } from 'react';
import {
  Table, Button, Space, Upload, message, Popconfirm,
  Modal, Form, Input, InputNumber, Tag,
} from 'antd';
import {
  UploadOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, InboxOutlined, DownloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';

export default function Molds() {
  const [molds, setMolds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/molds');
      setMolds(res.data);
    } catch {
      message.error('加载排模数据失败');
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
        await axios.put(`/api/molds/${editRecord.id}`, values);
        message.success('已更新');
      } else {
        await axios.post('/api/molds', values);
        message.success('已新增');
      }
      setModalOpen(false);
      load();
    } catch {
      message.error('保存失败');
    }
  };

  const handleDelete = async (id) => {
    await axios.delete(`/api/molds/${id}`);
    message.success('已删除');
    load();
  };

  const handleImport = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/molds/import', formData);
      message.success(res.data.message);
      load();
    } catch (err) {
      message.error(err.response?.data?.message || '导入失败');
    }
    return false;
  };

  // 计算24H目标用于预览
  const calc24H = (周期, 模穴) => {
    if (!周期 || !模穴) return '-';
    return Math.floor(24 * 3600 / 周期 * 模穴).toLocaleString();
  };

  const columns = [
    { title: '模具编号', dataIndex: '模具编号', width: 150 },
    {
      title: '模穴', dataIndex: '模穴', width: 80,
      render: v => <Tag color="green">{v}</Tag>,
    },
    {
      title: '周期（秒）', dataIndex: '周期', width: 100,
      render: v => <Tag color="orange">{v}s</Tag>,
    },
    {
      title: '机台型号', dataIndex: '机台型号', width: 100,
      render: v => <Tag color="purple">{v}</Tag>,
    },
    { title: '单件重量(g)', dataIndex: '单件重量', width: 110 },
    {
      title: '24H目标（参考）', width: 130,
      render: (_, r) => <span style={{ color: '#1677ff' }}>{calc24H(r.周期, r.模穴)}</span>,
    },
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增排模</Button>
        <Upload beforeUpload={handleImport} showUploadList={false} accept=".xlsx,.xls">
          <Button icon={<UploadOutlined />}>导入 Excel</Button>
        </Upload>
        <Button icon={<DownloadOutlined />} onClick={() => window.open('/api/molds/template')}>下载模板</Button>
        <Tag color="geekblue">共 {molds.length} 条排模数据</Tag>
      </Space>

      <Table
        dataSource={molds}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      {molds.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
          <InboxOutlined style={{ fontSize: 48, marginBottom: 12 }} />
          <div>暂无排模数据</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            Excel 表头支持：模具编号、模穴、周期、机台型号、单件重量
          </div>
        </div>
      )}

      <Modal
        title={editRecord ? '编辑排模' : '新增排模'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="模具编号" label="模具编号" rules={[{ required: true, message: '请填写模具编号' }]}>
            <Input placeholder="如：RABTB-01M-01" />
          </Form.Item>
          <Form.Item name="模穴" label="模穴（穴数）" rules={[{ required: true, message: '请填写模穴' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="如：2" />
          </Form.Item>
          <Form.Item name="周期" label="周期（秒）" rules={[{ required: true, message: '请填写周期' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="如：30" />
          </Form.Item>
          <Form.Item name="机台型号" label="机台型号" rules={[{ required: true, message: '请填写机台型号' }]}>
            <Input placeholder="如：24A" />
          </Form.Item>
          <Form.Item name="单件重量" label="单件重量（g）">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="如：50" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
