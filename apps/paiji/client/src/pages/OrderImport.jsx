import { useState, useEffect } from 'react';
import { Upload, Button, Table, message, Card, Space, Tag, Popconfirm } from 'antd';
import { UploadOutlined, DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/orders';

export default function OrderImport({ workshop = 'B' }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      setOrders(data);
    } catch (e) {
      message.error('获取订单失败');
    }
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, [workshop]);

  const handleUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workshop', workshop);
    try {
      const { data } = await axios.post(`${API}/import`, formData);
      message.success(data.message);
      fetchOrders();
    } catch (e) {
      message.error('导入失败：' + (e.response?.data?.message || e.message));
    }
    return false;
  };

  const handleDelete = async (id) => {
    await axios.delete(`${API}/${id}`);
    message.success('已删除');
    fetchOrders();
  };

  const handleClearAll = async () => {
    await axios.delete(API, { params: { workshop } });
    message.success('已清空');
    setOrders([]);
  };

  const columns = [
    { title: '产品货号', dataIndex: 'product_code', width: 120 },
    { title: '模号名称', dataIndex: 'mold_name', width: 150 },
    { title: '颜色', dataIndex: 'color', width: 80 },
    { title: '料型', dataIndex: 'material_type', width: 80 },
    { title: '啤重G', dataIndex: 'shot_weight', width: 80 },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80 },
    { title: '下单单号', dataIndex: 'order_no', width: 120 },
    { title: '状态', dataIndex: 'status', width: 80,
      render: s => <Tag color={s === 'pending' ? 'blue' : s === 'scheduled' ? 'green' : 'default'}>{s === 'pending' ? '待排' : s === 'scheduled' ? '已排' : s}</Tag>
    },
    { title: '操作', width: 80,
      render: (_, r) => <Popconfirm title="确定删除?" onConfirm={() => handleDelete(r.id)}><Button type="link" danger size="small">删除</Button></Popconfirm>
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".pdf,.xlsx,.xls">
            <Button icon={<UploadOutlined />} type="primary">导入订单 (PDF/Excel)</Button>
          </Upload>
          <Popconfirm title="确定清空所有订单?" onConfirm={handleClearAll}>
            <Button icon={<ClearOutlined />} danger>清空全部</Button>
          </Popconfirm>
          <span style={{ color: '#999' }}>共 {orders.length} 条订单</span>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 50 }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
