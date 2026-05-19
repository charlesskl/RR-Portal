import { useState, useEffect } from 'react';
import { Table, Button, Card, Space, Tag, message, Popconfirm, Input, InputNumber, Switch, Select, Modal } from 'antd';
import { DownloadOutlined, DeleteOutlined, CheckCircleOutlined, SaveOutlined, EditOutlined, CopyOutlined, SwapOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/scheduling';
const EXPORT_API = '/api/export';

// 从机台名提取数字用于排序（支持 C-1#、A-12# 等格式）
const getMachineNum = (mno) => { const m = String(mno).match(/(\d+)/); return m ? parseInt(m[1]) : 99; };

export default function ScheduleResult({ workshop = 'B' }) {
  const [schedules, setSchedules] = useState([]);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editingData, setEditingData] = useState({});
  // 累计数内联编辑
  const [accEditKey, setAccEditKey] = useState(null);
  const [accEditVal, setAccEditVal] = useState(0);
  // 目标数内联编辑
  const [targetEditKey, setTargetEditKey] = useState(null);
  const [targetEditVal, setTargetEditVal] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showDayShift, setShowDayShift] = useState(false);
  const [dayShiftItems, setDayShiftItems] = useState([]);
  // 机台列表
  const [machines, setMachines] = useState([]);
  // 机台快速切换
  const [machineEditKey, setMachineEditKey] = useState(null);
  // 复制弹窗
  const [copyModalVisible, setCopyModalVisible] = useState(false);
  const [copyItem, setCopyItem] = useState(null);
  const [copyTargetMachine, setCopyTargetMachine] = useState('');

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      setSchedules(data);
    } catch (e) {
      message.error('获取排机单失败');
    }
    setLoading(false);
  };

  const fetchDetail = async (id) => {
    try {
      const { data } = await axios.get(`${API}/${id}`);
      setSelectedSchedule(data.schedule);
      setItems(data.items || []);
      setEditingKey(null);
      setMachineEditKey(null);
    } catch (e) {
      message.error('获取详情失败');
    }
  };

  const fetchMachines = async () => {
    try {
      const { data } = await axios.get('/api/machines', { params: { workshop } });
      setMachines(data.sort((a, b) => getMachineNum(a.machine_no) - getMachineNum(b.machine_no)));
    } catch (e) {
      // 静默失败
    }
  };

  const handleExport = async (id, shift) => {
    try {
      const res = await axios.get(`${EXPORT_API}/${id}`, {
        params: { shift },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `排机单_${id}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (e) {
      message.error('导出失败：' + (e.response?.data?.message || e.message));
    }
  };

  const handleConfirm = async (id) => {
    try {
      const { data } = await axios.post(`${API}/${id}/confirm`);
      message.success(data.message);
      fetchSchedules();
      if (selectedSchedule?.id === id) fetchDetail(id);
    } catch (e) {
      message.error('确认失败：' + (e.response?.data?.message || e.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/${id}`);
      message.success('已删除');
      if (selectedSchedule?.id === id) {
        setSelectedSchedule(null);
        setItems([]);
      }
      fetchSchedules();
    } catch (e) {
      message.error('删除失败');
    }
  };

  // 开始编辑某行
  const startEdit = (record) => {
    setEditingKey(record.id);
    setEditingData({
      accumulated: record.accumulated || 0,
      notes: record.notes || '',
      robot_arm: record.robot_arm || '',
      clamp: record.clamp || '',
      mold_change_time: record.mold_change_time || '',
      adjuster: record.adjuster || '',
      machine_no: record.machine_no || '',
      color: record.color || '',
      color_powder_no: record.color_powder_no || '',
      material_type: record.material_type || '',
      shot_weight: record.shot_weight || 0,
      material_kg: record.material_kg || 0,
      quantity_needed: record.quantity_needed || 0,
    });
  };

  // 保存单行编辑
  const saveEdit = async (scheduleId, itemId) => {
    try {
      await axios.put(`${API}/${scheduleId}/items/${itemId}`, editingData);
      message.success('已保存');
      setEditingKey(null);
      fetchDetail(scheduleId);
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  // 快速更换机台（点击机台号直接切换）
  const saveMachineChange = async (record, newMachineNo) => {
    try {
      await axios.put(`${API}/${selectedSchedule.id}/items/${record.id}`, { machine_no: newMachineNo });
      message.success(`已更换到 ${newMachineNo}`);
      setMachineEditKey(null);
      fetchDetail(selectedSchedule.id);
    } catch (e) {
      message.error('更换失败：' + (e.response?.data?.message || e.message));
    }
  };

  // 复制到其他机台
  const handleCopy = async () => {
    if (!copyItem || !copyTargetMachine) return;
    try {
      const { data } = await axios.post(
        `${API}/${selectedSchedule.id}/items/${copyItem.id}/copy`,
        { machine_no: copyTargetMachine }
      );
      message.success(data.message);
      setCopyModalVisible(false);
      setCopyItem(null);
      setCopyTargetMachine('');
      fetchDetail(selectedSchedule.id);
    } catch (e) {
      message.error('复制失败：' + (e.response?.data?.message || e.message));
    }
  };

  // 保存目标数（内联快速保存）
  const saveTarget = async (scheduleId, record, val) => {
    try {
      await axios.put(`${API}/${scheduleId}/items/${record.id}`, { target_24h: val });
      message.success('目标数已保存');
      setTargetEditKey(null);
      fetchDetail(scheduleId);
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  // 保存累计数（内联快速保存）
  const saveAccumulated = async (scheduleId, record, val) => {
    try {
      await axios.put(`${API}/${scheduleId}/items/${record.id}`, { accumulated: val });
      message.success('累计数已保存');
      setAccEditKey(null);
      fetchDetail(scheduleId);
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  // 获取同日期白班排单
  const fetchDayShift = async (schedule) => {
    if (!schedule || schedule.shift === '白班') return;
    try {
      const { data } = await axios.get(API, { params: { workshop } });
      const daySchedule = data.find(s => s.schedule_date === schedule.schedule_date && s.shift === '白班');
      if (daySchedule) {
        const { data: detail } = await axios.get(`${API}/${daySchedule.id}`);
        setDayShiftItems((detail.items || []).map(item => ({ ...item, _isDayShift: true })));
      } else {
        setDayShiftItems([]);
      }
    } catch (e) {
      setDayShiftItems([]);
    }
  };

  useEffect(() => {
    if (showDayShift && selectedSchedule) fetchDayShift(selectedSchedule);
    else setDayShiftItems([]);
  }, [showDayShift, selectedSchedule?.id]);

  useEffect(() => { fetchSchedules(); fetchMachines(); }, [workshop]);

  const scheduleColumns = [
    { title: '日期', dataIndex: 'schedule_date', width: 110 },
    { title: '班次', dataIndex: 'shift', width: 80,
      render: s => <Tag>{s}</Tag>
    },
    { title: '状态', dataIndex: 'status', width: 90,
      render: s => <Tag color={s === 'draft' ? 'default' : s === 'confirmed' ? 'green' : 'blue'}>
        {s === 'draft' ? '草稿' : s === 'confirmed' ? '已保存' : s}
      </Tag>
    },
    { title: '说明', dataIndex: 'notes', ellipsis: true,
      render: v => v ? <span style={{ color: '#d46b08', fontSize: 12 }}>{v}</span> : ''
    },
    { title: '操作', width: 320,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => fetchDetail(r.id)}>查看明细</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(r.id, r.shift)}>导出Excel</Button>
          <Popconfirm title="确定删除此排机单?" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ];

  const isEditing = (record) => record.id === editingKey;
  const isConfirmed = selectedSchedule?.status === 'confirmed';

  const itemColumns = [
    { title: '机台', dataIndex: 'machine_no', width: 90, fixed: 'left',
      render: (v, record) => {
        if (record._isDayShift || isConfirmed) return <strong>{v}</strong>;
        // 编辑模式：下拉选择
        if (isEditing(record)) {
          return (
            <Select size="small" value={editingData.machine_no} onChange={val => setEditingData({...editingData, machine_no: val})} style={{width: 75}}>
              {machines.map(m => <Select.Option key={m.machine_no} value={m.machine_no}>{m.machine_no}</Select.Option>)}
            </Select>
          );
        }
        // 快速切换模式：点击机台号弹出下拉
        if (machineEditKey === record.id) {
          return (
            <Select
              size="small"
              value={v}
              onChange={val => saveMachineChange(record, val)}
              onBlur={() => setMachineEditKey(null)}
              style={{width: 75}}
              autoFocus
              open
            >
              {machines.map(m => <Select.Option key={m.machine_no} value={m.machine_no}>{m.machine_no}</Select.Option>)}
            </Select>
          );
        }
        // 默认显示：点击可切换
        return (
          <span
            style={{ cursor: 'pointer', color: '#1677ff', fontWeight: 'bold' }}
            onClick={() => setMachineEditKey(record.id)}
            title="点击更换机台"
          >
            {v} <SwapOutlined style={{ fontSize: 10 }} />
          </span>
        );
      }
    },
    { title: '产品货号', dataIndex: 'product_code', width: 110 },
    { title: '模号名称', dataIndex: 'mold_name', width: 160, ellipsis: true },
    { title: '颜色', dataIndex: 'color', width: 90,
      render: (v, record) => isEditing(record)
        ? <Input size="small" value={editingData.color} onChange={e => setEditingData({...editingData, color: e.target.value})} />
        : v },
    { title: '色粉编号', dataIndex: 'color_powder_no', width: 90,
      render: (v, record) => isEditing(record)
        ? <Input size="small" value={editingData.color_powder_no} onChange={e => setEditingData({...editingData, color_powder_no: e.target.value})} />
        : v },
    { title: '料型', dataIndex: 'material_type', width: 120,
      render: (v, record) => isEditing(record)
        ? <Input size="small" value={editingData.material_type} onChange={e => setEditingData({...editingData, material_type: e.target.value})} />
        : v },
    { title: '啤重G', dataIndex: 'shot_weight', width: 80,
      render: (v, record) => isEditing(record)
        ? <InputNumber size="small" style={{width:70}} value={editingData.shot_weight} onChange={val => setEditingData({...editingData, shot_weight: val || 0})} />
        : v },
    { title: '用料KG', dataIndex: 'material_kg', width: 80,
      render: (v, record) => isEditing(record)
        ? <InputNumber size="small" style={{width:70}} value={editingData.material_kg} onChange={val => setEditingData({...editingData, material_kg: val || 0})} />
        : v },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 90,
      render: (v, record) => isEditing(record)
        ? <InputNumber size="small" style={{width:80}} value={editingData.quantity_needed} onChange={val => setEditingData({...editingData, quantity_needed: val || 0})} />
        : v },
    { title: '累计数', dataIndex: 'accumulated', width: 110,
      render: (v, record) => {
        if (isConfirmed) {
          return v > 0 ? <span style={{ color: '#d48806', fontWeight: 'bold' }}>{v}</span> : v;
        }
        if (accEditKey === record.id) {
          return (
            <InputNumber
              size="small"
              value={accEditVal}
              min={0}
              onChange={val => setAccEditVal(val || 0)}
              onPressEnter={() => saveAccumulated(selectedSchedule.id, record, accEditVal)}
              onBlur={() => saveAccumulated(selectedSchedule.id, record, accEditVal)}
              style={{ width: 90 }}
              autoFocus
            />
          );
        }
        return (
          <span
            style={{ cursor: 'pointer', color: v > 0 ? '#d48806' : '#1677ff', fontWeight: v > 0 ? 'bold' : 'normal' }}
            onClick={() => { setAccEditKey(record.id); setAccEditVal(v || 0); }}
            title="点击编辑累计数"
          >
            {v || 0} ✎
          </span>
        );
      }
    },
    { title: '欠数', dataIndex: 'shortage', width: 90,
      render: (v, record) => {
        // 若当前行正在编辑累计数，实时显示预计欠数
        if (accEditKey === record.id) {
          const live = Math.max(0, (record.quantity_needed || 0) - accEditVal);
          return <span style={{ color: live === 0 ? '#52c41a' : '#cf1322', fontWeight: 'bold' }}>{live === 0 ? '✓ 已完成' : live}</span>;
        }
        if (v === 0) return <Tag color="success">已完成</Tag>;
        return v;
      }
    },
    { title: '单号', dataIndex: 'serial_no', width: 100,
      render: v => v || ''
    },
    { title: '24H目标', dataIndex: 'target_24h', width: 100,
      render: (v, record) => {
        if (record._isDayShift || isConfirmed) {
          return v > 0 ? v : '';
        }
        if (targetEditKey === record.id) {
          return (
            <InputNumber
              size="small"
              value={targetEditVal}
              min={0}
              onChange={val => setTargetEditVal(val || 0)}
              onPressEnter={() => saveTarget(selectedSchedule.id, record, targetEditVal)}
              onBlur={() => saveTarget(selectedSchedule.id, record, targetEditVal)}
              style={{ width: 85 }}
              autoFocus
            />
          );
        }
        return (
          <span
            style={{ cursor: 'pointer', color: v > 0 ? '#1677ff' : '#bbb' }}
            onClick={() => { setTargetEditKey(record.id); setTargetEditVal(v || 0); }}
            title="点击编辑24H目标"
          >
            {v > 0 ? v : '-'} ✎
          </span>
        );
      }
    },
    { title: '11H目标', dataIndex: 'target_11h', width: 80,
      render: v => v > 0 ? Math.round(v) : ''
    },
    { title: '天数', dataIndex: 'days_needed', width: 60,
      render: v => v > 0 ? Math.round(v * 100) / 100 : ''
    },
    { title: '装箱数', dataIndex: 'packing_qty', width: 70 },
    { title: '备注', dataIndex: 'notes', width: 120,
      render: (v, record) => isEditing(record) ? (
        <Input size="small" value={editingData.notes} onChange={e => setEditingData({...editingData, notes: e.target.value})} />
      ) : (v ? <span style={{ color: 'red', fontWeight: 'bold' }}>{v}</span> : '')
    },
    { title: '机械手', dataIndex: 'robot_arm', width: 80,
      render: (v, record) => isEditing(record) ? (
        <Input size="small" value={editingData.robot_arm} onChange={e => setEditingData({...editingData, robot_arm: e.target.value})} style={{width: 65}} />
      ) : v
    },
    { title: '夹具', dataIndex: 'clamp', width: 70,
      render: (v, record) => isEditing(record) ? (
        <Input size="small" value={editingData.clamp} onChange={e => setEditingData({...editingData, clamp: e.target.value})} style={{width: 55}} />
      ) : v
    },
    { title: '转膜时间', dataIndex: 'mold_change_time', width: 90,
      render: (v, record) => isEditing(record) ? (
        <Input size="small" value={editingData.mold_change_time} onChange={e => setEditingData({...editingData, mold_change_time: e.target.value})} style={{width: 75}} />
      ) : v
    },
    { title: '调机人员', dataIndex: 'adjuster', width: 80,
      render: (v, record) => isEditing(record) ? (
        <Input size="small" value={editingData.adjuster} onChange={e => setEditingData({...editingData, adjuster: e.target.value})} style={{width: 65}} />
      ) : v
    },
    { title: '操作', width: 150, fixed: 'right',
      render: (_, record) => {
        if (record._isDayShift) return null;
        if (isConfirmed) return <Tag color="green">已保存</Tag>;
        return isEditing(record) ? (
          <Space>
            <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => saveEdit(selectedSchedule.id, record.id)}>保存</Button>
            <Button size="small" onClick={() => setEditingKey(null)}>取消</Button>
          </Space>
        ) : (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(record)} title="编辑">编辑</Button>
            <Button size="small" icon={<CopyOutlined />} onClick={() => {
              setCopyItem(record);
              setCopyTargetMachine('');
              setCopyModalVisible(true);
            }} title="复制到其他机台">复制</Button>
          </Space>
        );
      }
    },
  ];

  return (
    <div>
      <Card title="排机单列表" size="small" style={{ marginBottom: 16 }}>
        <Table
          columns={scheduleColumns}
          dataSource={schedules}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20 }}
        />
      </Card>

      {selectedSchedule && (
        <Card
          title={
            <Space>
              <span>排机明细 - {selectedSchedule.schedule_date} {selectedSchedule.shift}</span>
              <Tag color={selectedSchedule.status === 'confirmed' ? 'green' : 'default'}>
                {selectedSchedule.status === 'confirmed' ? '已保存' : '草稿'}
              </Tag>
              <span style={{ color: '#999', fontSize: 12 }}>共 {items.filter(r => r.shortage > 0).length} 条待生产 {items.filter(r => r.shortage === 0).length > 0 ? `/ ${items.filter(r => r.shortage === 0).length}条已完成` : ''}</span>
              <Switch size="small" checked={showCompleted} onChange={setShowCompleted} checkedChildren="显示已完成" unCheckedChildren="隐藏已完成" />
              {selectedSchedule?.shift === '夜班' && (
                <Switch size="small" checked={showDayShift} onChange={setShowDayShift} checkedChildren="显示白班" unCheckedChildren="显示白班" />
              )}
            </Space>
          }
          size="small"
          extra={null}
        >
          <Table
            columns={itemColumns}
            dataSource={(() => {
              let data = showCompleted ? items : items.filter(r => r.shortage > 0);
              if (showDayShift && dayShiftItems.length > 0) {
                const dayItems = showCompleted ? dayShiftItems : dayShiftItems.filter(r => r.shortage > 0);
                data = [...dayItems, ...data];
              }
              // 按机台号排序（支持 C-1#、A-12# 等格式）
              data.sort((a, b) => getMachineNum(a.machine_no) - getMachineNum(b.machine_no));
              return data;
            })()}
            rowKey={r => r._isDayShift ? `day_${r.id}` : r.id}
            size="small"
            pagination={false}
            scroll={{ x: 2000 }}
            rowClassName={record => record._isDayShift ? 'day-shift-row' : ''}
          />
        </Card>
      )}

      {/* 复制到其他机台弹窗 */}
      <Modal
        title="复制到其他机台"
        open={copyModalVisible}
        onOk={handleCopy}
        onCancel={() => { setCopyModalVisible(false); setCopyItem(null); }}
        okText="确定复制"
        cancelText="取消"
        okButtonProps={{ disabled: !copyTargetMachine }}
      >
        {copyItem && (
          <div>
            <p><strong>当前：</strong>{copyItem.machine_no} - {copyItem.mold_name} ({copyItem.color})</p>
            <p style={{ marginTop: 16 }}><strong>复制到机台：</strong></p>
            <Select
              style={{ width: '100%' }}
              value={copyTargetMachine || undefined}
              onChange={setCopyTargetMachine}
              placeholder="选择目标机台"
              showSearch
              filterOption={(input, option) => option.children.toLowerCase().includes(input.toLowerCase())}
            >
              {machines
                .filter(m => m.machine_no !== copyItem.machine_no)
                .map(m => <Select.Option key={m.machine_no} value={m.machine_no}>{m.machine_no}</Select.Option>)
              }
            </Select>
          </div>
        )}
      </Modal>
    </div>
  );
}
