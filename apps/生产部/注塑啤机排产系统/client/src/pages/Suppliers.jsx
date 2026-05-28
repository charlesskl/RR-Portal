import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, message,
  Popconfirm, Card, Row, Col, Statistic, Tag, Progress,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';

export default function Suppliers() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/suppliers/_/summary');
      setSummary(res.data);
    } catch (e) {
      message.error('加载加工厂失败：' + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals = {
    suppliers: summary.length,
    machines: summary.reduce((s, x) => s + (x.total_machines || 0), 0),
    orders: summary.reduce((s, x) => s + (x.order_count || 0), 0),
    pcs: summary.reduce((s, x) => s + (x.total_pcs || 0), 0),
  };

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
        await axios.put(`/api/suppliers/${editRecord.id}`, values);
        message.success('已更新');
      } else {
        await axios.post('/api/suppliers', values);
        message.success('已新增');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      message.error('保存失败：' + msg);
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/suppliers/${id}`);
      message.success('已停用');
      load();
    } catch (e) {
      message.error('停用失败：' + (e.response?.data?.message || e.message));
    }
  };

  const columns = [
    { title: '加工厂', dataIndex: 'name', width: 160, fixed: 'left',
      render: (v) => <Tag color="purple" style={{ fontSize: 13, padding: '2px 8px' }}>{v}</Tag> },
    { title: '总机台', dataIndex: 'total_machines', width: 90, align: 'right' },
    { title: '可调配', dataIndex: 'machines_for', width: 90, align: 'right' },
    { title: '运行率', dataIndex: 'running_rate', width: 130, align: 'center',
      render: (v) => {
        const pct = Math.round((v || 0) * 100);
        return <Progress percent={pct} size="small" style={{ minWidth: 100 }} />;
      },
    },
    { title: '当前订单数', dataIndex: 'order_count', width: 110, align: 'right',
      render: (v) => <Tag color={v > 0 ? 'blue' : 'default'}>{v || 0}</Tag> },
    { title: '总啤数', dataIndex: 'total_pcs', width: 130, align: 'right',
      render: (v) => (v || 0).toLocaleString() },
    {
      title: '操作', width: 130, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>改</Button>
          <Popconfirm title="确认停用？（不会真正删除，只是隐藏）" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>停用</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="加工厂数" value={totals.suppliers} /></Card></Col>
        <Col span={6}><Card><Statistic title="总机台" value={totals.machines} suffix="台" /></Card></Col>
        <Col span={6}><Card><Statistic title="进行中订单" value={totals.orders} suffix="条" /></Card></Col>
        <Col span={6}><Card><Statistic title="累计需啤数" value={totals.pcs} /></Card></Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增加工厂</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={summary}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <Modal
        title={editRecord ? `编辑加工厂：${editRecord.name}` : '新增加工厂'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="加工厂名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="total_machines" label="总机台数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="machines_for" label="可调配机台">
                <Input placeholder="如 11 / 6 等" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="running_rate" label="运行率（0-1）">
            <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
