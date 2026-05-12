import { useEffect, useState, useRef, useCallback } from 'react';
import { DatePicker, Select, InputNumber, Input, Button, Space, Card, Table, Popconfirm, message, Tabs, Modal } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, RedoOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';

function fmtTime(s) { return s ? dayjs(s).format('MM-DD HH:mm') : ''; }

const TECHNIQUE_COLORS = { '喷油': '#fa8c16', '移印': '#1677ff', 'UV': '#722ed1', '散枪': '#13c2c2', '洗货': '#a0d911' };

// 把杂乱的工艺字段归一到主类:含「移印」→ 移印 / 含「喷油|手喷|自动机」→ 喷油 / 含「UV」→ UV / 含「散枪」→ 散枪 / 含「洗」→ 洗货
function normalizeTechnique(t) {
  if (!t) return '其它';
  const s = String(t);
  if (s.includes('UV')) return 'UV';
  if (s.includes('移印')) return '移印';
  if (s.includes('喷油') || s.includes('手喷') || s.includes('自动机')) return '喷油';
  if (s.includes('散枪')) return '散枪';
  if (s.includes('洗')) return '洗货';
  return s; // 实在认不出就保留原值
}

// 喷油 下再分手喷/自动:优先看分到哪条拉的拉名,其次看 technique 字段
function getSpraySubGroup(sl) {
  const ln = sl.line_name || '';
  const tech = sl.technique || '';
  if (ln.includes('手喷') || tech.includes('手喷')) return '手喷';
  if (ln.includes('自动') || tech.includes('自动')) return '自动';
  return '未分';
}
const SPRAY_SUB_COLORS = { '手喷': '#fa8c16', '自动': '#d46b08', '未分': '#bfbfbf' };

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
      onBlur={() => { if (v != null && v !== value) onSave(Number(v)); }}
    />
  );
}

export default function DailyRecords() {
  const [date, setDate] = useState(dayjs());
  const [active, setActive] = useState([]);  // schedule_lines for today (含 produced_total / actual_capacity / 等)
  const [records, setRecords] = useState([]); // daily_records for today
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState(''); // 搜索货号/货名
  const [tab, setTab] = useState('all'); // all / 喷油 / 移印 / UV / 散枪
  const debounceTimers = useRef({});
  const [historyModal, setHistoryModal] = useState(null); // { sl, rows }

  useEffect(() => { api.get('/lines').then(r => setLines(r.data)); }, []);

  const dateStr = date.format('YYYY-MM-DD');

  const load = useCallback(async () => {
    const [activeRes, recRes] = await Promise.all([
      api.get('/orders/active', { params: { date: dateStr } }),
      api.get('/daily-records', { params: { date: dateStr } }),
    ]);
    setActive(activeRes.data);
    setRecords(recRes.data);
  }, [dateStr]);

  useEffect(() => { load(); }, [load]);

  const lineOptions = lines.map(l => ({ value: l.id, label: l.name }));

  // 找出某 schedule_line 对应的当日 daily_record(若已存)
  const findRecord = (sl) => {
    return records.find(r =>
      r.product_process_id === sl.product_process_id &&
      (sl.line_id ? r.line_id === sl.line_id : true)
    );
  };

  // 搜索过滤(货号/货名) + tab 过滤(工艺)
  const qLower = q.trim().toLowerCase();
  let visible = qLower
    ? active.filter(sl =>
        (sl.product_code || '').toLowerCase().includes(qLower) ||
        (sl.product_name || '').toLowerCase().includes(qLower)
      )
    : active;
  if (tab !== 'all') visible = visible.filter(sl => normalizeTechnique(sl.technique) === tab);

  // 各工艺计数(给 tab 标签上显示数字用,基于完整 active 不受 tab 影响,但受 search 影响)
  const baseForCount = qLower
    ? active.filter(sl =>
        (sl.product_code || '').toLowerCase().includes(qLower) ||
        (sl.product_name || '').toLowerCase().includes(qLower)
      )
    : active;
  const countByTech = baseForCount.reduce((m, sl) => {
    const t = normalizeTechnique(sl.technique);
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {});

  // 两级分组:货号 → 工艺
  const productGroups = {}; // product_id -> { code, name, techniques: { 工艺: [sl,...] } }
  for (const sl of visible) {
    const pid = sl.product_id;
    if (!productGroups[pid]) {
      productGroups[pid] = {
        product_id: pid,
        product_code: sl.product_code,
        product_name: sl.product_name,
        techniques: {},
      };
    }
    const t = normalizeTechnique(sl.technique);
    if (!productGroups[pid].techniques[t]) productGroups[pid].techniques[t] = [];
    productGroups[pid].techniques[t].push(sl);
  }
  const productList = Object.values(productGroups).sort((a, b) =>
    (a.product_code || '').localeCompare(b.product_code || '')
  );

  const updateScheduleLine = async (sl, patch) => {
    await api.put(`/orders/${sl.order_id}/schedule-lines/${sl.schedule_line_id}`, patch);
    load();
  };

  const onClock = async (sl, action) => {
    await api.post(`/orders/${sl.order_id}/schedule-lines/${sl.schedule_line_id}/${action}`);
    load();
  };

  const onDailyChange = (sl, field, value) => {
    const key = `${sl.schedule_line_id}|${field}`;
    const cur = findRecord(sl) || {};
    const merged = { ...cur, [field]: value };

    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      // 必须有拉 + 生产数 + 人数 才存
      const lineId = sl.line_id;
      if (!lineId) { message.warning('请先选「分到拉」再录生产数'); return; }
      if (merged.produced_qty == null || merged.worker_count == null) return;
      try {
        await api.post('/daily-records', {
          record_date: dateStr,
          line_id: lineId,
          product_id: sl.product_id,
          product_process_id: sl.product_process_id,
          produced_qty: Number(merged.produced_qty || 0),
          worker_count: Number(merged.worker_count || 0),
          remarks: merged.remarks || '',
        });
        load();
      } catch (e) {
        message.error('保存失败: ' + (e.response?.data?.error || e.message));
      }
    }, 500);

    // 即时更新本地 records 显示
    setRecords(prev => {
      const idx = prev.findIndex(r =>
        r.product_process_id === sl.product_process_id &&
        (sl.line_id ? r.line_id === sl.line_id : true)
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        return next;
      }
      return [...prev, {
        product_process_id: sl.product_process_id,
        product_id: sl.product_id,
        line_id: sl.line_id,
        [field]: value,
      }];
    });
  };

  // 汇总
  let totalOutput = 0, totalWage = 0, recordCount = 0;
  for (const sl of active) {
    const rec = findRecord(sl);
    if (rec && rec.id) {
      totalOutput += (Number(rec.produced_qty) || 0) * (Number(sl.quote_price) || 0);
      totalWage += (Number(rec.produced_qty) || 0) * (Number(sl.unit_wage) || 0);
      recordCount++;
    }
  }

  const renderColumns = () => [
    { title: '部位', dataIndex: 'part_name', width: 110 },
    { title: '件数', dataIndex: 'planned_qty', width: 90, align: 'right', render: v => Number(v || 0) },
    {
      title: '累计数', dataIndex: 'produced_total', width: 90, align: 'right',
      render: v => <span style={{ color: '#1677ff' }}>{Number(v || 0)}</span>,
    },
    {
      title: '欠数', width: 90, align: 'right',
      render: (_, sl) => {
        const owed = Number(sl.planned_qty || 0) - Number(sl.produced_total || 0);
        if (owed <= 0) return <span style={{ color: '#52c41a' }}>已完</span>;
        return <span style={{ color: '#cf1322' }}>{owed}</span>;
      },
    },
    {
      title: '实际产能', dataIndex: 'actual_capacity', width: 100, align: 'right',
      render: (v, sl) => (
        <NumCell value={v ?? sl.daily_capacity}
          onSave={nv => updateScheduleLine(sl, { actual_capacity: nv })} />
      ),
    },
    {
      title: '起-止日', width: 180,
      render: (_, sl) => <span>{sl.start_date} ~ {sl.end_date}</span>,
    },
    {
      title: '分到拉', width: 130,
      render: (_, sl) => (
        <Select size="small" style={{ width: 110 }}
          placeholder={sl.technique === '喷油' ? '喷油(手选)' : '选拉'}
          value={sl.line_id || undefined}
          onChange={v => updateScheduleLine(sl, { line_id: v || null })}
          options={lineOptions}
          allowClear
        />
      ),
    },
    {
      title: '生产数', width: 100,
      render: (_, sl) => {
        const rec = findRecord(sl);
        return (
          <InputNumber size="small" min={0} style={{ width: 90 }}
            value={rec?.produced_qty}
            onChange={v => onDailyChange(sl, 'produced_qty', v)} />
        );
      },
    },
    {
      title: '人数', width: 80,
      render: (_, sl) => {
        const rec = findRecord(sl);
        return (
          <InputNumber size="small" min={0} style={{ width: 70 }}
            value={rec?.worker_count}
            onChange={v => onDailyChange(sl, 'worker_count', v)} />
        );
      },
    },
    {
      title: '备注', width: 140,
      render: (_, sl) => {
        const rec = findRecord(sl);
        return (
          <Input size="small" value={rec?.remarks || ''}
            onChange={e => onDailyChange(sl, 'remarks', e.target.value)} />
        );
      },
    },
    {
      title: '生产时间', width: 100,
      render: (_, sl) => sl.started_at
        ? <span style={{ color: '#1677ff' }}>{fmtTime(sl.started_at)}</span>
        : <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '完成时间', width: 100,
      render: (_, sl) => sl.completed_at
        ? <span style={{ color: '#52c41a' }}>{fmtTime(sl.completed_at)}</span>
        : <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '操作', width: 320,
      render: (_, sl) => {
        const rec = findRecord(sl);
        return (
          <Space size={4} wrap>
            <Button size="small" icon={<HistoryOutlined />}
              onClick={() => openHistory(sl)}>历史</Button>
            {rec?.id && (
              <Popconfirm title={`删除 ${dateStr} 这条录入(生产数 ${rec.produced_qty}, 人数 ${rec.worker_count})?`}
                onConfirm={() => clearTodayRecord(rec.id)}>
                <Button size="small" danger>清今日</Button>
              </Popconfirm>
            )}
            <Button size="small" type="primary" icon={<PlayCircleOutlined />}
              disabled={!!sl.started_at}
              onClick={() => onClock(sl, 'start')}>开始</Button>
            <Button size="small" icon={<CheckCircleOutlined />}
              disabled={!sl.started_at || !!sl.completed_at}
              onClick={() => onClock(sl, 'complete')}>完成</Button>
            {(sl.started_at || sl.completed_at) && (
              <Popconfirm title="重置开始/完成时间?"
                onConfirm={() => onClock(sl, 'reset')}>
                <Button size="small" icon={<RedoOutlined />} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const clearTodayRecord = async (id) => {
    await api.delete(`/daily-records/${id}`);
    message.success('已删除');
    load();
  };

  const onDeleteOrder = async (orderId) => {
    await api.delete(`/orders/${orderId}`);
    message.success('订单已删除');
    load();
  };

  const openHistory = async (sl) => {
    const params = { product_process_id: sl.product_process_id };
    if (sl.line_id) params.line_id = sl.line_id;
    const { data } = await api.get('/daily-records/history', { params });
    setHistoryModal({ sl, rows: data });
  };

  const reloadHistory = async () => {
    if (!historyModal) return;
    const sl = historyModal.sl;
    const params = { product_process_id: sl.product_process_id };
    if (sl.line_id) params.line_id = sl.line_id;
    const { data } = await api.get('/daily-records/history', { params });
    setHistoryModal({ sl, rows: data });
    load(); // 累计可能变了,主表也重拉
  };

  const onHistoryDelete = async (id) => {
    await api.delete(`/daily-records/${id}`);
    reloadHistory();
  };

  return (
    <div>
      <Space style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', width: '100%' }} wrap>
        <Space wrap>
          <h2 style={{ margin: 0 }}>每日录入</h2>
          <DatePicker value={date} onChange={d => setDate(d || dayjs())} allowClear={false} />
          <Input.Search placeholder="搜索货号 / 货名" allowClear
            value={q} onChange={e => setQ(e.target.value)}
            style={{ width: 240 }} />
        </Space>
        <Card size="small" styles={{ body: { padding: 8 } }}>
          今日排产 <b>{active.length}</b> 条 · 已录 <b>{recordCount}</b> 条 |
          今日产值 <b style={{ color: '#1677ff' }}>¥{totalOutput.toFixed(2)}</b> |
          今日工资 <b style={{ color: '#cf1322' }}>¥{totalWage.toFixed(2)}</b>
        </Card>
      </Space>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        style={{ marginBottom: 8 }}
        items={[
          { key: 'all', label: `全部 (${baseForCount.length})` },
          { key: '喷油', label: <span style={{ color: TECHNIQUE_COLORS['喷油'] }}>喷油 ({countByTech['喷油'] || 0})</span> },
          { key: '移印', label: <span style={{ color: TECHNIQUE_COLORS['移印'] }}>移印 ({countByTech['移印'] || 0})</span> },
          { key: 'UV', label: <span style={{ color: TECHNIQUE_COLORS['UV'] }}>UV ({countByTech['UV'] || 0})</span> },
          { key: '散枪', label: <span style={{ color: TECHNIQUE_COLORS['散枪'] }}>散枪 ({countByTech['散枪'] || 0})</span> },
        ]}
      />

      {productList.length === 0 ? (
        <Card><div style={{ color: '#999', textAlign: 'center', padding: 40 }}>
          {qLower ? '没有匹配的货号' : '今天没有排产中的工序。先去排产页新建订单。'}
        </div></Card>
      ) : productList.map(prod => {
        const techniques = Object.keys(prod.techniques).sort();
        const total = techniques.reduce((s, t) => s + prod.techniques[t].length, 0);
        const done = techniques.reduce((s, t) =>
          s + prod.techniques[t].filter(sl => sl.completed_at).length, 0);
        // 找出此产品名下涉及的所有订单(去重)
        const orderMap = new Map();
        for (const t of techniques) {
          for (const sl of prod.techniques[t]) {
            if (!orderMap.has(sl.order_id)) {
              orderMap.set(sl.order_id, { order_id: sl.order_id, order_name: sl.order_name });
            }
          }
        }
        const orders = [...orderMap.values()];
        return (
          <Card key={prod.product_id}
            title={
              <span>
                <b style={{ fontSize: 15 }}>{prod.product_code}</b>
                <span style={{ marginLeft: 8 }}>{prod.product_name}</span>
                <span style={{ marginLeft: 12, color: '#888', fontSize: 12, fontWeight: 'normal' }}>
                  共 {total} 道工序 · 已完成 {done}/{total}
                </span>
              </span>
            }
            extra={
              <Space size={4}>
                {orders.map(o => (
                  <Popconfirm key={o.order_id}
                    title={`删除订单 ${o.order_name}?该订单的全部工序将一并删除`}
                    onConfirm={() => onDeleteOrder(o.order_id)}>
                    <Button size="small" danger>删除 {o.order_name}</Button>
                  </Popconfirm>
                ))}
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
            styles={{ body: { padding: 0 } }}
          >
            {techniques.map(technique => {
              const list = prod.techniques[technique];
              const subDone = list.filter(sl => sl.completed_at).length;
              // 喷油 下再分 手喷 / 自动 / 未分
              const isSpray = technique === '喷油';
              const sprayBuckets = isSpray
                ? list.reduce((m, sl) => {
                    const k = getSpraySubGroup(sl);
                    if (!m[k]) m[k] = [];
                    m[k].push(sl);
                    return m;
                  }, {})
                : null;
              const sprayKeys = sprayBuckets ? ['手喷', '自动', '未分'].filter(k => sprayBuckets[k]) : null;
              return (
                <div key={technique}>
                  <div style={{
                    background: TECHNIQUE_COLORS[technique] || '#595959',
                    color: '#fff',
                    padding: '4px 12px',
                    fontWeight: 600,
                    fontSize: 13,
                  }}>
                    {technique} <span style={{ opacity: 0.85, fontSize: 12, marginLeft: 8 }}>
                      {list.length} 道 · {subDone}/{list.length}
                    </span>
                  </div>
                  {isSpray ? sprayKeys.map(sk => {
                    const sub = sprayBuckets[sk];
                    const sDone = sub.filter(sl => sl.completed_at).length;
                    return (
                      <div key={sk}>
                        <div style={{
                          background: SPRAY_SUB_COLORS[sk],
                          color: '#fff',
                          padding: '3px 12px 3px 28px',
                          fontWeight: 500,
                          fontSize: 12,
                        }}>
                          ↳ {sk} <span style={{ opacity: 0.85, marginLeft: 8 }}>
                            {sub.length} 道 · {sDone}/{sub.length}
                          </span>
                        </div>
                        <Table
                          rowKey="schedule_line_id"
                          size="small"
                          dataSource={sub}
                          columns={renderColumns()}
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                        />
                      </div>
                    );
                  }) : (
                    <Table
                      rowKey="schedule_line_id"
                      size="small"
                      dataSource={list}
                      columns={renderColumns()}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Modal
        open={!!historyModal}
        title={historyModal ? `逐日生产历史 — ${historyModal.sl.product_code} · ${historyModal.sl.part_name}·${historyModal.sl.technique}` : ''}
        onCancel={() => setHistoryModal(null)}
        footer={null}
        width={700}
      >
        {historyModal && (
          <div>
            <div style={{ marginBottom: 12, color: '#666' }}>
              起始日 <b>{historyModal.sl.start_date}</b> · 件数 <b>{historyModal.sl.planned_qty}</b> ·
              累计 <b style={{ color: '#1677ff' }}>{historyModal.rows.reduce((s, r) => s + Number(r.produced_qty || 0), 0)}</b>
            </div>
            {historyModal.rows.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', padding: 30 }}>还没有任何生产记录</div>
            ) : (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={historyModal.rows}
                columns={[
                  { title: '日期', dataIndex: 'record_date', width: 120 },
                  { title: '拉', dataIndex: 'line_name', width: 120, render: v => v || <span style={{ color: '#ccc' }}>—</span> },
                  { title: '生产数', dataIndex: 'produced_qty', width: 110, align: 'right' },
                  { title: '人数', dataIndex: 'worker_count', width: 80, align: 'right' },
                  { title: '备注', dataIndex: 'remarks' },
                  {
                    title: '操作', width: 80,
                    render: (_, r) => (
                      <Popconfirm title="删此条?" onConfirm={() => onHistoryDelete(r.id)}>
                        <Button size="small" danger>删</Button>
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            )}
            <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
              提示:要新增/修改某天的生产数,请在主页面切换到对应日期再录入。删除某天后,累计自动减少。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
