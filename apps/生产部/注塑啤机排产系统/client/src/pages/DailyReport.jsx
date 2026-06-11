import { useState, useEffect, useMemo } from 'react';
import { Card, Space, Button, DatePicker, Table, Tag, Input, InputNumber, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const API = '/api/scheduling';
const EXPORT_API = '/api/export';

const getMachineNum = (mno) => { const m = String(mno).match(/(\d+)/); return m ? parseInt(m[1]) : 99; };

export default function DailyReport({ workshop = 'B' }) {
  const [date, setDate] = useState(dayjs());
  const [blocks, setBlocks] = useState([]);          // [{ schedule, items }, ...]
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(null);            // { id, field }
  const [editVal, setEditVal] = useState('');

  const fetchData = async (d) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/daily-report`, {
        params: { date: d.format('YYYY-MM-DD'), workshop },
      });
      setBlocks(data || []);
    } catch (e) {
      message.error('获取日报失败');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(date); }, [date, workshop]);

  const startEdit = (record, field) => {
    setEdit({ id: record.id, field });
    setEditVal(record[field] ?? '');
  };

  const saveEdit = async (record) => {
    if (!edit) return;
    const field = edit.field;
    const numericFields = ['piece_rate','approved_piece_rate','output_value','actual_hours','piece_wage','hour_wage','day_regular_wage','ot_wage_12h','encouragement','supper_fee','overtime_wage','total_wage'];
    let value = editVal;
    if (numericFields.includes(field)) value = (value === '' || value == null) ? null : parseFloat(value);
    if (value === record[field]) { setEdit(null); return; }
    try {
      await axios.put(`${API}/${record.schedule_id}/items/${record.id}`, { [field]: value });
      setEdit(null);
      fetchData(date);
    } catch (e) {
      message.error('保存失败：' + (e.response?.data?.message || e.message));
    }
  };

  const renderEditable = (field, record, value, opt = {}) => {
    const editing = edit && edit.id === record.id && edit.field === field;
    if (editing) {
      const Cmp = opt.number ? InputNumber : Input;
      return (
        <Cmp
          size="small"
          autoFocus
          value={editVal}
          onChange={v => setEditVal(opt.number ? v : v.target.value)}
          onPressEnter={() => saveEdit(record)}
          onBlur={() => saveEdit(record)}
          style={{ width: '100%' }}
        />
      );
    }
    return (
      <span style={{ cursor: 'pointer', display: 'inline-block', width: '100%', minHeight: 18 }}
            onClick={() => startEdit(record, field)} title="点击编辑">
        {(value == null || value === '') ? <span style={{ color: '#ccc' }}>-</span> : value}
      </span>
    );
  };

  const renderReadOnly = (v) => (v == null || v === '' ? <span style={{ color: '#ccc' }}>-</span> : v);

  const calc = (it) => {
    const t24 = it.target_24h || 0;
    const t11 = it.target_11h || (t24 ? Math.round(t24 / 24 * 11) : 0);
    const t12 = t24 ? Math.round(t24 / 2) : 0;
    const acc = it.accumulated || 0;
    return { t24, t11, t12, acc, over: acc - t11 };
  };

  const columns = [
    { title: '机号', dataIndex: 'machine_no', width: 55, fixed: 'left',
      render: v => v && <Tag color="blue" style={{ margin: 0 }}>{v}</Tag> },
    { title: '机安', width: 50, render: () => null /* 机安数（吨位）系统不展示，导出时算 */ },
    { title: '啤工', width: 80, render: (_, r) => renderEditable('worker_name', r, r.worker_name) },
    { title: '货号', dataIndex: 'product_code', width: 90, render: renderReadOnly },
    { title: '产品名称', dataIndex: 'mold_name', width: 180, render: renderReadOnly },
    { title: '需啤', dataIndex: 'quantity_needed', width: 70, align: 'right', render: renderReadOnly },
    { title: '颜色', dataIndex: 'color', width: 100, render: renderReadOnly,
      onCell: () => ({ style: { wordBreak: 'break-all', whiteSpace: 'normal' } }) },
    { title: '用料', dataIndex: 'material_type', width: 100, render: renderReadOnly },
    { title: '24H', width: 55, align: 'right', render: (_, r) => renderReadOnly(calc(r).t24 || null) },
    { title: '12H', width: 55, align: 'right', render: (_, r) => renderReadOnly(calc(r).t12 || null) },
    { title: '11H', width: 55, align: 'right', render: (_, r) => renderReadOnly(calc(r).t11 || null) },
    { title: '工价', width: 65, render: (_, r) => renderEditable('piece_rate', r, r.piece_rate, { number: true }) },
    { title: '实际啤数', dataIndex: 'accumulated', width: 70, align: 'right', render: renderReadOnly },
    { title: '超欠', width: 60, align: 'right',
      render: (_, r) => { const o = calc(r).over; return <span style={{ color: o>=0?'#16a34a':'#dc2626' }}>{o>0?'+':''}{o}</span>; } },
    { title: '核价工价', width: 70, render: (_, r) => renderEditable('approved_piece_rate', r, r.approved_piece_rate, { number: true }) },
    { title: '产值', width: 70, render: (_, r) => renderEditable('output_value', r, r.output_value, { number: true }) },
    { title: '应啤h', width: 50, align: 'right', render: () => 12 },
    { title: '实际h', width: 50, align: 'right', render: (_, r) => renderEditable('actual_hours', r, r.actual_hours, { number: true }) },
    { title: '啤货工资', width: 75, render: (_, r) => renderEditable('piece_wage', r, r.piece_wage, { number: true }) },
    { title: '计时工资', width: 75, render: (_, r) => renderEditable('hour_wage', r, r.hour_wage, { number: true }) },
    { title: '正班', width: 70, render: (_, r) => renderEditable('day_regular_wage', r, r.day_regular_wage, { number: true }) },
    { title: '12h外加班', width: 80, render: (_, r) => renderEditable('ot_wage_12h', r, r.ot_wage_12h, { number: true }) },
    { title: '鼓励奖', width: 60, render: (_, r) => renderEditable('encouragement', r, r.encouragement, { number: true }) },
    { title: '夜宵费', width: 60, render: (_, r) => renderEditable('supper_fee', r, r.supper_fee, { number: true }) },
    { title: '加班', width: 60, render: (_, r) => renderEditable('overtime_wage', r, r.overtime_wage, { number: true }) },
    { title: '合计工资', width: 80, render: (_, r) => renderEditable('total_wage', r, r.total_wage, { number: true }) },
    { title: '停机原因', width: 120, render: (_, r) => renderEditable('downtime_reason', r, r.downtime_reason) },
    { title: '啤办', width: 80, render: (_, r) => renderEditable('pi_ban', r, r.pi_ban) },
  ];

  const handleExport = async () => {
    try {
      const res = await axios.get(`${EXPORT_API}/daily-report/${date.format('YYYY-MM-DD')}`, {
        params: { workshop }, responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `${workshop}车间日报表_${date.format('YYYY-MM-DD')}.xlsx`; a.click();
      window.URL.revokeObjectURL(url);
      message.success('日报表已导出');
    } catch (e) { message.error('导出失败：' + (e.response?.data?.message || e.message)); }
  };

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space>
          <span>日期：</span>
          <DatePicker value={date} onChange={d => d && setDate(d)} />
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport} disabled={blocks.length === 0}>
            导出 Excel
          </Button>
          <span style={{ color: '#999' }}>
            {blocks.length === 0 ? '当天无排单' : blocks.map(b => `${b.schedule.shift} ${b.items.length}条`).join(' · ')}
          </span>
        </Space>
      </Card>

      {blocks.map(b => (
        <Card key={b.schedule.id} size="small" style={{ marginBottom: 12 }}
              title={<span>
                {date.format('M月D日')} · <b>{b.schedule.shift}</b>
                <span style={{ marginLeft: 12, color: '#999', fontSize: 12 }}>
                  共 {b.items.length} 台机 · {b.schedule.notes || ''}
                </span>
              </span>}>
          <Table
            columns={columns}
            dataSource={b.items}
            rowKey="id"
            loading={loading}
            size="small"
            pagination={false}
            scroll={{ x: 2200, y: 600 }}
          />
        </Card>
      ))}
    </div>
  );
}
