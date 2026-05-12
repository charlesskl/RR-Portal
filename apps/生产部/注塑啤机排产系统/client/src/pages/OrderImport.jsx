import { useState, useEffect, useRef } from 'react';
import { Upload, Button, Table, message, Card, Space, Tag, Popconfirm, Input, InputNumber } from 'antd';
import { UploadOutlined, DeleteOutlined, ClearOutlined, DownloadOutlined } from '@ant-design/icons';
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
        const { data } = await axios.post(`${API}/import`, formData, { timeout: 120000 });
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

  // 合并相同模具订单：模号+颜色+色粉+料型 完全一致 → 需啤数累加，单号用 + 合并
  const handleMergeOrders = async () => {
    const groups = {};
    for (const o of orders) {
      if (o.status !== 'pending') continue;
      const key = [o.mold_name, o.color, o.color_powder_no, o.material_type].join('|');
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    }
    const toMerge = Object.values(groups).filter(g => g.length > 1);
    if (toMerge.length === 0) { message.info('没有可合并的订单'); return; }

    let mergedCount = 0, deletedCount = 0;
    for (const group of toMerge) {
      const keep = group[0];
      const others = group.slice(1);
      const totalQty = group.reduce((s, o) => s + (o.quantity_needed || 0), 0);
      // 单号合并：用 + 连接，去重去空
      const serialNos = [...new Set(group.map(o => (o.serial_no || '').trim()).filter(Boolean))].join('+');
      const totalKg = group.reduce((s, o) => s + (o.material_kg || 0), 0);
      try {
        await axios.put(`${API}/${keep.id}`, {
          quantity_needed: totalQty,
          serial_no: serialNos,
          material_kg: Math.round(totalKg * 100) / 100,
        });
        for (const o of others) await axios.delete(`${API}/${o.id}`);
        mergedCount++;
        deletedCount += others.length;
      } catch (e) {
        console.error('合并失败:', e.message);
      }
    }
    message.success(`合并 ${mergedCount} 组，共删除 ${deletedCount} 条重复订单`);
    fetchOrders();
  };

  // 单元格编辑状态
  const [editCell, setEditCell] = useState(null); // { id, field }
  const [editValue, setEditValue] = useState('');

  const startEdit = (record, field) => {
    setEditCell({ id: record.id, field });
    setEditValue(record[field] ?? '');
  };

  const saveEdit = async (record) => {
    if (!editCell) return;
    const field = editCell.field;
    let value = editValue;
    // 数字字段转换
    if (['shot_weight', 'quantity_needed', 'material_kg', 'accumulated', 'cavity', 'cycle_time', 'sprue_pct', 'ratio_pct', 'packing_qty'].includes(field)) {
      value = parseFloat(value) || 0;
    }
    if (value === record[field]) { setEditCell(null); return; }
    try {
      await axios.put(`${API}/${record.id}`, { [field]: value });
      // 编辑「单号」时自动同步所有相同「下单单号」的订单
      if (field === 'serial_no' && record.order_no) {
        const sameOrderNo = orders.filter(o =>
          o.id !== record.id &&
          o.order_no === record.order_no &&
          (!o.serial_no || o.serial_no === '')
        );
        if (sameOrderNo.length > 0) {
          await Promise.all(sameOrderNo.map(o =>
            axios.put(`${API}/${o.id}`, { serial_no: value }).catch(() => null)
          ));
          message.success(`已同步 ${sameOrderNo.length} 条相同下单单号的订单`);
        }
      }
      setEditCell(null);
      fetchOrders();
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  const renderEditable = (field, record, value, options = {}) => {
    const isEditing = editCell && editCell.id === record.id && editCell.field === field;
    if (isEditing) {
      const InputCmp = options.number ? InputNumber : Input;
      return (
        <InputCmp
          size="small"
          autoFocus
          value={editValue}
          onChange={e => setEditValue(options.number ? e : e.target.value)}
          onPressEnter={() => saveEdit(record)}
          onBlur={() => saveEdit(record)}
          style={{ width: '100%' }}
        />
      );
    }
    return (
      <span
        style={{ cursor: 'pointer', display: 'inline-block', minWidth: '100%', minHeight: 20, color: options.color }}
        onClick={() => startEdit(record, field)}
        title="点击编辑"
      >
        {value || <span style={{ color: '#ccc' }}>-</span>}
      </span>
    );
  };

  const columns = [
    { title: '产品货号', dataIndex: 'product_code', width: 120,
      render: (v, r) => renderEditable('product_code', r, v) },
    { title: '模号名称', dataIndex: 'mold_name', width: 150,
      render: (v, r) => renderEditable('mold_name', r, v) },
    { title: '颜色', dataIndex: 'color', width: 80,
      render: (v, r) => renderEditable('color', r, v) },
    { title: '色粉', dataIndex: 'color_powder_no', width: 80,
      render: (v, r) => renderEditable('color_powder_no', r, v) },
    { title: '料型', dataIndex: 'material_type', width: 100,
      render: (v, r) => renderEditable('material_type', r, v) },
    { title: '啤重G', dataIndex: 'shot_weight', width: 80,
      render: (v, r) => renderEditable('shot_weight', r, v, { number: true }) },
    { title: '用料KG', dataIndex: 'material_kg', width: 80,
      render: (v, r) => renderEditable('material_kg', r, v, { number: true }) },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80,
      render: (v, r) => renderEditable('quantity_needed', r, v, { number: true }) },
    { title: '下单单号', dataIndex: 'order_no', width: 120,
      render: (v, r) => renderEditable('order_no', r, v) },
    { title: '备注', dataIndex: 'order_notes', width: 120,
      render: (v, r) => renderEditable('order_notes', r, v, { color: '#d46b08' }) },
    { title: '单号', dataIndex: 'serial_no', width: 100,
      render: (v, r) => renderEditable('serial_no', r, v) },
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
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.bmp,.webp" multiple>
            <Button icon={<UploadOutlined />} type="primary">导入订单 (PDF/Excel/图片)</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={() => window.open('/api/orders/template')}>下载导入模板</Button>
          <Popconfirm title="合并相同模号+颜色+色粉+料型的订单？需啤数累加，单号合并" onConfirm={handleMergeOrders}>
            <Button>合并相同订单</Button>
          </Popconfirm>
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
