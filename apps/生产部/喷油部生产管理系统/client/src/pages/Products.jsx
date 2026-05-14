import { useEffect, useState } from 'react';
import {
  Button,
  Input,
  Table,
  Modal,
  Form,
  InputNumber,
  Space,
  Upload,
  message,
  Popconfirm,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  UploadOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import api from '../api';

const CALC_RATIO = 2.1;
const PAINT_RATIO = 0.35;

function previewPrices(unit_wage) {
  const u = Number(unit_wage) || 0;
  const calc = u * CALC_RATIO;
  const paint = calc * PAINT_RATIO;
  return { calc, paint, total: calc + paint };
}

export default function Products() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailMap, setDetailMap] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [wageStandards, setWageStandards] = useState([]);
  const [form] = Form.useForm();

  useEffect(() => {
    api.get('/wage-standards').then(r => setWageStandards(r.data)).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products', { params: { q } });
      setList(data);
    } catch (e) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadDetail = async (id) => {
    if (detailMap[id]) return;
    const { data } = await api.get(`/products/${id}`);
    setDetailMap(prev => ({ ...prev, [id]: data.processes }));
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ processes: [{}] });
    setModalOpen(true);
  };

  const openEdit = async (row) => {
    const { data } = await api.get(`/products/${row.id}`);
    setEditing(data);
    form.setFieldsValue({
      code: data.code,
      name: data.name,
      quote_price: data.quote_price,
      remarks: data.remarks,
      processes: data.processes.map(p => ({
        part_name: p.part_name,
        technique: p.technique,
        target_qty: p.target_qty,
        worker_count: p.worker_count,
        unit_wage: p.unit_wage,
        remarks: p.remarks,
      })),
    });
    setModalOpen(true);
  };

  const onSave = async () => {
    const vals = await form.validateFields();
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, vals);
        message.success('已更新');
      } else {
        await api.post('/products', vals);
        message.success('已新建');
      }
      setModalOpen(false);
      setDetailMap({});
      load();
    } catch (e) {
      message.error('保存失败: ' + e.message);
    }
  };

  const onDelete = async (id) => {
    await api.delete(`/products/${id}`);
    message.success('已删除');
    load();
  };

  const onImport = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/products/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const skipped = data.skippedCodes || [];
      if (skipped.length) {
        message.warning(`新导入 ${data.imported} 个,跳过已存在的 ${skipped.length} 个: ${skipped.join(', ')}`, 8);
      } else {
        message.success(`导入成功,共 ${data.imported} 个产品`);
      }
      setDetailMap({});
      load();
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message));
    }
    return false;
  };

  const expandedRowRender = (row) => {
    const procs = detailMap[row.id];
    if (!procs) return <div style={{ color: '#999' }}>加载中…</div>;
    return (
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={procs}
        columns={[
          { title: '部位', dataIndex: 'part_name', width: 120 },
          { title: '工艺', dataIndex: 'technique', width: 80 },
          { title: '目标数', dataIndex: 'target_qty', width: 80, align: 'right' },
          { title: '人数', dataIndex: 'worker_count', width: 60, align: 'right' },
          { title: '工价', dataIndex: 'unit_wage', width: 100, align: 'right',
            render: v => Number(v).toFixed(4) },
          { title: '核价', dataIndex: 'calc_price', width: 100, align: 'right',
            render: v => Number(v).toFixed(4) },
          { title: '油漆价', dataIndex: 'paint_price', width: 100, align: 'right',
            render: v => Number(v).toFixed(4) },
          { title: '总核价', dataIndex: 'total_price', width: 100, align: 'right',
            render: v => <b>{Number(v).toFixed(4)}</b> },
          { title: '备注', dataIndex: 'remarks' },
        ]}
      />
    );
  };

  const columns = [
    { title: '货号', dataIndex: 'code', width: 120 },
    { title: '货名', dataIndex: 'name' },
    { title: '客户报价', dataIndex: 'quote_price', width: 120, align: 'right',
      render: v => Number(v).toFixed(2) },
    { title: '工序数', dataIndex: 'process_count', width: 100, align: 'center',
      render: v => <Tag color="blue">{v}</Tag> },
    { title: '备注', dataIndex: 'remarks', width: 200 },
    {
      title: '操作',
      width: 180,
      render: (_, row) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title="确定删除此产品?" onConfirm={() => onDelete(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>核价表管理</h2>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索货号 / 货名"
          value={q}
          onChange={e => setQ(e.target.value)}
          onPressEnter={load}
          prefix={<SearchOutlined />}
          allowClear
          style={{ width: 240 }}
        />
        <Button onClick={load}>查询</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button>
        <Upload beforeUpload={onImport} showUploadList={false}
          accept=".xlsx,.xls">
          <Button icon={<UploadOutlined />}>导入 Excel</Button>
        </Upload>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={list}
        columns={columns}
        pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowRender,
          onExpand: (expanded, row) => { if (expanded) loadDetail(row.id); },
        }}
      />

      <Modal
        open={modalOpen}
        title={editing ? `编辑产品 #${editing.id}` : '新建产品'}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        width={1000}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ processes: [{}] }}>
          <Space size="large" wrap>
            <Form.Item name="code" label="货号" rules={[{ required: true }]}>
              <Input style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="name" label="货名" rules={[{ required: true }]}>
              <Input style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="quote_price" label="客户报价">
              <InputNumber min={0} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="remarks" label="备注">
              <Input style={{ width: 240 }} />
            </Form.Item>
          </Space>

          <Form.List name="processes">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <b>工序清单</b>
                  <Button type="dashed" size="small" onClick={() => add({})} icon={<PlusOutlined />}>
                    添加工序
                  </Button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={th}>部位</th>
                      <th style={th}>工艺</th>
                      <th style={th}>目标数</th>
                      <th style={th}>人数</th>
                      <th style={th}>工价</th>
                      <th style={th}>核价(自动)</th>
                      <th style={th}>油漆价(自动)</th>
                      <th style={th}>总核价(自动)</th>
                      <th style={th}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(({ key, name, ...rest }) => (
                      <ProcessRow key={key} name={name} rest={rest} remove={() => remove(name)} form={form} wageStandards={wageStandards} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Form.List>
          <ProcessSummary form={form} />
        </Form>
      </Modal>
    </div>
  );
}

const th = { padding: '6px 8px', textAlign: 'left', fontSize: 12, borderBottom: '1px solid #eee' };
const td = { padding: '4px 6px', borderBottom: '1px solid #f5f5f5' };

function ProcessRow({ name, rest, remove, form, wageStandards }) {
  const wage = Form.useWatch(['processes', name, 'unit_wage'], form) || 0;
  const p = previewPrices(wage);

  const tryAutoFill = () => {
    const t = form.getFieldValue(['processes', name, 'technique']);
    const wc = form.getFieldValue(['processes', name, 'worker_count']);
    const cur = form.getFieldValue(['processes', name, 'unit_wage']);
    if (t && wc && (cur == null || cur === 0)) {
      const hit = (wageStandards || []).find(
        s => s.technique === String(t).trim() && s.worker_count === Number(wc)
      );
      if (hit) form.setFieldValue(['processes', name, 'unit_wage'], hit.unit_wage);
    }
  };

  return (
    <tr>
      <td style={td}>
        <Form.Item {...rest} name={[name, 'part_name']} rules={[{ required: true, message: '必填' }]} noStyle>
          <Input placeholder="耳朵" style={{ width: 100 }} />
        </Form.Item>
      </td>
      <td style={td}>
        <Form.Item {...rest} name={[name, 'technique']} noStyle>
          <Input placeholder="2印" style={{ width: 80 }} onBlur={tryAutoFill} />
        </Form.Item>
      </td>
      <td style={td}>
        <Form.Item {...rest} name={[name, 'target_qty']} noStyle>
          <InputNumber min={0} style={{ width: 90 }} />
        </Form.Item>
      </td>
      <td style={td}>
        <Form.Item {...rest} name={[name, 'worker_count']} noStyle>
          <InputNumber min={1} style={{ width: 70 }} onBlur={tryAutoFill} />
        </Form.Item>
      </td>
      <td style={td}>
        <Form.Item {...rest} name={[name, 'unit_wage']} noStyle>
          <InputNumber min={0} step={0.001} style={{ width: 100 }} />
        </Form.Item>
      </td>
      <td style={{ ...td, color: '#888' }}>{p.calc.toFixed(4)}</td>
      <td style={{ ...td, color: '#888' }}>{p.paint.toFixed(4)}</td>
      <td style={{ ...td, fontWeight: 600 }}>{p.total.toFixed(4)}</td>
      <td style={td}>
        <Button type="link" size="small" danger onClick={remove}>删除</Button>
      </td>
    </tr>
  );
}

function ProcessSummary({ form }) {
  const processes = Form.useWatch('processes', form) || [];
  let totalUnitWage = 0, totalCalc = 0, totalPaint = 0, totalFinal = 0;
  for (const p of processes) {
    if (!p) continue;
    const q = Number(p.target_qty) || 0;
    const w = Number(p.unit_wage) || 0;
    const calc = w * CALC_RATIO;
    const paint = calc * PAINT_RATIO;
    totalUnitWage += w * q;
    totalCalc += calc * q;
    totalPaint += paint * q;
    totalFinal += (calc + paint) * q;
  }
  const ratio = totalFinal > 0 ? (totalPaint / totalFinal) : 0;
  return (
    <div style={{ marginTop: 16, padding: '10px 14px', background: '#fafafa', borderRadius: 4, fontSize: 13 }}>
      <b>汇总:</b>
      <span style={{ marginLeft: 16 }}>总工价:<b>{totalUnitWage.toFixed(2)}</b></span>
      <span style={{ marginLeft: 16 }}>总核价:<b>{totalCalc.toFixed(2)}</b></span>
      <span style={{ marginLeft: 16 }}>总油漆价:<b>{totalPaint.toFixed(2)}</b></span>
      <span style={{ marginLeft: 16 }}>总核价合:<b>{totalFinal.toFixed(2)}</b></span>
      <span style={{ marginLeft: 16, color: '#cf1322' }}>
        油漆占比:<b>{(ratio * 100).toFixed(2)}%</b>
      </span>
    </div>
  );
}
