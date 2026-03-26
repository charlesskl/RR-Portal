import { useState, useEffect } from 'react';
import { Upload, Button, Table, message, Card, Space, Statistic, Row, Col } from 'antd';
import { UploadOutlined, BarChartOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/history';

export default function HistoryData({ workshop = 'B' }) {
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const fetchRecords = async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { page: p, pageSize: 50, workshop } });
      setRecords(data.data || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e) {
      message.error('获取历史数据失败');
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const { data } = await axios.get(`${API}/stats`, { params: { workshop } });
      setStats(data);
    } catch (e) {
      console.error('获取统计失败', e);
    }
  };

  useEffect(() => {
    fetchRecords();
    fetchStats();
  }, [workshop]);

  const handleUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workshop', workshop);
    try {
      const { data } = await axios.post(`${API}/import`, formData);
      message.success(data.message);
      fetchRecords();
      fetchStats();
    } catch (e) {
      message.error('导入失败：' + (e.response?.data?.message || e.message));
    }
    return false;
  };

  const columns = [
    { title: '机台', dataIndex: 'machine_no', width: 60 },
    { title: '产品货号', dataIndex: 'product_code', width: 120 },
    { title: '模号名称', dataIndex: 'mold_name', width: 150 },
    { title: '颜色', dataIndex: 'color', width: 80 },
    { title: '料型', dataIndex: 'material_type', width: 80 },
    { title: '啤重G', dataIndex: 'shot_weight', width: 80 },
    { title: '用料KG', dataIndex: 'material_kg', width: 80 },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80 },
    { title: '24H目标', dataIndex: 'target_24h', width: 80 },
    { title: '备注', dataIndex: 'notes', width: 120 },
  ];

  const machinesWithData = stats.filter(s => s.record_count > 0);

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".xlsx,.xls">
            <Button icon={<UploadOutlined />} type="primary">导入历史排单Excel</Button>
          </Upload>
          <span style={{ color: '#999' }}>已导入 {total} 条历史记录，覆盖 {machinesWithData.length} 台机</span>
        </Space>
      </Card>

      {machinesWithData.length > 0 && (
        <Card title="各机台啤重G区间统计" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={[8, 8]}>
            {machinesWithData.map(s => (
              <Col key={s.machine_no} span={4}>
                <Card size="small" style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{s.machine_no}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {s.min_shot_weight}g ~ {s.max_shot_weight}g
                  </div>
                  <div style={{ fontSize: 11, color: '#999' }}>
                    均{s.avg_shot_weight}g / {s.record_count}条
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <Table
        columns={columns}
        dataSource={records}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          current: page,
          pageSize: 50,
          total,
          onChange: fetchRecords,
          showTotal: t => `共 ${t} 条`,
        }}
        scroll={{ x: 1000 }}
      />
    </div>
  );
}
