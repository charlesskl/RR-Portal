import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, DatePicker, message, Popconfirm, Statistic, Card, Row, Col, Input as AntdInput,
  Upload, Descriptions, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined,
  RobotOutlined, FilePdfOutlined, ImportOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const STATUS_OPTIONS = [
  { value: 'open',          label: '待生产', color: 'blue' },
  { value: 'in_production', label: '生产中', color: 'orange' },
  { value: 'ready_ship',    label: '待出货', color: 'cyan' },
  { value: 'completed',     label: '已完成', color: 'green' },
];

const statusTag = (s) => {
  const opt = STATUS_OPTIONS.find((o) => o.value === s);
  return <Tag color={opt?.color || 'default'}>{opt?.label || s || '-'}</Tag>;
};

const fmtMoney = (v) => (v == null ? '-' : Number(v).toFixed(4));
const fmtDate = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '-');

export default function OutsourceOrders() {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [form] = Form.useForm();
  // AI PDF 导入
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState(null);
  const [aiImporting, setAiImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ordersRes, suppliersRes] = await Promise.all([
        axios.get('/api/orders', { params: { destination: 'outsource' } }),
        axios.get('/api/suppliers'),
      ]);
      setOrders(ordersRes.data);
      setSuppliers(suppliersRes.data);
    } catch (e) {
      message.error('加载失败：' + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (filterSupplier && o.supplier !== filterSupplier) return false;
      if (filterStatus && o.outsource_status !== filterStatus) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const hay = [o.product_code, o.mold_no, o.mold_name, o.supplier, o.pmc_follow].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, filterSupplier, filterStatus, searchText]);

  const summary = useMemo(() => ({
    total: filtered.length,
    totalQty: filtered.reduce((s, o) => s + (o.quantity_needed || 0), 0),
    totalAmount: filtered.reduce((s, o) => s + (o.quantity_needed || 0) * (o.supplier_price_rmb || 0), 0),
    suppliers: new Set(filtered.map((o) => o.supplier).filter(Boolean)).size,
  }), [filtered]);

  const openAdd = () => {
    setEditRecord(null);
    form.resetFields();
    form.setFieldsValue({ destination: 'outsource', outsource_status: 'open' });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditRecord(record);
    form.setFieldsValue({
      ...record,
      order_date:          record.order_date          ? dayjs(record.order_date)          : null,
      production_start:    record.production_start    ? dayjs(record.production_start)    : null,
      estimated_delivery:  record.estimated_delivery  ? dayjs(record.estimated_delivery)  : null,
      actual_delivery:     record.actual_delivery     ? dayjs(record.actual_delivery)     : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      destination: 'outsource',
      order_date:         values.order_date         ? values.order_date.format('YYYY-MM-DD')         : null,
      production_start:   values.production_start   ? values.production_start.format('YYYY-MM-DD')   : null,
      estimated_delivery: values.estimated_delivery ? values.estimated_delivery.format('YYYY-MM-DD') : null,
      actual_delivery:    values.actual_delivery    ? values.actual_delivery.format('YYYY-MM-DD')    : null,
    };
    try {
      if (editRecord) {
        await axios.put(`/api/orders/${editRecord.id}`, payload);
        message.success('已更新');
      } else {
        await axios.post('/api/orders', payload);
        message.success('已新增');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/api/orders/${id}`);
      message.success('已删除');
      load();
    } catch (e) {
      message.error('删除失败：' + (e.response?.data?.message || e.message));
    }
  };

  const handleAiParse = async (file) => {
    setAiLoading(true);
    setAiPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await axios.post('/api/orders/parse-pdf-ai', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      });
      setAiPreview(res.data);
      message.success(`AI 解析到 ${res.data.rows?.length || 0} 条订单`);
    } catch (e) {
      message.error('AI 解析失败：' + (e.response?.data?.message || e.message));
    } finally {
      setAiLoading(false);
    }
    return false; // 阻止 antd Upload 默认上传
  };

  const handleAiImport = async () => {
    if (!aiPreview?.orders_preview?.length) return;
    setAiImporting(true);
    try {
      const res = await axios.post('/api/orders/import-outsource', {
        rows: aiPreview.orders_preview,
      });
      message.success(res.data.message || '已导入');
      setAiOpen(false);
      setAiPreview(null);
      load();
    } catch (e) {
      message.error('入库失败：' + (e.response?.data?.message || e.message));
    } finally {
      setAiImporting(false);
    }
  };

  const columns = [
    { title: '序号', dataIndex: 'order_no', width: 60, fixed: 'left' },
    { title: '货号', dataIndex: 'product_code', width: 100, fixed: 'left' },
    { title: '模具编号', dataIndex: 'mold_no', width: 130 },
    { title: '模具名称', dataIndex: 'mold_name', width: 200, ellipsis: true },
    { title: '加工厂', dataIndex: 'supplier', width: 110,
      render: (s) => s ? <Tag color="purple">{s}</Tag> : '-' },
    { title: '需啤数', dataIndex: 'quantity_needed', width: 90, align: 'right',
      render: (v) => (v || 0).toLocaleString() },
    { title: '日产能', dataIndex: 'capacity_per_day', width: 80, align: 'right' },
    { title: '报价 USD', dataIndex: 'quote_price_usd', width: 90, align: 'right',
      render: fmtMoney },
    { title: '厂价 RMB', dataIndex: 'supplier_price_rmb', width: 90, align: 'right',
      render: fmtMoney },
    { title: '跟进人', dataIndex: 'pmc_follow', width: 80 },
    { title: '下单日', dataIndex: 'order_date', width: 100, render: fmtDate },
    { title: '生产开始', dataIndex: 'production_start', width: 100, render: fmtDate },
    { title: '预计交期', dataIndex: 'estimated_delivery', width: 100, render: fmtDate },
    { title: '状态', dataIndex: 'outsource_status', width: 90,
      render: (s) => statusTag(s || 'open') },
    { title: '备注', dataIndex: 'order_notes', width: 150, ellipsis: true },
    {
      title: '操作', width: 130, fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>改</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="当前订单" value={summary.total} suffix="条" /></Card></Col>
        <Col span={6}><Card><Statistic title="加工厂数" value={summary.suppliers} /></Card></Col>
        <Col span={6}><Card><Statistic title="总啤数" value={summary.totalQty} /></Card></Col>
        <Col span={6}><Card><Statistic title="加工费总额 (RMB)" value={summary.totalAmount} precision={2} /></Card></Col>
      </Row>

      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <AntdInput
          prefix={<SearchOutlined />}
          placeholder="搜索货号 / 模具 / 加工厂 / 跟进人"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          style={{ width: 260 }}
        />
        <Select
          placeholder="按加工厂过滤"
          value={filterSupplier || undefined}
          onChange={(v) => setFilterSupplier(v || '')}
          allowClear
          style={{ width: 180 }}
          options={suppliers.map((s) => ({ value: s.name, label: s.name }))}
        />
        <Select
          placeholder="按状态过滤"
          value={filterStatus || undefined}
          onChange={(v) => setFilterStatus(v || '')}
          allowClear
          style={{ width: 140 }}
          options={STATUS_OPTIONS}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增外发订单</Button>
        <Button icon={<RobotOutlined />} onClick={() => { setAiOpen(true); setAiPreview(null); }}>
          AI 解析 PDF
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: 1800 }}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editRecord ? `编辑外发订单 #${editRecord.id}` : '新增外发订单'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="product_code" label="货号" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mold_no" label="模具编号">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="mold_name" label="模具名称">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quantity_needed" label="需啤数">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="capacity_per_day" label="日产能">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="outsource_status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="supplier" label="加工厂">
                <Select
                  showSearch
                  allowClear
                  options={suppliers.map((s) => ({ value: s.name, label: s.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pmc_follow" label="跟进人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quote_price_usd" label="报价 USD">
                <InputNumber min={0} step={0.0001} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supplier_price_rmb" label="厂价 RMB">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supplier_price_usd" label="厂价 USD">
                <InputNumber min={0} step={0.0001} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="order_date" label="下单日">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="production_start" label="生产开始">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="estimated_delivery" label="预计交期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="actual_delivery" label="实际交期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="order_notes" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* AI PDF 解析 Modal */}
      <Modal
        title={<span><FilePdfOutlined /> AI 解析外发 PDF（阿里百炼 Qwen）</span>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); setAiPreview(null); }}
        width={920}
        destroyOnHidden
        footer={
          aiPreview ? [
            <Button key="cancel" onClick={() => { setAiOpen(false); setAiPreview(null); }}>取消</Button>,
            <Button key="reupload" onClick={() => setAiPreview(null)}>重新上传</Button>,
            <Button key="import" type="primary" icon={<ImportOutlined />}
                    loading={aiImporting} onClick={handleAiImport}>
              入库 {aiPreview.orders_preview?.length || 0} 条
            </Button>,
          ] : null
        }
      >
        {!aiPreview && (
          <Spin spinning={aiLoading} tip="AI 解析中，通常 10-30 秒…">
            <Upload.Dragger
              accept=".pdf"
              maxCount={1}
              beforeUpload={handleAiParse}
              showUploadList={false}
              disabled={aiLoading}
            >
              <p className="ant-upload-drag-icon"><FilePdfOutlined style={{ fontSize: 48, color: '#1677ff' }} /></p>
              <p className="ant-upload-text">点击或拖拽外发 PDF 到这里</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                委托加工合同 / 啤货表 / 采购单 等模板都行，AI 会自动识别
              </p>
            </Upload.Dragger>
          </Spin>
        )}

        {aiPreview && (
          <div>
            <Descriptions size="small" bordered column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="单据号">{aiPreview.header?.bill_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="日期">{aiPreview.header?.place_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="加工厂">{aiPreview.header?.supplier || '-'}</Descriptions.Item>
              <Descriptions.Item label="交货日期">{aiPreview.header?.delivery_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{aiPreview.header?.note || '-'}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey={(_r, i) => i}
              dataSource={aiPreview.orders_preview || []}
              pagination={false}
              scroll={{ y: 320 }}
              columns={[
                { title: '货号', dataIndex: 'product_code', width: 90 },
                { title: '模具编号', dataIndex: 'mold_no', width: 130 },
                { title: '模具名称', dataIndex: 'mold_name', width: 160, ellipsis: true },
                { title: '颜色', dataIndex: 'color', width: 80 },
                { title: '料型', dataIndex: 'material_type', width: 120, ellipsis: true },
                { title: '啤数', dataIndex: 'quantity_needed', width: 80, align: 'right',
                  render: (v) => (v || 0).toLocaleString() },
                { title: '单价', dataIndex: 'supplier_price_rmb', width: 80, align: 'right',
                  render: (v) => v == null ? '-' : Number(v).toFixed(2) },
                { title: '交期', dataIndex: 'estimated_delivery', width: 100 },
              ]}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              模型: {aiPreview.model_used} · Token 用量: {aiPreview.usage?.total_tokens || '-'}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
