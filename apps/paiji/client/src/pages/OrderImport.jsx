import { useState, useEffect, useRef } from 'react';
import { Upload, Button, Table, message, Card, Space, Tag, Popconfirm } from 'antd';
import { UploadOutlined, DeleteOutlined, ClearOutlined, DownloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { apiUrl } from '../api';

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

  const uploadQueue = useRef([]);
  const uploadTimer = useRef(null);

  const handleUpload = (file) => {
    uploadQueue.current.push(file);
    // 用定时器合并同一批选择的文件
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    uploadTimer.current = setTimeout(() => processUploadQueue(), 100);
    return false;
  };

  const processUploadQueue = async () => {
    const files = [...uploadQueue.current];
    uploadQueue.current = [];
    let totalCount = 0;
    let failCount = 0;
    let failNames = [];
    for (const f of files) {
      const formData = new FormData();
      formData.append('file', f);
      formData.append('workshop', workshop);
      try {
        const { data } = await axios.post(`${API}/import`, formData);
        const cnt = data.count || 0;
        totalCount += cnt;
        if (cnt === 0) failNames.push(f.name);
      } catch (e) {
        failCount++;
        failNames.push(f.name);
      }
    }
    if (totalCount > 0) {
      let msg = `成功导入 ${totalCount} 条订单`;
      if (failNames.length > 0) msg += `（${failNames.length}个文件未解析：${failNames.join('、')}）`;
      message.success(msg);
    } else {
      message.warning('未解析出订单数据');
    }
    fetchOrders();
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

  const handleToggleStatus = async (record) => {
    const newStatus = record.status === 'scheduled' ? 'pending' : 'scheduled';
    try {
      await axios.put(`${API}/${record.id}`, { status: newStatus });
      message.success(newStatus === 'pending' ? '已改为待排' : '已改为已排');
      fetchOrders();
    } catch (e) {
      message.error('修改失败：' + (e.response?.data?.message || e.message));
    }
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
      render: (s, record) => (
        <Tag
          color={s === 'pending' ? 'blue' : s === 'scheduled' ? 'green' : 'default'}
          style={{ cursor: 'pointer' }}
          onClick={() => handleToggleStatus(record)}
          title="点击切换状态"
        >
          {s === 'pending' ? '待排' : s === 'scheduled' ? '已排' : s}
        </Tag>
      )
    },
    { title: '操作', width: 80,
      render: (_, r) => <Popconfirm title="确定删除?" onConfirm={() => handleDelete(r.id)}><Button type="link" danger size="small">删除</Button></Popconfirm>
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".pdf,.xlsx,.xls" multiple>
            <Button icon={<UploadOutlined />} type="primary">导入订单 (PDF/Excel)</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={() => window.open(apiUrl('/api/orders/template'))}>下载导入模板</Button>
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
