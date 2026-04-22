import { useState, useEffect } from 'react';
import {
  Table, Button, Space, Tag, Popconfirm, message,
  Modal, Descriptions, Divider, Typography, InputNumber,
  Input, Tooltip,
} from 'antd';
import {
  DownloadOutlined, DeleteOutlined, EyeOutlined,
  PrinterOutlined, EditOutlined, SaveOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { apiUrl } from '../api';

const { Text } = Typography;

export default function ScheduleList() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [current, setCurrent] = useState(null);
  const [editIdx, setEditIdx] = useState(null);
  const [editBuf, setEditBuf] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/schedule');
      setSchedules(res.data);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    await axios.delete(`/api/schedule/${id}`);
    message.success('已删除');
    load();
  };

  const handleView = (record) => {
    setCurrent(record);
    setViewModal(true);
    setEditIdx(null);
  };

  const handleExport = (id) => {
    window.open(apiUrl(`/api/schedule/${id}/export`));
  };

  const handlePrint = () => {
    window.print();
  };

  const startEdit = (idx, item) => {
    setEditIdx(idx);
    setEditBuf({ ...item });
  };

  const saveEdit = async () => {
    try {
      await axios.put(`/api/schedule/${current.id}/item/${editIdx}`, editBuf);
      // 更新本地数据
      const updated = { ...current };
      updated.items = [...current.items];
      updated.items[editIdx] = { ...editBuf };
      setCurrent(updated);
      message.success('已保存');
      setEditIdx(null);
    } catch {
      message.error('保存失败');
    }
  };

  const columns = [
    {
      title: '日期', dataIndex: 'date', width: 120,
      render: v => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '订单数', width: 90,
      render: (_, r) => <Tag color="geekblue">{r.items?.length || 0} 行</Tag>,
    },
    {
      title: '涉及机台', width: 200,
      render: (_, r) => {
        const machines = [...new Set((r.items || []).map(i => i.机台))];
        return machines.map(m => <Tag key={m} color="purple">{m}</Tag>);
      },
    },
    {
      title: '生成时间', dataIndex: 'createdAt', width: 160,
      render: v => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 180, fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="查看/编辑">
            <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(record)} />
          </Tooltip>
          <Tooltip title="导出Excel">
            <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(record.id)} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 详情列（可内联编辑）
  const detailColumns = [
    { title: '机台', dataIndex: '机台', width: 80, render: v => <Tag color="purple">{v}</Tag> },
    { title: '产品货号', dataIndex: '产品货号', width: 100 },
    { title: '模号名称', dataIndex: '模号名称', width: 140 },
    { title: '颜色', dataIndex: '颜色', width: 70 },
    { title: '料型', dataIndex: '料型', width: 90 },
    { title: '啤数', dataIndex: '啤数', width: 90, render: v => Number(v).toLocaleString() },
    { title: '周期(s)', dataIndex: '周期', width: 80 },
    {
      title: '累计数', dataIndex: '累计数', width: 90,
      render: (v, _, idx) => editIdx === idx
        ? <InputNumber size="small" value={editBuf.累计数} min={0} onChange={val => setEditBuf(b => ({ ...b, 累计数: val, 欠数: (editBuf.啤数 || 0) - val }))} style={{ width: 80 }} />
        : v,
    },
    {
      title: '碎啤数', dataIndex: '碎啤数', width: 80,
      render: (v, _, idx) => editIdx === idx
        ? <InputNumber size="small" value={editBuf.碎啤数} min={0} onChange={val => setEditBuf(b => ({ ...b, 碎啤数: val }))} style={{ width: 70 }} />
        : v,
    },
    { title: '欠数', dataIndex: '欠数', width: 80, render: v => <Text type={v > 0 ? 'danger' : 'success'}>{v}</Text> },
    { title: '24H目标', dataIndex: '24H目标', width: 90, render: v => <span style={{ color: '#1677ff' }}>{Number(v).toLocaleString()}</span> },
    { title: '11H目标', dataIndex: '11H目标', width: 90, render: v => <span style={{ color: '#52c41a' }}>{Number(v).toLocaleString()}</span> },
    { title: '天数', dataIndex: '天数', width: 70 },
    {
      title: '备注', dataIndex: '备注', width: 150,
      render: (v, _, idx) => editIdx === idx
        ? <Input size="small" value={editBuf.备注} onChange={e => setEditBuf(b => ({ ...b, 备注: e.target.value }))} />
        : v,
    },
    {
      title: '机械手', dataIndex: '机械手', width: 80,
      render: (v, _, idx) => editIdx === idx
        ? <Input size="small" value={editBuf.机械手} onChange={e => setEditBuf(b => ({ ...b, 机械手: e.target.value }))} style={{ width: 70 }} />
        : v,
    },
    {
      title: '夹具', dataIndex: '夹具', width: 80,
      render: (v, _, idx) => editIdx === idx
        ? <Input size="small" value={editBuf.夹具} onChange={e => setEditBuf(b => ({ ...b, 夹具: e.target.value }))} style={{ width: 70 }} />
        : v,
    },
    {
      title: '调机人员', dataIndex: '调机人员', width: 90,
      render: (v, _, idx) => editIdx === idx
        ? <Input size="small" value={editBuf.调机人员} onChange={e => setEditBuf(b => ({ ...b, 调机人员: e.target.value }))} style={{ width: 80 }} />
        : v,
    },
    {
      title: '操作', width: 80, fixed: 'right',
      render: (_, item, idx) => editIdx === idx
        ? <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存</Button>
        : <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(idx, item)}>编辑</Button>,
    },
  ];

  return (
    <div>
      <Table
        dataSource={schedules}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={`排机表 — ${current?.date}`}
        open={viewModal}
        onCancel={() => { setViewModal(false); setEditIdx(null); }}
        footer={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => handleExport(current?.id)}>导出 Excel</Button>
            <Button icon={<PrinterOutlined />} onClick={handlePrint}>打印</Button>
            <Button onClick={() => { setViewModal(false); setEditIdx(null); }}>关闭</Button>
          </Space>
        }
        width="95vw"
        style={{ top: 20 }}
      >
        {current && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              {[...new Set(current.items.map(i => i.机台))].map(m => {
                const count = current.items.filter(i => i.机台 === m).length;
                return <Tag key={m} color="purple">{m}：{count} 单</Tag>;
              })}
            </Space>
            <Table
              dataSource={current.items}
              columns={detailColumns}
              rowKey={(_, i) => i}
              size="small"
              scroll={{ x: 1400 }}
              pagination={false}
              rowClassName={(r) => r.备注?.includes('⚠️') ? 'ant-table-row-selected' : ''}
            />
          </>
        )}
      </Modal>

      {/* 打印样式 */}
      <style>{`
        @media print {
          .ant-layout-sider, .ant-layout-header, .ant-btn, .ant-modal-close { display: none !important; }
          .ant-modal-content { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}
