import { useState, useEffect } from 'react';
import { Upload, Button, Table, message, Card, Space, Popconfirm, Select, Tag } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/monthly-plans';

export default function MonthlyPlan({ workshop = 'B' }) {
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      setPlans(data);
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
    } catch (e) {
      message.error('获取月计划失败');
    }
    setLoading(false);
  };

  const fetchDetail = async (id) => {
    if (!id) return setItems([]);
    try {
      const { data } = await axios.get(`${API}/${id}`);
      setItems(data.items || []);
    } catch (e) {
      message.error('获取详情失败');
    }
  };

  useEffect(() => { fetchPlans(); }, [workshop]);
  useEffect(() => { fetchDetail(selectedId); }, [selectedId]);

  const handleUpload = async (file) => {
    const ym = new Date().toISOString().slice(0, 7);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('workshop', workshop);
    fd.append('year_month', ym);
    try {
      const { data } = await axios.post(`${API}/import`, fd, { timeout: 60000 });
      message.success(`${data.message}`);
      await fetchPlans();
      setSelectedId(data.plan_id);
    } catch (e) {
      message.error('导入失败：' + (e.response?.data?.message || e.message));
    }
    return false;
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      message.success('已删除');
      if (selectedId === id) setSelectedId(null);
      fetchPlans();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const itemColumns = [
    { title: '机台', dataIndex: 'machine_no', width: 70, fixed: 'left',
      render: v => v && <Tag color="blue">{v}</Tag> },
    { title: '机型', dataIndex: 'machine_type', width: 70 },
    { title: '产品货号', dataIndex: 'product_code', width: 100 },
    { title: '模号 / 品名', dataIndex: 'mold_name', width: 200 },
    { title: '订单号', dataIndex: 'order_no', width: 120,
      onCell: () => ({ style: { wordBreak: 'break-all', whiteSpace: 'normal' } }) },
    { title: '料型', dataIndex: 'material_type', width: 130 },
    { title: '颜色', dataIndex: 'color', width: 150,
      onCell: () => ({ style: { wordBreak: 'break-all', whiteSpace: 'normal' } }) },
    { title: '数量', dataIndex: 'quantity', width: 80, align: 'right' },
    { title: '日产量', dataIndex: 'daily_qty', width: 80, align: 'right' },
    { title: '天数', dataIndex: 'days_needed', width: 70, align: 'right',
      render: v => v != null ? v.toFixed(1) : '' },
    { title: '完成期', dataIndex: 'est_finish', width: 90 },
    { title: '交货期', dataIndex: 'order_delivery', width: 90 },
    { title: '备注', dataIndex: 'notes', width: 120 },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".xlsx,.xls">
            <Button icon={<UploadOutlined />} type="primary">导入月计划 Excel</Button>
          </Upload>
          <Select
            style={{ width: 320 }}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="选择已有月计划"
            options={plans.map(p => ({
              value: p.id,
              label: `${p.year_month} · ${p.title || '(无标题)'} · ${p.item_count} 条`,
            }))}
          />
          {selectedId && (
            <Popconfirm title="确定删除该月计划？" onConfirm={() => handleDelete(selectedId)}>
              <Button icon={<DeleteOutlined />} danger>删除当前</Button>
            </Popconfirm>
          )}
          <span style={{ color: '#999' }}>共 {items.length} 条</span>
        </Space>
      </Card>
      <Table
        columns={itemColumns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 50 }}
        scroll={{ x: 1400 }}
      />
    </div>
  );
}
