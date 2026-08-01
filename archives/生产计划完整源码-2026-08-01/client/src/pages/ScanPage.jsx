import { useState } from 'react';
import {
  Button, Card, Table, Tag, Space, Typography, Alert,
  Checkbox, Spin, message, Collapse, Badge
} from 'antd';
import { ScanOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;

export default function ScanPage() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [writing, setWriting] = useState(false);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    setSelectedKeys([]);
    try {
      const { data } = await axios.get('/api/scan');
      setScanResult(data);
      message.success(`扫描完成，发现 ${data.total} 条新/修改订单`);
    } catch (err) {
      message.error('扫描失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setScanning(false);
    }
  }

  async function handleConfirm() {
    if (selectedKeys.length === 0) {
      message.warning('请先勾选要确认的订单');
      return;
    }
    setWriting(true);
    try {
      await axios.post('/api/scan/confirm', { keys: selectedKeys });
      message.success(`已确认 ${selectedKeys.length} 条订单`);
      const newGrouped = {};
      Object.entries(scanResult.grouped).forEach(([client, orders]) => {
        const remaining = orders.filter(o => !selectedKeys.includes(o.key));
        if (remaining.length > 0) newGrouped[client] = remaining;
      });
      const newTotal = Object.values(newGrouped).reduce((sum, arr) => sum + arr.length, 0);
      setScanResult({ ...scanResult, grouped: newGrouped, total: newTotal, clients: Object.keys(newGrouped).length });
      setSelectedKeys([]);
    } catch (err) {
      message.error('确认失败: ' + err.message);
    } finally {
      setWriting(false);
    }
  }

  function toggleKey(key, checked) {
    if (checked) setSelectedKeys(prev => [...prev, key]);
    else setSelectedKeys(prev => prev.filter(k => k !== key));
  }

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: t => t === 'new'
        ? <Tag color="gold">新单</Tag>
        : <Tag color="blue">修改单</Tag>
    },
    { title: '文件', dataIndex: 'file', ellipsis: true, width: 200 },
    { title: 'Sheet', dataIndex: 'sheet', width: 120 },
    {
      title: '订单数据',
      dataIndex: 'data',
      render: data => (
        <Space wrap size={[4, 2]}>
          {Object.entries(data)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .slice(0, 6)
            .map(([k, v]) => (
              <Text key={k} type="secondary" style={{ fontSize: 12 }}>
                <b>{k}:</b> {String(v).substring(0, 25)}
              </Text>
            ))}
        </Space>
      )
    },
    {
      title: '选择',
      width: 60,
      render: (_, row) => (
        <Checkbox
          checked={selectedKeys.includes(row.key)}
          onChange={e => toggleKey(row.key, e.target.checked)}
        />
      )
    }
  ];

  const allKeys = scanResult
    ? Object.values(scanResult.grouped).flat().map(o => o.key)
    : [];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={2}>排期扫描同步系统</Title>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<ScanOutlined />}
            onClick={handleScan}
            loading={scanning}
            size="large"
          >
            开始扫描 Z 盘
          </Button>
          {scanResult && scanResult.total > 0 && (
            <>
              <Button
                onClick={() => setSelectedKeys(allKeys)}
                size="large"
              >
                全选 ({allKeys.length})
              </Button>
              <Button
                icon={<CheckCircleOutlined />}
                onClick={handleConfirm}
                loading={writing}
                disabled={selectedKeys.length === 0}
                size="large"
                type="default"
              >
                确认已选 ({selectedKeys.length})
              </Button>
            </>
          )}
        </Space>
        {scanning && (
          <div style={{ marginTop: 12 }}>
            <Spin tip="正在扫描所有客户排期文件，请稍候（约1-3分钟）..." />
          </div>
        )}
      </Card>

      {scanResult && (
        <>
          <Alert
            type={scanResult.total > 0 ? 'warning' : 'success'}
            message={
              scanResult.total > 0
                ? `共发现 ${scanResult.total} 条新/修改订单，涉及 ${scanResult.clients} 个客户`
                : '没有发现新订单或修改单'
            }
            style={{ marginBottom: 16 }}
            showIcon
            description={scanResult.errors > 0 ? `${scanResult.errors} 个文件读取失败，已跳过` : undefined}
          />

          {scanResult.total > 0 && (
            <Collapse defaultActiveKey={Object.keys(scanResult.grouped).slice(0, 5)}>
              {Object.entries(scanResult.grouped).map(([client, orders]) => {
                const newCount = orders.filter(o => o.type === 'new').length;
                const modCount = orders.filter(o => o.type === 'modified').length;
                return (
                  <Collapse.Panel
                    key={client}
                    header={
                      <Space>
                        <b>{client}</b>
                        {newCount > 0 && <Badge count={newCount} color="gold" title="新单" />}
                        {modCount > 0 && <Badge count={modCount} color="blue" title="修改单" />}
                      </Space>
                    }
                  >
                    <Button
                      size="small"
                      style={{ marginBottom: 8 }}
                      onClick={() => {
                        const keys = orders.map(o => o.key);
                        setSelectedKeys(prev => [...new Set([...prev, ...keys])]);
                      }}
                    >
                      全选本客户 ({orders.length})
                    </Button>
                    <Table
                      dataSource={orders}
                      columns={columns}
                      rowKey="key"
                      size="small"
                      pagination={{ pageSize: 20, showSizeChanger: false }}
                      rowClassName={row => row.type === 'new' ? 'row-new' : 'row-modified'}
                    />
                  </Collapse.Panel>
                );
              })}
            </Collapse>
          )}
        </>
      )}
    </div>
  );
}
