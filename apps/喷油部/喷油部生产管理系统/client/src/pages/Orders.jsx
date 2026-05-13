import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Tabs, Form, Input, InputNumber, DatePicker, Button, Select, Table,
  Space, Tag, message, Popconfirm, Upload, Modal, Alert, InputNumber as AntInputNumber,
} from 'antd';
import {
  PlayCircleOutlined, CheckCircleOutlined, RedoOutlined, DeleteOutlined, FilePdfOutlined, HolderOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

// dnd-kit 用的可拖拽 antd Table 行;data-row-key 由 antd 自动塞进 props
function SortableRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props['data-row-key'] });
  const style = {
    ...props.style,
    transform: CSS.Transform.toString(transform && { ...transform, scaleY: 1 }),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9, background: '#e6f4ff' } : {}),
  };
  // listeners/attributes 通过 context 给 DragHandle 用
  return (
    <SortableRowContext.Provider value={{ attributes, listeners }}>
      <tr {...props} ref={setNodeRef} style={style} />
    </SortableRowContext.Provider>
  );
}

const SortableRowContext = React.createContext({ attributes: {}, listeners: {} });

function DragHandle() {
  const { attributes, listeners } = React.useContext(SortableRowContext);
  return (
    <HolderOutlined
      {...attributes} {...listeners}
      style={{ cursor: 'grab', color: '#999', fontSize: 14, padding: 4 }}
    />
  );
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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('flat');
  const [productOptions, setProductOptions] = useState([]);
  const [lines, setLines] = useState([]);
  const [flat, setFlat] = useState([]); // 平铺的 schedule_lines
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
    const { data } = await api.get('/orders/schedule-lines/flat', {
      params: { month: monthStr || undefined, q: q || undefined },
    });
    setFlat(data);
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
    loadList();
  };

  const onClock = async (oid, slId, action) => {
    await api.post(`/orders/${oid}/schedule-lines/${slId}/${action}`);
    loadList();
  };

  const onReorder = async (ids) => {
    await api.put('/orders/schedule-lines/reorder', { ids });
    // 乐观更新已经在前端先做了,这里不需要再 loadList(避免抖动)
  };

  // PDF / 图片 导入预览(根据文件类型分流,后端不同路由,前端预览 Modal 共用)
  const onPdfUpload = async (file) => {
    const isImage = (file.type && file.type.startsWith('image/')) ||
      /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(file.name || '');
    const endpoint = isImage ? '/orders/import-image' : '/orders/import-pdf';
    const errLabel = isImage ? '图片识别' : 'PDF 解析';
    setPdfLoading(true);
    setPdfPreview(null);
    setPdfModalOpen(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(endpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const items = (data.items || []).map(it => ({
        ...it,
        selected_process_ids: (it.matched_processes || []).map(p => p.id),
        edit_qty: it.pdf_qty,
      }));
      const initDate = data.header?.order_date
        ? dayjs(data.header.order_date)
        : dayjs();
      setPdfPreview({ ...data, items, start_date: initDate, source: isImage ? 'image' : 'pdf' });
    } catch (e) {
      message.error(`${errLabel}失败: ` + (e.response?.data?.error || e.message));
      setPdfModalOpen(false);
    } finally {
      setPdfLoading(false);
    }
    return false; // 阻止 antd Upload 自动上传
  };

  const onPdfConfirm = async () => {
    if (!pdfPreview || !pdfPreview.matched) return;
    // 三条路径:
    //  1) 自动 / alias 命中的 matched_processes — 直接用 selected_process_ids,不重复学
    //  2) 没命中但用户从「全工序下拉」勾了 — picked_process_ids,learn_alias=true 写映射
    //  3) 没命中且填了 工艺+工价 — new_process 新建到核价表,learn_alias=true 把 PDF 名→新工序也记下
    const items = [];
    let newProcCount = 0;
    let learnCount = 0;
    for (const it of pdfPreview.items) {
      const qty = Number(it.edit_qty) || 0;
      const pdf_part_name = it.pdf_part_name;
      if (it.matched_processes && it.matched_processes.length) {
        for (const ppid of (it.selected_process_ids || [])) {
          items.push({ product_process_id: ppid, qty });
        }
        continue;
      }
      // 未匹配 — 看手动挑的
      const picked = it.picked_process_ids || [];
      for (const ppid of picked) {
        items.push({ product_process_id: ppid, qty, pdf_part_name, learn_alias: true });
        learnCount++;
      }
      // 未匹配 — 看新建表单
      const np = it.new_process;
      if (np && np.part_name && np.technique && np.unit_wage != null && np.unit_wage !== '') {
        items.push({
          new_process: {
            part_name: String(np.part_name).trim(),
            technique: String(np.technique).trim(),
            unit_wage: Number(np.unit_wage) || 0,
            target_qty: Number(np.target_qty) || 0,
          },
          qty,
          pdf_part_name,
          learn_alias: true,
        });
        newProcCount++;
        learnCount++;
      }
    }
    if (!items.length) {
      message.warning('没有可导入的工序');
      return;
    }
    try {
      const startDate = pdfPreview.start_date
        ? pdfPreview.start_date.format('YYYY-MM-DD')
        : (pdfPreview.header.order_date || dayjs().format('YYYY-MM-DD'));
      const payload = {
        product_id: pdfPreview.product.id,
        order_name: pdfPreview.header.order_no || `PDF-${dayjs().format('YYYYMMDDHHmm')}`,
        start_date: startDate,
        items,
      };
      const { data } = await api.post('/orders/import-pdf/confirm', payload);
      const parts = [`${items.length} 条工序`];
      if (newProcCount) parts.push(`新建核价表 ${newProcCount} 条`);
      if (data.learned_aliases) parts.push(`记住映射 ${data.learned_aliases} 条`);
      message.success(`已创建订单,${parts.join(',')}`);
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

  // 按订单去重算产值,避免一单多工序被乘很多次
  const monthlyOutput = useMemo(() => {
    const byOrder = new Map();
    for (const r of flat) {
      if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, { qty: r.qty, price: r.quote_price });
      else {
        const cur = byOrder.get(r.order_id);
        if (Number(r.qty) > Number(cur.qty)) cur.qty = r.qty;
      }
    }
    let sum = 0;
    for (const v of byOrder.values()) sum += Number(v.qty || 0) * Number(v.price || 0);
    return sum;
  }, [flat]);

  const flatStats = useMemo(() => {
    let pending = 0, started = 0, done = 0, noLine = 0;
    for (const r of flat) {
      if (r.completed_at) done++;
      else if (r.started_at) started++;
      else pending++;
      if (!r.line_id) noLine++;
    }
    return { total: flat.length, pending, started, done, noLine };
  }, [flat]);

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

  const flatColumns = [
    {
      title: '', key: 'drag', width: 32,
      render: (_, row) => <DragHandle id={row.id} />,
    },
    { title: '订单', dataIndex: 'order_name', width: 130, fixed: 'left' },
    {
      title: '货号 - 货名', width: 220, fixed: 'left',
      render: (_, row) => (
        <span>
          <b>{row.product_code}</b>
          <span style={{ color: '#666', marginLeft: 4 }}>{row.product_name}</span>
        </span>
      ),
    },
    { title: '部位', dataIndex: 'part_name', width: 130 },
    {
      title: '工艺', dataIndex: 'technique', width: 90,
      render: v => {
        const t = normalizeTechnique(v);
        const colors = { '喷油': '#fa8c16', '移印': '#1677ff', 'UV': '#722ed1', '散枪': '#13c2c2', '洗货': '#a0d911' };
        return <Tag color={colors[t] || 'default'}>{v || '-'}</Tag>;
      },
    },
    {
      title: '分到拉', width: 130,
      render: (_, row) => (
        <Select size="small" style={{ width: 110 }}
          placeholder={!row.line_id ? '⚠ 选拉' : '选拉'}
          value={row.line_id || undefined}
          onChange={v => onUpdateSL(row.order_id, row.id, { line_id: v || null })}
          options={lineOptions}
          allowClear
          status={!row.line_id ? 'warning' : undefined}
        />
      ),
    },
    {
      title: '数量', dataIndex: 'qty', width: 90, align: 'right',
      render: (v, row) => (
        <NumCell value={v} min={0}
          onSave={nv => onUpdateSL(row.order_id, row.id, { qty: nv })} />
      ),
    },
    {
      title: '累计', dataIndex: 'produced_total', width: 70, align: 'right',
      render: v => <span style={{ color: '#1677ff' }}>{Number(v || 0)}</span>,
    },
    {
      title: '欠数', width: 70, align: 'right',
      render: (_, row) => {
        const owed = Number(row.qty || 0) - Number(row.produced_total || 0);
        if (owed <= 0) return <span style={{ color: '#52c41a' }}>已完</span>;
        return <span style={{ color: '#cf1322' }}>{owed}</span>;
      },
    },
    {
      title: '日产能', dataIndex: 'daily_capacity', width: 90, align: 'right',
      render: (v, row) => (
        <NumCell value={v}
          onSave={nv => onUpdateSL(row.order_id, row.id, { daily_capacity: nv })} />
      ),
    },
    {
      title: '起-止', width: 170,
      render: (_, row) => <span style={{ fontSize: 12 }}>{row.start_date} ~ {row.end_date}</span>,
    },
    {
      title: '状态', width: 90,
      render: (_, row) => {
        if (row.completed_at) return <Tag color="success">完成 {fmtTime(row.completed_at)}</Tag>;
        if (row.started_at) return <Tag color="processing">生产中</Tag>;
        return <Tag>未开始</Tag>;
      },
    },
    {
      title: '操作', width: 200, fixed: 'right',
      render: (_, row) => (
        <Space size={2}>
          {!row.started_at && (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />}
              onClick={async () => {
                await onClock(row.order_id, row.id, 'start');
                navigate('/daily-records');
              }}>排单</Button>
          )}
          {row.started_at && !row.completed_at && (
            <Button size="small" icon={<CheckCircleOutlined />}
              onClick={() => onClock(row.order_id, row.id, 'complete')}>完成</Button>
          )}
          {(row.started_at || row.completed_at) && (
            <Popconfirm title="重置开始/完成时间?"
              onConfirm={() => onClock(row.order_id, row.id, 'reset')}>
              <Button size="small" icon={<RedoOutlined />} />
            </Popconfirm>
          )}
          <Popconfirm title={`删除整个订单 ${row.order_name}?该单全部工序一并删除`}
            onConfirm={() => onDeleteOrder(row.order_id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = flat.findIndex(r => r.id === active.id);
    const newIndex = flat.findIndex(r => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(flat, oldIndex, newIndex);
    setFlat(next); // 乐观更新
    onReorder(next.map(r => r.id)).catch(e => {
      message.error('保存顺序失败,刷新重试');
      loadList();
    });
  };

  const renderFlat = () => (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        月份:
        <DatePicker picker="month" value={month} onChange={setMonth} allowClear />
        <Input.Search placeholder="搜索订单/货号/货名/部位" style={{ width: 280 }} allowClear
          onSearch={v => setQ(v)}
          onChange={e => { if (!e.target.value) setQ(''); }} />
      </Space>

      <div style={{
        marginBottom: 12, padding: '8px 14px', background: '#fafafa',
        border: '1px solid #f0f0f0', borderRadius: 4, display: 'flex', gap: 16, flexWrap: 'wrap',
      }}>
        <span>共 <b>{flatStats.total}</b> 件</span>
        <span style={{ color: '#faad14' }}>待排拉 <b>{flatStats.noLine}</b></span>
        <span>未开始 <b>{flatStats.pending}</b></span>
        <span style={{ color: '#1677ff' }}>生产中 <b>{flatStats.started}</b></span>
        <span style={{ color: '#52c41a' }}>已完成 <b>{flatStats.done}</b></span>
        <span style={{ marginLeft: 'auto', color: '#d4380d' }}>当月产值 <b>¥{monthlyOutput.toFixed(2)}</b></span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={flat.map(r => r.id)} strategy={verticalListSortingStrategy}>
          <Table
            rowKey="id"
            size="small"
            dataSource={flat}
            columns={flatColumns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            components={{ body: { row: SortableRow } }}
            locale={{ emptyText: '本月还没有件 — 点右上「导入订单」或「新建订单」' }}
          />
        </SortableContext>
      </DndContext>
    </div>
  );

  return (
    <div>
      <Space style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <h2 style={{ margin: 0 }}>订单排产</h2>
        <Upload accept=".pdf,image/*" beforeUpload={onPdfUpload} showUploadList={false}>
          <Button icon={<FilePdfOutlined />} type="primary" ghost>导入订单(PDF / 图片)</Button>
        </Upload>
      </Space>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'flat', label: '所有件(可拖拽手动排)', children: renderFlat() },
          { key: 'new', label: '新建订单', children: renderCreateForm() },
        ]}
      />

      <Modal
        open={pdfModalOpen}
        title={pdfPreview?.source === 'image' ? '图片订单识别预览(AI)' : 'PDF 订单导入预览'}
        onCancel={() => { setPdfModalOpen(false); setPdfPreview(null); }}
        onOk={onPdfConfirm}
        okText="确认导入"
        cancelText="取消"
        okButtonProps={{ disabled: !pdfPreview || !pdfPreview.matched }}
        width={900}
        confirmLoading={pdfLoading}
      >
        {pdfLoading && (
          <div style={{ textAlign: 'center', padding: 30, color: '#888' }}>
            正在识别...(图片走 AI 通常 5-15 秒)
          </div>
        )}
        {pdfPreview && (
          <div>
            <div style={{ marginBottom: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>订单号 <b>{pdfPreview.header?.order_no || '-'}</b></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                排产起始日:
                <DatePicker size="small" allowClear={false}
                  value={pdfPreview.start_date}
                  onChange={d => setPdfPreview({ ...pdfPreview, start_date: d || dayjs() })} />
                {pdfPreview.header?.order_date && (
                  <span style={{ fontSize: 11, color: '#999' }}>
                    (PDF 写 {pdfPreview.header.order_date})
                  </span>
                )}
              </span>
              <span>交货 <b>{pdfPreview.header?.due_date || '-'}</b></span>
              <span>工序 <b>{pdfPreview.header?.technique_label || '-'}</b></span>
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
                    const np = r.new_process || {};
                    const updateNP = (patch) => {
                      const next = [...pdfPreview.items];
                      next[i] = { ...next[i], new_process: { ...(next[i].new_process || {}), ...patch } };
                      setPdfPreview({ ...pdfPreview, items: next });
                    };
                    const updatePicked = (ids) => {
                      const next = [...pdfPreview.items];
                      next[i] = { ...next[i], picked_process_ids: ids };
                      setPdfPreview({ ...pdfPreview, items: next });
                    };
                    const ready = np.part_name && np.technique && np.unit_wage != null && np.unit_wage !== '';
                    const ppOptions = (pdfPreview.all_processes || []).map(pp => ({
                      value: pp.id,
                      label: `${pp.part_name}·${pp.technique}`,
                    }));
                    const pickedCount = (r.picked_process_ids || []).length;
                    return (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Select mode="multiple" size="small" allowClear
                          placeholder="从核价表挑对应工序(可多选,首次需手动绑定)"
                          value={r.picked_process_ids || []}
                          style={{ width: '100%', minWidth: 360 }}
                          options={ppOptions}
                          filterOption={(input, opt) =>
                            String(opt?.label || '').toLowerCase().includes(input.toLowerCase())
                          }
                          onChange={updatePicked} />
                        <details style={{ fontSize: 12 }}>
                          <summary style={{ cursor: 'pointer', color: '#888' }}>核价表没有?手动新建一条</summary>
                          <Space size={4} wrap style={{ marginTop: 4 }}>
                            <Input size="small" placeholder="部位名"
                              value={np.part_name ?? r.pdf_part_name}
                              style={{ width: 130 }}
                              onChange={e => updateNP({ part_name: e.target.value })} />
                            <Select size="small" placeholder="工艺"
                              value={np.technique}
                              style={{ width: 90 }}
                              options={['喷油','移印','UV','散枪','洗货'].map(v => ({ value: v, label: v }))}
                              onChange={v => updateNP({ technique: v })} />
                            <AntInputNumber size="small" placeholder="工价" min={0} step={0.01}
                              value={np.unit_wage} style={{ width: 80 }}
                              onChange={v => updateNP({ unit_wage: v })} />
                            <AntInputNumber size="small" placeholder="目标数" min={0}
                              value={np.target_qty} style={{ width: 80 }}
                              onChange={v => updateNP({ target_qty: v })} />
                          </Space>
                        </details>
                        <span style={{ fontSize: 12, color: (pickedCount || ready) ? '#52c41a' : '#faad14' }}>
                          {pickedCount
                            ? `✓ 已选 ${pickedCount} 个工序,确认后将记住:"${r.pdf_part_name}" → 这 ${pickedCount} 条`
                            : ready
                              ? `✓ 将新建到核价表并记住:"${r.pdf_part_name}" → 新工序`
                              : '未匹配 · 从下拉选(推荐)或手动新建'}
                        </span>
                      </Space>
                    );
                  }
                  return (
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      {r.from_alias && (
                        <span style={{ fontSize: 11, color: '#1677ff' }}>已记住的映射 ✓</span>
                      )}
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
                    </Space>
                  );
                }},
              ]}
            />
            <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              提示:首次导某个 PDF 部位若没自动命中,从下拉选对应的核价表工序(可多选);确认后系统会记住,下次同款 PDF 自动套用。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
