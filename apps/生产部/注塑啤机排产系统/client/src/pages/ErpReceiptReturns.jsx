import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, InputNumber, List, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api/warehouse-orders';

// This is a workshop task, not a personal inbox: the original operator name is
// retained on each receipt but is not used to guess a user account.
export default function ErpReceiptReturns({ workshop, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [quantities, setQuantities] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setActive(null);
    setSubmitting(false);
    setGroups([]);
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`${API}/_/erp-returns`, { params: { workshop }, signal: controller.signal });
        if (current !== generation.current) return;
        setGroups(data);
        setError('');
      } catch (cause) {
        if (controller.signal.aborted || current !== generation.current) return;
        setError(cause.response?.data?.message || 'ERP打回待办读取失败，请重试');
      } finally {
        if (current === generation.current && !controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { generation.current++; controller.abort(); clearInterval(timer); };
  }, [workshop, refresh]);

  const open = group => {
    setActive(group);
    setQuantities(group.rows.map(row => ({ id: row.id, delivery_pcs: row.delivery_pcs, delivery_shots: row.delivery_shots })));
  };
  const change = (id, key, value) => setQuantities(rows => rows.map(row => row.id === id ? { ...row, [key]: value } : row));
  const submit = async () => {
    const current = generation.current;
    if (quantities.some(row => !Number.isSafeInteger(row.delivery_pcs) || row.delivery_pcs < 1 ||
      (row.delivery_shots != null && (!Number.isSafeInteger(row.delivery_shots) || row.delivery_shots < 1)))) {
      message.error('实收件数必须为正整数，送货啤数须为正整数或留空');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API}/_/erp-resubmit`, {
        request_id: active.request_id, erp_receipt_no: active.erp_receipt_no,
        round: active.round, workshop, submission_revision: active.submission_revision,
        ids: active.ids, rows: quantities,
      }, { headers: { 'X-Paiji-Session': localStorage.getItem('paiji_token') || '' } });
      if (current !== generation.current) return;
      message.success('整张单已重新送审，数量已锁定');
      setActive(null);
      setRefresh(value => value + 1);
      onChanged();
    } catch (cause) {
      if (current !== generation.current) return;
      message.error(cause.response?.data?.message || '重新送审失败，填写的数量已保留');
    } finally {
      if (current === generation.current) setSubmitting(false);
    }
  };
  const returned = groups.filter(group => group.status === 'returned').length;
  const readonly = active?.status !== 'returned';
  const columns = [
    { title: '入库单', dataIndex: 'delivery_code', render: (value, row) => value || `#${row.id}` },
    { title: '部件名称', dataIndex: 'part_name',
      render: (_, row) => <><div>{row.part_name}</div>{row.material_name && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.material_name}</div>}</> },
    { title: '颜色 / 色粉', render: (_, row) => [row.color, row.color_powder_no].filter(Boolean).join(' / ') },
    { title: '出模数', dataIndex: 'cavity' },
    { title: '实收件数 PCS', render: (_, row) => <InputNumber aria-label={`入库单${row.id}实收件数`} min={1} precision={0}
      disabled={readonly || submitting} value={quantities.find(item => item.id === row.id)?.delivery_pcs}
      onChange={value => change(row.id, 'delivery_pcs', value)} /> },
    { title: '送货啤数', render: (_, row) => <InputNumber aria-label={`入库单${row.id}送货啤数`} min={1} precision={0}
      disabled={readonly || submitting} value={quantities.find(item => item.id === row.id)?.delivery_shots}
      onChange={value => change(row.id, 'delivery_shots', value)} /> },
  ];
  return <section aria-label="ERP入仓审核待办" style={{ marginBottom: 16 }}>
    <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
      <b>ERP打回待修改 <Tag color={returned ? 'red' : 'default'}>{returned} 张</Tag></b>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新待办</Button>
    </Space>
    {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 8 }} />}
    {groups.length > 0 && <List bordered size="small" dataSource={groups} renderItem={group => <List.Item
      actions={[<Button key="open" onClick={() => open(group)}>{group.status === 'returned' ? '查看原因并修改' : '查看送审详情'}</Button>]}>
      <List.Item.Meta title={<Space wrap><span>ERP入仓单 {group.erp_receipt_no}</span><Tag color={group.status === 'returned' ? 'red' : 'blue'}>
        {group.status === 'returned' ? '打回待修改' : '已重新送审'}</Tag><span>第{group.round}轮 · {group.ids.length}条物料</span></Space>}
        description={group.reason} />
    </List.Item>} />}
    <Drawer title={active ? `ERP入仓单 ${active.erp_receipt_no} · 第${active.round}轮` : 'ERP入仓单'}
      open={Boolean(active)} width={1000} onClose={() => { if (!submitting) setActive(null); }}
      extra={<Space><Button disabled={submitting} onClick={() => setActive(null)}>关闭</Button>
        {!readonly && <Button type="primary" loading={submitting} onClick={submit}>整单重新送审</Button>}</Space>}>
      {active && <>
        <Alert type={readonly ? 'info' : 'warning'} showIcon title={readonly ? '已重新送审，数量已锁定' : '请核对整张单后重新送审'}
          description={active.reason} style={{ marginBottom: 16 }} />
        <p>原入仓单、采购来源及出模数保留。共模件请核对“送货啤数 × 整模出模数 ＝ 实收件数”。入库结果以ERP审核为准，库存只在ERP审核入仓后增加。</p>
        <Table rowKey="id" columns={columns} dataSource={active.rows} pagination={false} scroll={{ x: 800 }} />
      </>}
    </Drawer>
  </section>;
}
