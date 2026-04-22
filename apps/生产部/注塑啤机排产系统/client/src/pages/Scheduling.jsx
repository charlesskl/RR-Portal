import { useState, useEffect } from 'react';
import { Card, Button, DatePicker, Radio, Table, message, Steps, Tag, Space, Alert } from 'antd';
import { ThunderboltOutlined, InfoCircleOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const ORDERS_API = '/api/orders';
const SCHEDULE_API = '/api/scheduling';

export default function Scheduling({ onDone, workshop = 'B' }) {
  const [step, setStep] = useState(0);
  const [orders, setOrders] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [date, setDate] = useState(dayjs());
  const [shift, setShift] = useState('白班');
  const [loading, setLoading] = useState(false);
  const [carryOverInfo, setCarryOverInfo] = useState(null);

  useEffect(() => {
    axios.get(ORDERS_API, { params: { status: 'pending', workshop } })
      .then(({ data }) => setOrders(data))
      .catch(() => message.error('获取待排订单失败'));
  }, [workshop]);

  // 当日期或班次改变时，查询上一班次结转情况
  useEffect(() => {
    checkCarryOver(date, shift);
  }, [date, shift]);

  const checkCarryOver = async (d, s) => {
    try {
      const params = { date: d.format('YYYY-MM-DD'), shift: s, workshop };
      const { data } = await axios.get(`${SCHEDULE_API}/carry-over`, { params });
      setCarryOverInfo(data);
    } catch {
      setCarryOverInfo(null);
    }
  };

  const handleGenerate = async () => {
    if (selectedIds.length === 0 && (!carryOverInfo || carryOverInfo.carryOverCount === 0)) {
      return message.warning('请选择要排产的订单');
    }
    setLoading(true);
    try {
      const { data } = await axios.post(`${SCHEDULE_API}/generate`, {
        date: date.format('YYYY-MM-DD'),
        shift,
        orderIds: selectedIds,
        workshop,
      });
      message.success(
        `排机完成！新订单 ${data.itemCount || 0} 条` +
        (data.carryOverCount > 0 ? `，结转上班次 ${data.carryOverCount} 条` : '')
      );
      if (onDone) onDone();
    } catch (e) {
      message.error('排机失败：' + (e.response?.data?.message || e.message));
    }
    setLoading(false);
  };

  const orderColumns = [
    { title: '产品货号', dataIndex: 'product_code', width: 120 },
    { title: '模号名称', dataIndex: 'mold_name', width: 150 },
    { title: '颜色', dataIndex: 'color', width: 80 },
    { title: '料型', dataIndex: 'material_type', width: 80 },
    { title: '啤重G', dataIndex: 'shot_weight', width: 80 },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80 },
  ];

  const carryOverColumns = [
    { title: '机台', dataIndex: 'machine_no', width: 70 },
    { title: '模号名称', dataIndex: 'mold_name', width: 160 },
    { title: '颜色', dataIndex: 'color', width: 80 },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80 },
    { title: '累计数', dataIndex: 'accumulated', width: 80 },
    { title: '欠数', dataIndex: 'shortage', width: 80,
      render: (_, r) => Math.max(0, (r.quantity_needed || 0) - (r.accumulated || 0))
    },
  ];

  return (
    <div>
      <Steps current={step} style={{ marginBottom: 24 }} items={[
        { title: '选择订单' },
        { title: '设定参数' },
        { title: '执行排机' },
      ]} />

      {step === 0 && (
        <div>
          <Table
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: setSelectedIds,
            }}
            columns={orderColumns}
            dataSource={orders}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 50 }}
          />
          <Button type="primary" onClick={() => setStep(1)} style={{ marginTop: 16 }}>
            下一步：设定参数
          </Button>
        </div>
      )}

      {step === 1 && (
        <Card>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <span style={{ marginRight: 12 }}>排产日期：</span>
              <DatePicker value={date} onChange={d => setDate(d)} />
            </div>
            <div>
              <span style={{ marginRight: 12 }}>班次：</span>
              <Radio.Group value={shift} onChange={e => setShift(e.target.value)}>
                <Radio.Button value="白班">白班</Radio.Button>
                <Radio.Button value="夜班">夜班</Radio.Button>
              </Radio.Group>
            </div>

            {/* 结转预览 */}
            {carryOverInfo && carryOverInfo.carryOverCount > 0 && (
              <Alert
                type="warning"
                icon={<InfoCircleOutlined />}
                showIcon
                message={
                  <span>
                    检测到上班次（{carryOverInfo.prevDate} {carryOverInfo.prevShift}）有
                    <strong style={{ color: '#d46b08' }}> {carryOverInfo.carryOverCount} </strong>
                    条订单将自动结转到本班次，排机时会优先延续这些机台的生产
                  </span>
                }
                description={
                  <Table
                    columns={carryOverColumns}
                    dataSource={carryOverInfo.items}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    style={{ marginTop: 8 }}
                  />
                }
              />
            )}

            {carryOverInfo && carryOverInfo.carryOverCount === 0 && (
              <Alert type="info" showIcon message="无上班次结转记录，将全部安排新订单" />
            )}

            <div>
              <Tag color="blue">已选新订单 {selectedIds.length} 条</Tag>
            </div>
            <Space>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button type="primary" onClick={() => setStep(2)}>下一步：确认排机</Button>
            </Space>
          </Space>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <Space direction="vertical" size="large">
            <div>
              <p>日期：<strong>{date.format('YYYY-MM-DD')}</strong>，班次：<strong>{shift}</strong></p>
              <p>新订单：<strong>{selectedIds.length}</strong> 条</p>
              {carryOverInfo && carryOverInfo.carryOverCount > 0 && (
                <p>结转上班次：<strong style={{ color: '#d46b08' }}>{carryOverInfo.carryOverCount}</strong> 条</p>
              )}
            </div>
            <Space>
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={loading}
                onClick={handleGenerate}
              >
                执行智能排机
              </Button>
            </Space>
          </Space>
        </Card>
      )}
    </div>
  );
}
