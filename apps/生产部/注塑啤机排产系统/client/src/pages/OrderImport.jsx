import { useState, useEffect, useRef } from 'react';
import { Upload, Button, Table, message, Card, Space, Tag, Popconfirm, Input, InputNumber, Drawer, Form } from 'antd';
import {
  DeleteOutlined,
  ClearOutlined,
  DownloadOutlined,
  PlusOutlined,
  InboxOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { apiUrl } from '../api';

const API = '/api/orders';

const PARSER_LABELS = {
  'beihuo-fixed-table': '啤货表坐标规则',
  'beihuo-image-grid': '啤货表图片网格',
  'beihuo-excel': '啤货表 Excel',
  'xingxin-excel': '兴信生产单 Excel',
  'generic-excel': '通用 Excel',
  'outsource-A_xinxin': '兴信外发规则',
  'qwen-pdf-vision': 'PDF 视觉识别',
  'qwen-image-vision': '图片视觉识别',
  'local-pdf': '本地 PDF 规则',
  'local-image-ocr': '本地图片 OCR',
};

function validatePreviewOrder(row) {
  const errors = [];
  const warnings = [];
  const quantity = Number(row.quantity_needed) || 0;
  const shotWeight = Number(row.shot_weight) || 0;
  const materialKg = Number(row.material_kg) || 0;

  if (!String(row.mold_no || '').trim() && !String(row.mold_name || '').trim()) {
    errors.push('缺少模具编号或模具名称');
  }
  if (!(quantity > 0)) errors.push('需啤数必须大于 0');
  if (!String(row.product_code || '').trim()) warnings.push('产品货号为空');
  if (!String(row.material_type || '').trim()) warnings.push('料型为空');
  if (!(shotWeight > 0)) warnings.push('啤重为空或为 0');
  if (!(materialKg > 0)) warnings.push('用料KG为空或为 0');

  if (shotWeight > 0 && quantity > 0 && materialKg > 0) {
    const expected = shotWeight * quantity / 1000;
    const difference = Math.abs(expected - materialKg) / Math.max(expected, materialKg, 1);
    if (difference > 0.1) {
      warnings.push(
        '重量偏差 ' + Math.round(difference * 100)
        + '%，按啤重和啤数应约 ' + expected.toFixed(2) + 'KG'
      );
    }
  }
  return { errors, warnings };
}

export default function OrderImport({ workshop = 'B' }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewFiles, setPreviewFiles] = useState([]);
  const [confirming, setConfirming] = useState(false);

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

  useEffect(() => {
    fetchOrders();
    setPreviewOpen(false);
    setPreviewRows([]);
    setPreviewFiles([]);
  }, [workshop]);

  const uploadQueue = useRef([]);
  const uploadTimer = useRef(null);
  const previewSequence = useRef(0);

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
    if (files.length === 0) return;
    setParsing(true);
    const nextRows = [];
    const parsedFiles = [];
    const failMessages = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workshop', workshop);
        formData.append('preview', '1');
        try {
          const { data } = await axios.post(API + '/import', formData, { timeout: 120000 });
          const fileRows = Array.isArray(data.orders) ? data.orders : [];
          parsedFiles.push({
            name: data.source_file || file.name,
            parser: data.parser || 'unknown',
            count: fileRows.length,
          });
          for (const row of fileRows) {
            previewSequence.current += 1;
            nextRows.push({
              ...row,
              preview_id: 'preview-' + previewSequence.current,
              source_file: data.source_file || file.name,
              parser: data.parser || row.parser || 'unknown',
            });
          }
        } catch (error) {
          failMessages.push(
            file.name + '：' + (error.response?.data?.message || error.message)
          );
        }
      }

      if (nextRows.length > 0) {
        setPreviewRows(nextRows);
        setPreviewFiles(parsedFiles);
        setPreviewOpen(true);
        message.success('成功解析 ' + nextRows.length + ' 条订单，请核对后确认导入');
        if (failMessages.length > 0) message.warning(failMessages.join('；'), 8);
      } else if (failMessages.length > 0) {
        message.error(failMessages.join('；'), 10);
      } else {
        message.warning('未解析出订单数据');
      }
    } finally {
      setParsing(false);
    }
  };

  const updatePreviewRow = (previewId, field, value) => {
    setPreviewRows((rows) => rows.map((row) => (
      row.preview_id === previewId ? { ...row, [field]: value } : row
    )));
  };

  const removePreviewRow = (previewId) => {
    setPreviewRows((rows) => rows.filter((row) => row.preview_id !== previewId));
  };

  const closePreview = () => {
    if (confirming) return;
    setPreviewOpen(false);
    setPreviewRows([]);
    setPreviewFiles([]);
  };

  const previewSummary = previewRows.reduce((summary, row) => {
    const result = validatePreviewOrder(row);
    if (result.errors.length > 0) summary.errors += 1;
    summary.warnings += result.warnings.length;
    return summary;
  }, { errors: 0, warnings: 0 });

  const confirmPreviewImport = async () => {
    if (previewRows.length === 0) {
      message.warning('没有可导入的订单');
      return;
    }
    if (previewSummary.errors > 0) {
      message.error('还有 ' + previewSummary.errors + ' 条错误订单，请先修正');
      return;
    }

    setConfirming(true);
    try {
      const ordersToImport = previewRows.map((row) => {
        const { preview_id, validation, ...order } = row;
        return order;
      });
      const { data } = await axios.post(API + '/import-confirm', {
        workshop,
        orders: ordersToImport,
      }, { timeout: 120000 });
      message.success(data.message || ('成功导入 ' + ordersToImport.length + ' 条订单'));
      setPreviewOpen(false);
      setPreviewRows([]);
      setPreviewFiles([]);
      fetchOrders();
    } catch (error) {
      message.error(error.response?.data?.message || ('确认导入失败：' + error.message), 8);
    } finally {
      setConfirming(false);
    }
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
  // 手动添加订单
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const openAdd = () => {
    addForm.resetFields();
    addForm.setFieldsValue({ workshop, status: 'pending' });
    setAddOpen(true);
  };
  const handleAddSave = async () => {
    try {
      const v = await addForm.validateFields();
      await axios.post(API, { ...v, workshop });
      message.success('已添加');
      setAddOpen(false);
      fetchOrders();
    } catch (e) {
      if (e?.errorFields) return;
      message.error('添加失败：' + (e.response?.data?.message || e.message));
    }
  };

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
    { title: '产品货号', dataIndex: 'product_code', width: 140,
      render: (v, r) => (
        <div style={{ wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: '20px' }}>
          {renderEditable('product_code', r, v)}
        </div>
      ) },
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
    { title: '需啤数', dataIndex: 'quantity_needed', width: 80,
      render: (v, r) => renderEditable('quantity_needed', r, v, { number: true }) },
    { title: '用料KG', dataIndex: 'material_kg', width: 80,
      render: (v, r) => renderEditable('material_kg', r, v, { number: true }) },
    { title: '下单单号', dataIndex: 'order_no', width: 160,
      render: (v, r) => (
        <div style={{ wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: '20px' }}>
          {renderEditable('order_no', r, v)}
        </div>
      ) },
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

  const previewTextColumn = (title, field, width) => ({
    title,
    dataIndex: field,
    width,
    render: (value, record) => (
      <Input
        size="small"
        value={value || ''}
        onChange={(event) => updatePreviewRow(record.preview_id, field, event.target.value)}
      />
    ),
  });

  const previewNumberColumn = (title, field, width, options = {}) => ({
    title,
    dataIndex: field,
    width,
    render: (value, record) => (
      <InputNumber
        size="small"
        value={value ?? null}
        min={options.min ?? 0}
        precision={options.precision}
        step={options.step || 1}
        controls={false}
        onChange={(nextValue) => updatePreviewRow(record.preview_id, field, nextValue ?? 0)}
        style={{ width: '100%' }}
      />
    ),
  });

  const previewColumns = [
    {
      title: '#',
      key: 'preview_index',
      width: 48,
      fixed: 'left',
      render: (_, record, index) => index + 1,
    },
    previewTextColumn('产品货号', 'product_code', 115),
    previewTextColumn('模具编号', 'mold_no', 145),
    previewTextColumn('模具名称', 'mold_name', 190),
    previewTextColumn('颜色', 'color', 105),
    previewTextColumn('色粉号', 'color_powder_no', 90),
    previewTextColumn('料型', 'material_type', 150),
    previewNumberColumn('啤重G', 'shot_weight', 90, { step: 0.01 }),
    previewNumberColumn('需啤数', 'quantity_needed', 100, { precision: 0 }),
    previewNumberColumn('用料KG', 'material_kg', 100, { step: 0.01 }),
    previewNumberColumn('出模数', 'cavity', 80, { min: 1, precision: 0 }),
    previewTextColumn('下单单号', 'order_no', 150),
    previewTextColumn('备注', 'order_notes', 170),
    {
      title: '校验',
      key: 'preview_validation',
      width: 190,
      fixed: 'right',
      render: (_, record) => {
        const result = validatePreviewOrder(record);
        if (result.errors.length > 0) {
          return <Tag color="error" title={result.errors.join('；')}>错误：{result.errors[0]}</Tag>;
        }
        if (result.warnings.length > 0) {
          return <Tag color="warning" title={result.warnings.join('；')}>提示：{result.warnings[0]}</Tag>;
        }
        return <Tag color="success">校验通过</Tag>;
      },
    },
    {
      title: '',
      key: 'preview_delete',
      width: 52,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          title="删除这一行"
          onClick={() => removePreviewRow(record.preview_id)}
        />
      ),
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Upload.Dragger
          beforeUpload={handleUpload}
          showUploadList={false}
          accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.bmp,.webp"
          multiple
          disabled={parsing}
          style={{
            marginBottom: 12,
            padding: '10px 16px',
            borderRadius: 8,
            background: '#f8fbff',
          }}
        >
          <Space size={12} style={{ width: '100%', justifyContent: 'center' }}>
            <InboxOutlined style={{ color: '#1677ff', fontSize: 22 }} />
            <strong>{parsing ? '正在按规则解析订单…' : '拖入订单文件，或点击选择'}</strong>
            <span style={{ color: '#8c8c8c' }}>PDF / Excel / 图片</span>
          </Space>
        </Upload.Dragger>
        <Space>
          <Button icon={<PlusOutlined />} onClick={openAdd}>手动添加</Button>
          <Button icon={<DownloadOutlined />} onClick={() => window.open(apiUrl('/api/orders/template'))}>下载导入模板</Button>
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

      <Drawer
        title="订单解析预览"
        width="96vw"
        open={previewOpen}
        onClose={closePreview}
        maskClosable={!confirming}
        extra={(
          <Space>
            <Button onClick={closePreview} disabled={confirming}>取消</Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={confirming}
              disabled={previewRows.length === 0 || previewSummary.errors > 0}
              onClick={confirmPreviewImport}
            >
              确认导入（{previewRows.length} 条）
            </Button>
          </Space>
        )}
      >
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          <Tag color="blue">当前车间：{workshop}</Tag>
          <Tag>共 {previewRows.length} 条</Tag>
          <Tag color={previewSummary.errors > 0 ? 'error' : 'success'}>
            错误 {previewSummary.errors} 条
          </Tag>
          <Tag color={previewSummary.warnings > 0 ? 'warning' : 'default'}>
            提示 {previewSummary.warnings} 项
          </Tag>
          {previewFiles.map((file, index) => (
            <Tag key={file.name + '-' + index}>
              {file.name} · {PARSER_LABELS[file.parser] || file.parser} · {file.count} 条
            </Tag>
          ))}
        </Space>
        <Table
          columns={previewColumns}
          dataSource={previewRows}
          rowKey="preview_id"
          size="small"
          pagination={false}
          scroll={{ x: 1750, y: 'calc(100vh - 220px)' }}
        />
      </Drawer>

      <Drawer
        title="手动添加订单"
        width={520}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        extra={<Space><Button onClick={() => setAddOpen(false)}>取消</Button><Button type="primary" onClick={handleAddSave}>保存</Button></Space>}
      >
        <Form form={addForm} layout="vertical" size="small">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="product_code" label="产品货号" style={{ width: '50%' }}>
              <Input placeholder="如 77858" />
            </Form.Item>
            <Form.Item name="order_no" label="下单单号" style={{ width: '50%' }}>
              <Input placeholder="如 CMC260397" />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="mold_name" label="模号名称" rules={[{ required: true, message: '请填写模号名称' }]}>
            <Input placeholder="如 MCKP-01M-01 洗手盆模" />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="color" label="颜色" style={{ width: '50%' }}>
              <Input placeholder="如 米黄/9064C" />
            </Form.Item>
            <Form.Item name="color_powder_no" label="色粉号" style={{ width: '50%' }}>
              <Input placeholder="如 89956" />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="material_type" label="料型">
            <Input placeholder="如 ABS KF-740" />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="shot_weight" label="啤重 G" style={{ width: '33%' }}>
              <InputNumber step={0.1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="material_kg" label="用料 KG" style={{ width: '34%' }}>
              <InputNumber step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="quantity_needed" label="需啤数" rules={[{ required: true, message: '请填写需啤数' }]} style={{ width: '33%' }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="serial_no" label="单号" style={{ width: '50%' }}>
              <Input placeholder="如 B186" />
            </Form.Item>
            <Form.Item name="packing_qty" label="装箱量" style={{ width: '50%' }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="order_notes" label="备注">
            <Input.TextArea rows={2} placeholder="如 喷油" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
