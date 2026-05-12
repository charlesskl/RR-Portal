import { useEffect, useState, useCallback } from 'react';
import {
  Tabs, Form, Input, InputNumber, DatePicker, Button, Select, Table,
  Space, Tag, message, Popconfirm, Card, Upload, Modal, Alert, InputNumber as AntInputNumber,
} from 'antd';
import {
  PlayCircleOutlined, CheckCircleOutlined, RedoOutlined, DeleteOutlined, FilePdfOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';

function fmtTime(s) {
  return s ? dayjs(s).format('MM-DD HH:mm') : '';
}

function normalizeTechnique(t) {
  if (!t) return '其它';
  const s = String(t);
  if (s.includes('UV')) return 'UV';
  if (s.includes('移印')) return '移印';
  if (s.includes('喷油') || s.includes('手喷') || s.includes('自动机')) return '喷油';
  if (s.includes('散枪')) return '散枪';
  if (s.includes('洗')) return '洗货';
  return s;
}

function NumCell({ value, min = 1, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <InputNumber
      size="small"
      min={min}
      value={v}
      style={{ width: 90 }}
      onChange={setV}
      onBlur={() => {
        if (v != null && v !== value) onSave(Number(v));
      }}
    />
  );
}

export default function Orders() {
  const [activeTab, setActiveTab] = useState('list');
  const [productOptions, setProductOptions] = useState([]);
  const [lines, setLines] = useState([]);
  const [list, setList] = useState([]);
  const [detailMap, setDetailMap] = useState({}); // orderId -> schedule_lines
  const [month, setMonth] = useState(dayjs());
  const [q, setQ] = useState('');
  const [form] = Form.useForm();
  // PDF 导入
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);  // {header, code, product, items, matched, error}
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => { api.get('/lines').then(r => setLines(r.data)); }, []);

  const monthStr = month ? month.format('YYYY-MM') : '';

  const loadList = useCallback(async () => {
    const { data } = await api.get('/orders', {
      params: { month: monthStr || undefined, q: q || undefined },
    });
    setList(data);
  }, [monthStr, q]);

  useEffect(() => { loadList(); }, [loadList]);

  const searchProducts = async (qq) => {
    const { data } = await api.get('/products', { params: { q: qq } });
    setProductOptions(data.map(p => ({
      value: p.id,
      label: `${p.code} - ${p.name}`,
      quote_price: p.quote_price,
    })));
  };

  const loadDetail = async (orderId) => {
    const { data } = await api.get(`/orders/${orderId}`);
    setDetailMap(prev => ({ ...prev, [orderId]: data.schedule_lines }));
  };

  const onCreate = async () => {
    try {
      const vals = await form.validateFields();
      const payload = {
        order_name: vals.order_name,
        product_id: vals.product_id,
        total_qty: Number(vals.total_qty),
        start_date: vals.start_date.format('YYYY-MM-DD'),
        remarks: vals.remarks || '',
      };
      await api.post('/orders', payload);
      message.success('订单已创建,排产已自动展开');
      form.resetFields();
      setActiveTab('list');
      loadList();
    } catch (err) {
      if (err && err.errorFields) return; // form validation
      message.error('创建失败: ' + (err?.response?.data?.error || err.message));
    }
  };

  const onDeleteOrder = async (oid) => {
    await api.delete(`/orders/${oid}`);
    message.success('已删除');
    loadList();
  };

  const onUpdateSL = async (oid, slId, patch) => {
    await api.put(`/orders/${oid}/schedule-lines/${slId}`, patch);
    loadDetail(oid);
    loadList();
  };

  const onClock = async (oid, slId, action) => {
    await api.post(`/orders/${oid}/schedule-lines/${slId}/${action}`);
    loadDetail(oid);
    loadList();
  };

  // PDF 导入预览
  const onPdfUpload = async (file) => {
    setPdfLoading(true);
    setPdfPreview(null);
    setPdfModalOpen(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/orders/import-pdf', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // 给每个 PDF item 默认勾选所有 matched_processes(用户可改 qty 或取消)
      const items = (data.items || []).map(it => ({
        ...it,
        // 选中的工序 ids:默认全选
        selected_process_ids: (it.matched_processes || []).map(p => p.id),
        edit_qty: it.pdf_qty,
      }));
      setPdfPreview({ ...data, items });
    } catch (e) {
      message.error('PDF 解析失败: ' + (e.response?.data?.error || e.message));
      setPdfModalOpen(false);
    } finally {
      setPdfLoading(false);
    }
    return false; // 阻止 antd Upload 自动上传
  };

  const onPdfConfirm = async () => {
    if (!pdfPreview || !pdfPreview.matched) return;
    // 把每行的 PDF 部位 × 选中工序 都展开成 (product_process_id, qty)
    const items = [];
    for (const it of pdfPreview.items) {
      for (const ppid of (it.selected_process_ids || [])) {
        items.push({ product_process_id: ppid, qty: Number(it.edit_qty) || 0 });
      }
    }
    if (!items.length) {
      message.warning('没有可导入的工序');
      return;
    }
    try {
      const payload = {
        product_id: pdfPreview.product.id,
        order_name: pdfPreview.header.order_no || `PDF-${dayjs().format('YYYYMMDDHHmm')}`,
        start_date: pdfPreview.header.order_date || dayjs().format('YYYY-MM-DD'),
        items,
      };
      await api.post('/orders/import-pdf/confirm', payload);
      message.success(`已创建订单,${items.length} 条工序`);
      setPdfModalOpen(false);
      setPdfPreview(null);
      // 自动把月份切到订单起始日所在月,免得列表看不到
      if (payload.start_date) {
        setMonth(dayjs(payload.start_date).startOf('month'));
      }
      loadList();
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const lineOptions = lines.map(l => ({ value: l.id, label: l.name }));

  const monthlyOutput = list.reduce(
    (s, o) => s + Number(o.total_qty || 0) * Number(o.quote_price || 0),
    0,
  );

  const renderCreateForm = () => (
    <Form form={form} layout="vertical" style={{ maxWidth: 600 }}
      initialValues={{ start_date: dayjs() }}>
      <Form.Item name="order_name" label="订单名"
        rules={[{ required: true, message: '请输入订单名' }]}>
        <Input placeholder="例如:2026-05 A01" />
      </Form.Item>
      <Form.Item name="product_id" label="货号"
        rules={[{ required: true, message: '请选择货号' }]}>
        <Select
          showSearch
          placeholder="输入货号或货名搜索"
          filterOption={false}
          onSearch={searchProducts}
          options={productOptions}
          allowClear
        />
      </Form.Item>
      <Form.Item name="total_qty" label="订单数量"
        rules={[{ required: true, message: '请输入订单数量' }]}>
        <InputNumber min={1} style={{ width: '100%' }} placeholder="件数" />
      </Form.Item>
      <Form.Item name="start_date" label="起始日期"
        rules={[{ required: true, message: '请选择起始日期' }]}>
        <DatePicker style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="remarks" label="备注">
        <Input.TextArea rows={3} placeholder="备注" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" onClick={onCreate}>保存订单</Button>
      </Form.Item>
    </Form>
  );

  const expandedRowRender = (order) => {
    const slList = detailMap[order.id] || [];
    const columns = [
      { title: '部位', dataIndex: 'part_name', width: 110 },
      {
        title: '件数', dataIndex: 'qty', width: 100, align: 'right',
        render: (v, row) => (
          <NumCell value={v} min={0}
            onSave={nv => onUpdateSL(order.id, row.id, { qty: nv })} />
        ),
      },
      {
        title: '累计数', dataIndex: 'produced_total', width: 90, align: 'right',
        render: v => <span style={{ color: '#1677ff' }}>{Number(v || 0)}</span>,
      },
      {
        title: '欠数', width: 90, align: 'right',
        render: (_, row) => {
          const owed = Number(row.qty || 0) - Number(row.produced_total || 0);
          if (owed <= 0) return <span style={{ color: '#52c41a' }}>已完</span>;
          return <span style={{ color: '#cf1322' }}>{owed}</span>;
        },
      },
      {
        title: '日产能', dataIndex: 'daily_capacity', width: 100, align: 'right',
        render: (v, row) => (
          <NumCell value={v}
            onSave={nv => onUpdateSL(order.id, row.id, { daily_capacity: nv })} />
        ),
      },
      {
        title: '实际产能', dataIndex: 'actual_capacity', width: 100, align: 'right',
        render: (v, row) => (
          <NumCell value={v ?? row.daily_capacity}
            onSave={nv => onUpdateSL(order.id, row.id, { actual_capacity: nv })} />
        ),
      },
      { title: '预计天数', dataIndex: 'est_days', width: 80, align: 'right' },
      {
        title: '起-止日', width: 180,
        render: (_, row) => <span>{row.start_date} ~ {row.end_date}</span>,
      },
      {
        title: '分到拉', width: 140,
        render: (_, row) => (
          <Select
            size="small"
            style={{ width: 120 }}
            placeholder={row.technique === '喷油' ? '喷油(手选)' : '选拉'}
            value={row.line_id || undefined}
            onChange={(v) => onUpdateSL(order.id, row.id, { line_id: v || null })}
            options={lineOptions}
            allowClear
          />
        ),
      },
      {
        title: '生产时间', width: 100,
        render: (_, row) => row.started_at
          ? <span style={{ color: '#1677ff' }}>{fmtTime(row.started_at)}</span>
          : <span style={{ color: '#ccc' }}>—</span>,
      },
      {
        title: '完成时间', width: 100,
        render: (_, row) => row.completed_at
          ? <span style={{ color: '#52c41a' }}>{fmtTime(row.completed_at)}</span>
          : <span style={{ color: '#ccc' }}>—</span>,
      },
      {
        title: '操作', width: 220,
        render: (_, row) => (
          <Space size={4}>
            <Button size="small" type="primary" icon={<PlayCircleOutlined />}
              disabled={!!row.started_at}
              onClick={() => onClock(order.id, row.id, 'start')}>开始</Button>
            <Button size="small" icon={<CheckCircleOutlined />}
              disabled={!row.started_at || !!row.completed_at}
              onClick={() => onClock(order.id, row.id, 'complete')}>完成</Button>
            {(row.started_at || row.completed_at) && (
              <Popconfirm title="重置开始/完成时间?"
                onConfirm={() => onClock(order.id, row.id, 'reset')}>
                <Button size="small" icon={<RedoOutlined />} />
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ];

    // 按工艺分组(喷油 / 移印 / UV / ...) — 用 normalize 把杂乱字段归一
    const groups = {};
    for (const sl of slList) {
      const t = normalizeTechnique(sl.technique);
      if (!groups[t]) groups[t] = [];
      groups[t].push(sl);
    }
    const techniqueOrder = Object.keys(groups).sort();
    const groupColors = { '喷油': '#fa8c16', '移印': '#1677ff', 'UV': '#722ed1', '散枪': '#13c2c2', '洗货': '#a0d911' };

    return (
      <div>
        {techniqueOrder.map(technique => {
          const lines = groups[technique];
          const done = lines.filter(l => l.completed_at).length;
          return (
            <div key={technique} style={{ marginBottom: 12 }}>
              <div style={{
                background: groupColors[technique] || '#595959',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '4px 4px 0 0',
                fontWeight: 600,
                fontSize: 14,
              }}>
                {technique} <span style={{ opacity: 0.85, fontSize: 12, marginLeft: 8 }}>
                  共 {lines.length} 道工序 · 已完成 {done}/{lines.length}
                </span>
              </div>
              <Table
                rowKey="id"
                size="small"
                dataSource={lines}
                columns={columns}
                pagination={false}
                scroll={{ x: 'max-content' }}
                style={{ borderTop: 0 }}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const listColumns = [
    { title: '订单名', dataIndex: 'order_name', width: 160 },
    {
      title: '货号 - 货名', width: 260,
      render: (_, row) => `${row.product_code} - ${row.product_name}`,
    },
    { title: '数量', dataIndex: 'total_qty', width: 90, align: 'right' },
    { title: '起始日', dataIndex: 'start_date', width: 110 },
    {
      title: '进度', width: 100, align: 'center',
      render: (_, row) => {
        const done = row.completed_count || 0;
        const total = row.line_count || 0;
        const color = total > 0 && done === total ? 'green' : 'blue';
        return <Tag color={color}>{done} / {total}</Tag>;
      },
    },
    {
      title: '产值', width: 110, align: 'right',
      render: (_, row) => (Number(row.total_qty || 0) * Number(row.quote_price || 0)).toFixed(2),
    },
    {
      title: '完成时间', width: 140,
      render: (_, row) => {
        const done = row.completed_count || 0;
        const total = row.line_count || 0;
        if (!total) return <span style={{ color: '#ccc' }}>—</span>;
        if (done === total && row.last_completed_at) {
          return <span style={{ color: '#52c41a' }}>{dayjs(row.last_completed_at).format('MM-DD HH:mm')}</span>;
        }
        return <span style={{ color: '#999' }}>未完工</span>;
      },
    },
    {
      title: '操作', width: 100,
      render: (_, row) => (
        <Popconfirm title="确认删除此订单?" onConfirm={() => onDeleteOrder(row.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const renderList = () => (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        月份:
        <DatePicker
          picker="month"
          value={month}
          onChange={setMonth}
          allowClear
        />
        <Input.Search
          placeholder="搜索订单名 / 货号 / 货名"
          style={{ width: 280 }}
          allowClear
          onSearch={v => setQ(v)}
          onChange={e => { if (!e.target.value) setQ(''); }}
        />
      </Space>

      <Card style={{ marginBottom: 16, background: '#fffbe6' }}>
        <Space size="large">
          <span><b>当月订单数:</b> {list.length}</span>
          <span>
            <b>当月总产值:</b>{' '}
            <span style={{ fontSize: 20, color: '#d4380d' }}>
              {monthlyOutput.toFixed(2)}
            </span>
          </span>
        </Space>
      </Card>

      <Table
        rowKey="id"
        size="middle"
        dataSource={list}
        columns={listColumns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowRender,
          onExpand: (expanded, record) => {
            if (expanded) loadDetail(record.id);
          },
        }}
      />
    </div>
  );

  return (
    <div>
      <Space style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <h2 style={{ margin: 0 }}>订单排产</h2>
        <Upload accept=".pdf" beforeUpload={onPdfUpload} showUploadList={false}>
          <Button icon={<FilePdfOutlined />} type="primary" ghost>从 PDF 导入订单</Button>
        </Upload>
      </Space>
      {renderList()}

      <Modal
        open={pdfModalOpen}
        title="PDF 订单导入预览"
        onCancel={() => { setPdfModalOpen(false); setPdfPreview(null); }}
        onOk={onPdfConfirm}
        okText="确认导入"
        cancelText="取消"
        okButtonProps={{ disabled: !pdfPreview || !pdfPreview.matched }}
        width={900}
        confirmLoading={pdfLoading}
      >
        {pdfLoading && <div style={{ textAlign: 'center', padding: 30 }}>解析中...</div>}
        {pdfPreview && (
          <div>
            <div style={{ marginBottom: 12, color: '#666' }}>
              订单号 <b>{pdfPreview.header?.order_no || '-'}</b> ·
              日期 <b>{pdfPreview.header?.order_date || '-'}</b> ·
              交货 <b>{pdfPreview.header?.due_date || '-'}</b> ·
              工序 <b>{pdfPreview.header?.technique_label || '-'}</b>
            </div>
            <div style={{ marginBottom: 12 }}>
              款号:<b style={{ marginLeft: 6 }}>{pdfPreview.code}</b>
              {pdfPreview.product && (
                <span style={{ marginLeft: 12, color: '#52c41a' }}>
                  ✓ 匹配核价表 · {pdfPreview.product.code} - {pdfPreview.product.name}
                </span>
              )}
            </div>
            {!pdfPreview.matched && (
              <Alert type="error" showIcon message={pdfPreview.error || '未匹配核价表'}
                style={{ marginBottom: 12 }} />
            )}
            <Table
              rowKey={r => r.pdf_part_name + '|' + r.pdf_qty}
              size="small"
              pagination={false}
              dataSource={pdfPreview.items}
              columns={[
                { title: 'PDF 部位', dataIndex: 'pdf_part_name', width: 140 },
                { title: '数量', width: 110, render: (_, r, i) => (
                  <AntInputNumber size="small" min={0} value={r.edit_qty}
                    onChange={v => {
                      const next = [...pdfPreview.items];
                      next[i] = { ...next[i], edit_qty: v };
                      setPdfPreview({ ...pdfPreview, items: next });
                    }} />
                )},
                { title: '匹配工序', render: (_, r, i) => {
                  if (!pdfPreview.matched) return <span style={{ color: '#999' }}>—</span>;
                  if (!r.matched_processes?.length) {
                    return <Tag color="warning">未匹配,跳过</Tag>;
                  }
                  return (
                    <Space wrap>
                      {r.matched_processes.map(pp => {
                        const checked = (r.selected_process_ids || []).includes(pp.id);
                        return (
                          <Tag.CheckableTag key={pp.id} checked={checked}
                            onChange={c => {
                              const next = [...pdfPreview.items];
                              const cur = next[i].selected_process_ids || [];
                              next[i] = {
                                ...next[i],
                                selected_process_ids: c
                                  ? [...cur, pp.id]
                                  : cur.filter(x => x !== pp.id),
                              };
                              setPdfPreview({ ...pdfPreview, items: next });
                            }}>
                            {pp.part_name}·{pp.technique}
                          </Tag.CheckableTag>
                        );
                      })}
                    </Space>
                  );
                }},
              ]}
            />
            <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              提示:点击工序标签切换是否导入。同部位多工艺(如喷油+移印)默认都勾上,数量相同。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
