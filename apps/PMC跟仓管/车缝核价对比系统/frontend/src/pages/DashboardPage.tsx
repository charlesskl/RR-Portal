import { DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Form, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { evaluationApi, type EvaluationRow, type EvaluationSettings } from '../api/supplierEvaluation';
import { useAuth } from '../auth/AuthContext';
import { palette } from '../theme';

/* 阶段6 · 综合评价 —— 加工厂综合评分(质量40%+价格40%+交付20%)→A/B/C/D。纯实时聚合。 */

const hcell = () => ({ style: { background: palette.blueSoft, color: palette.blueDark, fontWeight: 700, whiteSpace: 'nowrap' as const } });
const dash = <span style={{ color: palette.inkSoft }}>—</span>;
const gradeColor = (g: string) => (g === '未评级' ? 'default' : g === '观察中' ? 'processing' : g.startsWith('A') ? 'success' : g.startsWith('B') ? 'blue' : g.startsWith('C') ? 'orange' : 'error');
const score = (v?: number | null) => (v == null ? dash : v.toFixed(1));

export default function DashboardPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { user, role } = useAuth();
  const [rows, setRows] = useState<EvaluationRow[]>([]);
  const [gradeFilter, setGradeFilter] = useState('已评级');
  const [newThisMonthOnly, setNewThisMonthOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<EvaluationSettings>({ targetSaving: 0.10, qualityWeight: 0.4, priceWeight: 0.4, deliveryWeight: 0.2, gradeA: 85, gradeB: 75, gradeC: 60 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [form] = Form.useForm();
  const deptId = user?.deptId ?? 1;

  useEffect(() => {
    setLoading(true);
    evaluationApi
      .list()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { evaluationApi.settings(deptId).then(setSettings); }, [deptId]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const gradeMatched = gradeFilter === '全部'
      || (gradeFilter === '已评级' ? !['未评级', '观察中'].includes(row.grade)
        : gradeFilter === '观察中' ? row.grade === '观察中'
        : gradeFilter === '未评级' ? row.grade === '未评级' : row.grade.startsWith(gradeFilter));
    return gradeMatched && (!newThisMonthOnly || row.isNewThisMonth);
  }), [rows, gradeFilter, newThisMonthOnly]);

  const pctWeight = (v: number) => `${Math.round(v * 100)}%`;
  const columns: ColumnsType<EvaluationRow> = [
    { title: '加工厂', dataIndex: 'supplierName', width: 180, fixed: 'left', onHeaderCell: hcell, render: (v, row) => <Space size={6}><a onClick={() => navigate(`/dashboard/${row.supplierId}`)}><b>{v}</b></a>{row.isNewThisMonth && <Tag color="processing">本月新增</Tag>}</Space> },
    { title: `质量分 (${pctWeight(settings.qualityWeight)})`, dataIndex: 'qualityScore', width: 120, onHeaderCell: hcell, render: (v, r) => <span>{score(v)} <small style={{ color: palette.inkSoft }}>({r.inspectionCount}次)</small></span> },
    { title: `价格分 (${pctWeight(settings.priceWeight)})`, dataIndex: 'priceScore', width: 120, onHeaderCell: hcell, render: (v, r) => <span>{score(v)} <small style={{ color: palette.inkSoft }}>({r.pricedLineCount}款次)</small></span> },
    { title: `交付分 (${pctWeight(settings.deliveryWeight)})`, dataIndex: 'deliveryScore', width: 120, onHeaderCell: hcell, render: (v, r) => <span>{score(v)} <small style={{ color: palette.inkSoft }}>({r.deliveredCount}单)</small></span> },
    { title: '综合分', dataIndex: 'totalScore', width: 100, onHeaderCell: hcell, render: (v) => <b style={{ fontSize: 15 }}>{score(v)}</b> },
    { title: '等级', dataIndex: 'grade', width: 110, onHeaderCell: hcell, render: (v: string) => <Tag color={gradeColor(v)}>{v}</Tag> },
    { title: '处理建议', dataIndex: 'advice', width: 130, onHeaderCell: hcell, render: (v) => v || dash },
  ];

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['加工厂', '质量分', '价格分', '交付分', '综合分', '等级', '处理建议'],
      ...filteredRows.map((r) => [r.supplierName, r.qualityScore, r.priceScore, r.deliveryScore, r.totalScore, r.grade, r.advice]),
    ];
    const blob = new Blob([`\uFEFF${lines.map((x) => x.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '加工厂综合评价_累计.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openSettings = () => {
    form.setFieldsValue({
      targetSaving: settings.targetSaving * 100,
      qualityWeight: settings.qualityWeight * 100,
      priceWeight: settings.priceWeight * 100,
      deliveryWeight: settings.deliveryWeight * 100,
      gradeA: settings.gradeA, gradeB: settings.gradeB, gradeC: settings.gradeC,
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    const v = await form.validateFields();
    const weightTotal = v.qualityWeight + v.priceWeight + v.deliveryWeight;
    if (Math.abs(weightTotal - 100) > 0.001) { message.error('三个权重之和必须等于 100%'); return; }
    setSettingsSaving(true);
    try {
      const saved = await evaluationApi.updateSettings(deptId, {
        targetSaving: v.targetSaving / 100,
        qualityWeight: v.qualityWeight / 100,
        priceWeight: v.priceWeight / 100,
        deliveryWeight: v.deliveryWeight / 100,
        gradeA: v.gradeA, gradeB: v.gradeB, gradeC: v.gradeC,
      });
      setSettings(saved);
      setSettingsOpen(false);
      message.success('评价参数已生效');
    } finally { setSettingsSaving(false); }
  };

  return (
    <div>
      <div style={{ fontSize: 23, fontWeight: 700 }}>综合评价</div>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16 }}
        message="评分口径"
        description={`价格与质量各占40%，交付占20%。价格按加权节约率评分，节约${(settings.targetSaving * 100).toFixed(0)}%为满分；质量分按历史平均次品率计算并按质检数量加权；延期2天内不扣分，8～10天为50分。存在价格异常最高评C，三项数据未齐标记为“观察中”。`}
      />

      <div style={{ background: palette.raised, border: `1px solid ${palette.line}`, borderRadius: 18, boxShadow: '0 2px 8px rgba(31,99,216,0.05)', padding: '22px 24px', marginTop: 20 }}>
        <Space size={12} wrap style={{ marginBottom: 16 }}>
          <Select
            value={gradeFilter}
            onChange={setGradeFilter}
            style={{ width: 130 }}
            options={['已评级', '全部', '观察中', 'A', 'B', 'C', 'D', '未评级'].map((value) => ({ value, label: value === '全部' ? '全部等级' : value }))}
          />
          <Checkbox checked={newThisMonthOnly} onChange={(e) => setNewThisMonthOnly(e.target.checked)}>仅看本月新增</Checkbox>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!filteredRows.length}>导出</Button>
          {role === '管理员' && <Button icon={<SettingOutlined />} onClick={openSettings}>评价参数</Button>}
          <span style={{ color: palette.inkSoft }}>
            累计全部业务 · 完整数据才正式评级 · 显示 {filteredRows.length} / {rows.length} 家
          </span>
        </Space>
        <Table<EvaluationRow> rowKey="supplierId" size="small" columns={columns} dataSource={filteredRows} loading={loading} scroll={{ x: 860 }} pagination={false} />
      </div>

      <Modal title="综合评价参数" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={saveSettings} confirmLoading={settingsSaving} okText="保存并生效">
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="targetSaving" label="价格满分目标节约率（%）" rules={[{ required: true }]}><InputNumber min={0.01} max={100} style={{ width: '100%' }} /></Form.Item>
          <Space align="start" style={{ display: 'flex' }}>
            <Form.Item name="qualityWeight" label="质量权重（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
            <Form.Item name="priceWeight" label="价格权重（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
            <Form.Item name="deliveryWeight" label="交付权重（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
          </Space>
          <Space align="start" style={{ display: 'flex' }}>
            <Form.Item name="gradeA" label="A级最低分" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
            <Form.Item name="gradeB" label="B级最低分" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
            <Form.Item name="gradeC" label="C级最低分" rules={[{ required: true }]}><InputNumber min={0} max={100} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
