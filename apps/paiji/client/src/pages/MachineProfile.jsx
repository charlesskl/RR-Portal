import { useState, useEffect } from 'react';
import { Table, Card, Button, Tag, Input, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/machines';

export default function MachineProfile({ workshop = 'B' }) {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchMachines = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      setMachines(data);
    } catch (e) {
      message.error('获取机台数据失败');
    }
    setLoading(false);
  };

  const refreshStats = async () => {
    try {
      await axios.post(`${API}/refresh-stats`);
      message.success('啤重统计已刷新');
      fetchMachines();
    } catch (e) {
      message.error('刷新失败');
    }
  };

  const toggleStatus = async (record) => {
    const newStatus = record.status === 'active' ? 'inactive' : 'active';
    try {
      await axios.put(`${API}/${record.id}`, { status: newStatus });
      setMachines(prev => prev.map(m => m.id === record.id ? { ...m, status: newStatus } : m));
    } catch (e) {
      message.error('更新失败');
    }
  };

  const updateNotes = async (record, notes) => {
    try {
      await axios.put(`${API}/${record.id}`, { notes });
      setMachines(prev => prev.map(m => m.id === record.id ? { ...m, notes } : m));
    } catch (e) {
      message.error('更新失败');
    }
  };

  useEffect(() => { fetchMachines(); }, [workshop]);

  const columns = [
    { title: '机台', dataIndex: 'machine_no', width: 60, fixed: 'left' },
    { title: '品牌', dataIndex: 'brand', width: 80 },
    { title: '吨位', dataIndex: 'tonnage', width: 60, render: v => `${v}T` },
    { title: '机械手', dataIndex: 'arm_type', width: 90,
      render: v => <Tag color={v === '五轴双臂' ? 'blue' : 'default'}>{v}</Tag>
    },
    { title: '型号描述', dataIndex: 'model_desc', width: 160 },
    { title: '啤重G下限', dataIndex: 'min_shot_weight', width: 90,
      render: v => v > 0 ? `${v}g` : '-'
    },
    { title: '啤重G上限', dataIndex: 'max_shot_weight', width: 90,
      render: v => v > 0 ? `${v}g` : '-'
    },
    { title: '啤重G均值', dataIndex: 'avg_shot_weight', width: 90,
      render: v => v > 0 ? `${v}g` : '-'
    },
    { title: '历史记录数', dataIndex: 'record_count', width: 90 },
    { title: '其他', dataIndex: 'notes', width: 150,
      render: (v, record) => (
        <Input
          size="small"
          defaultValue={v || ''}
          placeholder="备注"
          onBlur={e => { if (e.target.value !== (v || '')) updateNotes(record, e.target.value); }}
          onPressEnter={e => { e.target.blur(); }}
        />
      )
    },
    { title: '状态', dataIndex: 'status', width: 80,
      render: (s, record) => (
        <Tag
          color={s === 'active' ? 'green' : 'red'}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => toggleStatus(record)}
        >
          {s === 'active' ? '正常' : '异常'}
        </Tag>
      )
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={refreshStats}>
          重新统计啤重区间
        </Button>
        <span style={{ marginLeft: 12, color: '#999' }}>
          从历史数据库重新计算每台机的啤重G区间(min/max/avg)
        </span>
      </Card>
      <Table
        columns={columns}
        dataSource={machines}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ x: 1000 }}
      />
    </div>
  );
}
