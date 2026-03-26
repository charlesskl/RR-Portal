import { useState, useEffect } from 'react';
import {
  Button, DatePicker, Table, Tag, Space, message,
  Card, Statistic, Row, Col, Alert, Divider, Checkbox,
} from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

export default function Schedule({ onDone }) {
  const [date, setDate] = useState(dayjs());
  const [orders, setOrders] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    axios.get('/api/orders').then(res => {
      setOrders(res.data);
      setSelectedOrders(res.data.map(o => o.id));
    });
  }, []);

  const handleGenerate = async () => {
    if (!date) return message.error('请选择排机日期');
    if (selectedOrders.length === 0) return message.error('请至少选择一条订单');
    setGenerating(true);
    try {
      const res = await axios.post('/api/schedule/generate', {
        date: date.format('YYYY-MM-DD'),
        orderIds: selectedOrders,
      });
      setResult(res.data);
      message.success(`排机完成！共 ${res.data.items.length} 行`);
    } catch (err) {
      message.error(err.response?.data?.message || '排机失败');
    } finally {
      setGenerating(false);
    }
  };

  // 统计各机台情况
  const stats = result ? (() => {
    const map = {};
    result.items.forEach(item => {
      if (!map[item.机台]) map[item.机台] = { count: 0, totalHours: 0 };
      map[item.机台].count++;
      map[item.机台].totalHours += item.生产小时 || 0;
    });
    return map;
  })() : {};

  const previewColumns = [
    { title: '机台', dataIndex: '机台', width: 90, render: v => <Tag color="purple">{v}</Tag> },
    { title: '产品货号', dataIndex: '产品货号', width: 100 },
    { title: '模号名称', dataIndex: '模号名称', width: 150, ellipsis: true },
    { title: '颜色', dataIndex: '颜色', width: 70 },
    { title: '料型', dataIndex: '料型', width: 90 },
    { title: '啤数', dataIndex: '啤数', width: 90, render: v => Number(v).toLocaleString() },
    { title: '周期(s)', dataIndex: '周期', width: 80 },
    { title: '24H目标', dataIndex: '24H目标', width: 90, render: v => <span style={{ color: '#1677ff' }}>{Number(v).toLocaleString()}</span> },
    { title: '11H目标', dataIndex: '11H目标', width: 90, render: v => <span style={{ color: '#52c41a' }}>{Number(v).toLocaleString()}</span> },
    { title: '天数', dataIndex: '天数', width: 70, render: v => <Tag color={v > 3 ? 'red' : v > 1 ? 'orange' : 'green'}>{v}天</Tag> },
    { title: '备注', dataIndex: '备注', width: 150 },
  ];

  const orderColumns = [
    { title: '款号', dataIndex: '款号', width: 100 },
    { title: '模具编号', dataIndex: '模具编号', width: 140 },
    { title: '工模名称', dataIndex: '工模名称', width: 150, ellipsis: true },
    { title: '啤数', dataIndex: '啤数', width: 90, render: v => Number(v).toLocaleString() },
    { title: '颜色', dataIndex: '颜色', width: 70 },
  ];

  return (
    <div>
      {/* 控制区 */}
      <Card style={{ marginBottom: 16 }}>
        <Space size="large" align="center" wrap>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>排机日期</div>
            <DatePicker
              value={date}
              onChange={setDate}
              format="YYYY-MM-DD"
              style={{ width: 160 }}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>
              已选订单 <Tag color="blue">{selectedOrders.length} / {orders.length}</Tag>
            </div>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={generating}
            onClick={handleGenerate}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            生成排机表
          </Button>
        </Space>
      </Card>

      {/* 订单选择 */}
      {orders.length > 0 && (
        <Card
          title={
            <Space>
              <span>选择参与排机的订单</span>
              <Button size="small" onClick={() => setSelectedOrders(orders.map(o => o.id))}>全选</Button>
              <Button size="small" onClick={() => setSelectedOrders([])}>清空</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
          size="small"
        >
          <Table
            dataSource={orders}
            columns={orderColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            rowSelection={{
              selectedRowKeys: selectedOrders,
              onChange: setSelectedOrders,
            }}
          />
        </Card>
      )}

      {orders.length === 0 && (
        <Alert
          message="请先在【订单管理】页面导入或添加订单数据"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 排机结果 */}
      {result && (
        <>
          <Divider>排机结果预览 — {result.date}</Divider>

          {/* 机台统计 */}
          <Row gutter={12} style={{ marginBottom: 16 }}>
            {Object.entries(stats).map(([machine, s]) => (
              <Col key={machine}>
                <Card size="small" style={{ minWidth: 140 }}>
                  <Statistic
                    title={<Tag color="purple">{machine}</Tag>}
                    value={s.count}
                    suffix={`单 / ${s.totalHours.toFixed(1)}h`}
                  />
                </Card>
              </Col>
            ))}
          </Row>

          <Table
            dataSource={result.items}
            columns={previewColumns}
            rowKey={(_, i) => i}
            size="small"
            scroll={{ x: 1000 }}
            pagination={false}
            rowClassName={(r) => r.备注?.includes('⚠️') ? 'ant-table-row-selected' : ''}
          />

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/schedule/${result.id}/export`;
                window.open(url);
              }}>导出 Excel</Button>
              <Button type="primary" onClick={onDone}>查看所有排机表</Button>
            </Space>
          </div>
        </>
      )}
    </div>
  );
}
