import { useState } from 'react';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ImportOutlined,
  PlusOutlined,
  RestOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Breadcrumb,
  Button,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnGroupType, ColumnsType, ColumnType } from 'antd/es/table';
import { palette } from '../theme';

/* =============================================================================
 *  模块一 · UI 预览页（静态假数据，不连后端，免登录 /preview）
 *  目的：照《2026-06-18-模块一-展示与录入设计稿.md》把每个界面摆出来给用户确认。
 *  配色：沿用本系统已定的柔和蓝主题（theme.ts 的 palette），不用全局饱和色表。
 * ========================================================================== */

// —— 颜色 token（全部取自本系统主题 palette）——
const C = {
  blue: palette.blue, // 主蓝
  blueDark: palette.blueDark, // 悬停/强调
  bar: palette.blue, // 汇总条
  head: palette.blueSoft, // 数据组表头 浅蓝底
  headInk: palette.blueDark, // 数据组表头字
  headCalc: '#efeafe', // 计算组表头 浅紫底（区分"系统算·只读"）
  calcInk: palette.violet, // 计算组表头字
  ok: palette.ok, // 合规/省钱 绿
  okSoft: palette.okSoft,
  bad: palette.bad, // 超标/亏 红
  errBg: '#fdeef1', // 超标行底色（柔和红）
  zebra: '#fafbff', // 斑马纹
  pageBg: palette.bg, // 页面背景
  ink: palette.ink, // 主文本
  inkSoft: palette.inkSoft, // 次文本
  line: palette.line, // 边框
};

// —— 小工具 ——
const dash = <span style={{ color: C.inkSoft }}>—</span>;
const yuan = (n: number, d = 2) => `¥${n.toFixed(d)}`;
// 省钱(本厂-外发为正)=绿；亏(为负)=红
const saveAmt = (save: number) => {
  if (save === 0) return dash;
  const good = save > 0;
  return (
    <span style={{ color: good ? C.ok : C.bad, fontWeight: 700 }}>
      {good ? '省' : '亏'}¥{Math.abs(save).toFixed(2)}
    </span>
  );
};
const saveTag = (save: number, rate: number) => {
  if (save === 0) return dash;
  const good = save > 0;
  return (
    <span style={{ color: good ? C.ok : C.bad, fontWeight: 700 }}>
      {good ? '省' : '亏'}¥{Math.abs(save).toFixed(2)} {good ? '↓' : '↑'}
      {Math.abs(rate).toFixed(1)}%
    </span>
  );
};
const signed = (n: number | null, suffix = '') => {
  if (n == null) return dash;
  const color = n < 0 ? C.ok : n > 0 ? C.bad : C.ink;
  return (
    <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
      {`${n > 0 ? '+' : ''}${n.toFixed(suffix === '%' ? 1 : 2)}${suffix}`}
    </span>
  );
};
const okTag = (
  <Tag style={{ background: C.okSoft, color: C.ok, border: `1px solid ${C.ok}`, margin: 0 }}>✅ 合规</Tag>
);
const badTag = (
  <Tag style={{ background: C.errBg, color: C.bad, border: `1px solid ${C.bad}`, margin: 0 }}>⚠️ 超标</Tag>
);
const selfTag = <Tag style={{ color: C.inkSoft, borderColor: C.line, margin: 0 }}>本厂自做</Tag>;

// 分组表头着色（数据组=浅蓝，计算组=浅紫；文字色随底色自动取）
const headCell = (bg: string) => () => ({
  style: {
    background: bg,
    color: bg === C.headCalc ? C.calcInk : C.headInk,
    fontWeight: 700,
    padding: '8px 8px',
    borderInlineEnd: `1px solid ${C.line}`,
    fontSize: 12,
    textAlign: 'center' as const,
  },
});
function grp<T>(title: string, bg: string, children: ColumnType<T>[]): ColumnGroupType<T> {
  return {
    title,
    align: 'center',
    onHeaderCell: headCell(bg),
    children: children.map((c) => ({ ...c, onHeaderCell: headCell(bg) })),
  };
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  padding: 20,
  boxShadow: '0 2px 10px rgba(31,99,216,0.05)',
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: C.ink, margin: 0 };
const sub: React.CSSProperties = { fontSize: 12, color: C.inkSoft, marginTop: 2 };

/* ============================ 屏 1 · 供应商综合评价 ============================ */
type Grade = 'A' | 'B' | 'C' | 'D';
interface SupRow {
  key: number;
  name: string;
  contact: string;
  phone: string; // ★ 文字存，不当数字
  type: string;
  quoteSum: number; // 本厂(核价)合计
  outSum: number; // 外发合计
  qcTotal: number;
  qcOk: number;
  grade: Grade;
}
const SUP_DATA: SupRow[] = [
  { key: 1, name: '顺邦', contact: '张三', phone: '13500001111', type: '啤机胶件', quoteSum: 1240, outSum: 1080, qcTotal: 60, qcOk: 57, grade: 'A' },
  { key: 2, name: '信达', contact: '李四', phone: '13600002222', type: '车缝', quoteSum: 980, outSum: 905, qcTotal: 48, qcOk: 44, grade: 'B' },
  { key: 3, name: '永和', contact: '王五', phone: '13700003333', type: '手工/包装', quoteSum: 760, outSum: 720, qcTotal: 40, qcOk: 33, grade: 'C' },
  { key: 4, name: '利丰', contact: '赵六', phone: '13800004444', type: '充棉', quoteSum: 540, outSum: 510, qcTotal: 30, qcOk: 22, grade: 'D' },
];
const gradeColor: Record<Grade, string> = { A: C.ok, B: C.blue, C: palette.amber, D: C.bad };

function Screen1Eval() {
  const cols: ColumnsType<SupRow> = [
    grp<SupRow>('工厂基础信息', C.head, [
      { title: '厂名', dataIndex: 'name', width: 80, render: (v) => <b>{v}</b> },
      { title: '联系人', dataIndex: 'contact', width: 72 },
      { title: '联系电话', dataIndex: 'phone', width: 124 }, // 文字显示，完整号码
      { title: '加工类型', dataIndex: 'type', width: 96 },
    ]),
    grp<SupRow>('价格管理', C.head, [
      { title: '核价合计(本厂)', dataIndex: 'quoteSum', width: 110, align: 'right', render: (v) => yuan(v, 0) },
      { title: '外发合计', dataIndex: 'outSum', width: 92, align: 'right', render: (v) => yuan(v, 0) },
      {
        title: '相差(省)',
        key: 'diff',
        width: 96,
        align: 'right',
        render: (_, r) => saveAmt(r.quoteSum - r.outSum),
      },
    ]),
    grp<SupRow>('品质管理', C.head, [
      { title: '验货数', dataIndex: 'qcTotal', width: 76, align: 'right' },
      { title: '合格数', dataIndex: 'qcOk', width: 76, align: 'right' },
      {
        title: '合格率',
        key: 'qcrate',
        width: 84,
        align: 'right',
        render: (_, r) => {
          const rate = (r.qcOk / r.qcTotal) * 100;
          return <b style={{ color: rate >= 95 ? C.ok : C.bad }}>{rate.toFixed(1)}%</b>;
        },
      },
    ]),
    {
      title: '综合评级',
      dataIndex: 'grade',
      width: 96,
      align: 'center',
      onHeaderCell: headCell(C.head),
      render: (g: Grade) => (
        <div
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 34,
            height: 34,
            borderRadius: 9,
            background: gradeColor[g],
            color: '#fff',
            fontWeight: 800,
            fontSize: 17,
          }}
        >
          {g}
        </div>
      ),
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={h2}>供应商综合评价</h2>
          <div style={sub}>一个外发厂一行 · 评级只用「价格 + 品质」两项算（阈值待副总）</div>
        </div>
        <Select defaultValue="2026-06" style={{ width: 130, marginLeft: 'auto' }} options={[{ value: '2026-06', label: '2026年6月' }]} />
        <Button icon={<DownloadOutlined />} style={{ borderColor: C.blue, color: C.blue }}>
          导出 / 截图
        </Button>
      </div>
      <Table<SupRow>
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={SUP_DATA}
        pagination={false}
        onRow={(_, i) => ({ style: { background: (i ?? 0) % 2 === 1 ? C.zebra : undefined, cursor: 'pointer' } })}
      />
      <div style={{ ...sub, marginTop: 10 }}>
        💡 外发更便宜才外发，否则本厂自做；「相差」即比本厂省下的钱。每行可点击下钻到该厂核价明细。
      </div>
    </div>
  );
}

/* ============================ 屏 2 · 核价对比 · 按产品看 ============================ */
interface StyleRow {
  key: number;
  styleNo: string;
  name: string;
  self: number;
  adopted: number;
  saving: number;
  rate: number;
  compliant: boolean;
}
const STYLE_DATA: StyleRow[] = [
  { key: 1, styleNo: '8801', name: '衬衫', self: 45, adopted: 42, saving: 3, rate: 6.7, compliant: true },
  { key: 2, styleNo: '8802', name: '西裤', self: 83, adopted: 77, saving: 6, rate: 7.2, compliant: false },
  { key: 3, styleNo: '8803', name: '外套', self: 56, adopted: 56, saving: 0, rate: 0, compliant: true },
];

function Screen2ByProduct({ onOpenDetail }: { onOpenDetail: (s: StyleRow) => void }) {
  const cols: ColumnsType<StyleRow> = [
    { title: '款式', key: 'style', onHeaderCell: headCell(C.head), render: (_, s) => <b>{`${s.styleNo} ${s.name}`}</b> },
    { title: '本厂总价(核价合计)', align: 'right', onHeaderCell: headCell(C.head), render: (_, s) => yuan(s.self) },
    { title: '比价后采用', align: 'right', onHeaderCell: headCell(C.head), render: (_, s) => <b>{yuan(s.adopted)}</b> },
    {
      title: '节省',
      align: 'right',
      onHeaderCell: headCell(C.headCalc),
      render: (_, s) => saveTag(s.saving, s.rate),
    },
    {
      title: '合规',
      align: 'center',
      width: 100,
      onHeaderCell: headCell(C.head),
      render: (_, s) => (s.compliant ? okTag : badTag),
    },
    {
      title: '操作',
      align: 'center',
      width: 110,
      onHeaderCell: headCell(C.head),
      render: (_, s) => (
        <Button type="link" size="small" onClick={() => onOpenDetail(s)} style={{ color: C.blue, fontWeight: 600 }}>
          明细 <RightOutlined />
        </Button>
      ),
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={h2}>按产品看</h2>
          <div style={sub}>回答「哪个款 / 系列贵」 · 系列汇总 → 款列表 → 点款跳明细</div>
        </div>
        <Space style={{ marginLeft: 'auto' }}>
          <span style={{ color: C.inkSoft, fontSize: 13 }}>货号</span>
          <Select defaultValue="A2401" style={{ width: 130 }} options={[{ value: 'A2401', label: 'A2401' }]} />
        </Space>
      </div>

      {/* 系列汇总条 */}
      <div
        style={{
          background: `linear-gradient(135deg, ${C.bar}, #5b9bff)`,
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '10px 10px 0 0',
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 800 }}>货号 A2401</span>
        <span>本厂合计 ¥184</span>
        <span>比价采用 ¥175</span>
        <span style={{ fontWeight: 800 }}>省 ¥9 ↓4.9%</span>
        <Tag style={{ margin: 0, color: '#fff', background: 'rgba(255,255,255,0.25)', border: 'none' }}>有超标</Tag>
      </div>

      <Table<StyleRow>
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={STYLE_DATA}
        pagination={false}
        style={{ borderRadius: '0 0 10px 10px', overflow: 'hidden' }}
        onRow={(_, i) => ({ style: { background: (i ?? 0) % 2 === 1 ? C.zebra : undefined } })}
      />
    </div>
  );
}

/* ============================ 屏 3 · 核价对比 · 按供应商看 ============================ */
interface SupStyleRow {
  key: number;
  styleNo: string;
  name: string;
  self: number;
  out: number;
  saving: number;
  rate: number;
}
const SUP_STYLE_DATA: SupStyleRow[] = [
  { key: 1, styleNo: '8802', name: '西裤', self: 83, out: 77, saving: 6, rate: 7.2 },
  { key: 2, styleNo: '8805', name: '衬衫', self: 45, out: 40, saving: 5, rate: 11.1 },
  { key: 3, styleNo: '8809', name: '外套', self: 56, out: 50, saving: 6, rate: 10.7 },
];

function Screen3BySupplier({ onOpenDetail }: { onOpenDetail: (s: SupStyleRow) => void }) {
  const cols: ColumnsType<SupStyleRow> = [
    { title: '款式', key: 'style', onHeaderCell: headCell(C.head), render: (_, s) => <b>{`${s.styleNo} ${s.name}`}</b> },
    { title: '本厂做', align: 'right', onHeaderCell: headCell(C.head), render: (_, s) => yuan(s.self) },
    { title: '外发价', align: 'right', onHeaderCell: headCell(C.head), render: (_, s) => yuan(s.out) },
    { title: '相差(省)', align: 'right', onHeaderCell: headCell(C.headCalc), render: (_, s) => saveTag(s.saving, s.rate) },
    {
      title: '操作',
      align: 'center',
      width: 110,
      onHeaderCell: headCell(C.head),
      render: (_, s) => (
        <Button type="link" size="small" onClick={() => onOpenDetail(s)} style={{ color: C.blue, fontWeight: 600 }}>
          明细 <RightOutlined />
        </Button>
      ),
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={h2}>按供应商看</h2>
          <div style={sub}>回答「这家供应商这段时间值不值」 · 选「全部外发」即看本期外发整体省了多少</div>
        </div>
        <Space style={{ marginLeft: 'auto' }}>
          <span style={{ color: C.inkSoft, fontSize: 13 }}>供应商</span>
          <Select
            defaultValue="顺邦"
            style={{ width: 130 }}
            options={[
              { value: '顺邦', label: '顺邦' },
              { value: '__all', label: '全部外发' },
            ]}
          />
          <Segmented defaultValue="本月" options={['本周', '本月', '自定义']} />
        </Space>
      </div>

      {/* 合计条 */}
      <div
        style={{
          background: '#fff',
          border: `1px solid ${C.line}`,
          borderLeft: `5px solid ${C.bar}`,
          borderRadius: '10px 10px 0 0',
          padding: '12px 20px',
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800 }}>顺邦 · 2026年6月</span>
        <span style={{ color: C.inkSoft }}>外发 8 款</span>
        <span>本厂做 ¥1,240</span>
        <span>外发 ¥1,080</span>
        <span style={{ fontWeight: 800, color: C.ok }}>本月共省 ¥160 ↓12.9%</span>
        <Button size="small" icon={<DownloadOutlined />} style={{ marginLeft: 'auto', borderColor: C.blue, color: C.blue }}>
          导出
        </Button>
      </div>

      <Table<SupStyleRow>
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={SUP_STYLE_DATA}
        pagination={false}
        style={{ borderRadius: '0 0 10px 10px', overflow: 'hidden' }}
        onRow={(_, i) => ({ style: { background: (i ?? 0) % 2 === 1 ? C.zebra : undefined } })}
      />
    </div>
  );
}

/* —— 核价对比模块：把"按产品 / 按供应商"合到一个模块，内部 Tab 切换 —— */
function CostCompareModule({
  tab,
  setTab,
  onOpenDetail,
}: {
  tab: string;
  setTab: (v: string) => void;
  onOpenDetail: (title: string) => void;
}) {
  return (
    <div>
      <div style={{ ...cardStyle, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontWeight: 800, fontSize: 16 }}>核价对比</span>
        <Segmented value={tab} onChange={(v) => setTab(v as string)} options={['按产品看', '按供应商看']} />
        <span style={{ color: C.inkSoft, fontSize: 12, marginLeft: 'auto' }}>同一批明细，两种加法 → 数字永远对得上</span>
      </div>
      {tab === '按产品看' ? (
        <Screen2ByProduct onOpenDetail={(s) => onOpenDetail(`${s.styleNo} ${s.name}`)} />
      ) : (
        <Screen3BySupplier onOpenDetail={(s) => onOpenDetail(`${s.styleNo} ${s.name}`)} />
      )}
    </div>
  );
}

/* ============================ 屏 4 · 工艺大类明细页（23 列，跳转目标） ============================ */
interface DetailRow {
  key: number;
  cat: string;
  sup: string | null;
  qty: number;
  unit: string;
  qHkd: number | null;
  qInclCny: number;
  qExclCny: number;
  iInclCny: number | null;
  iExclCny: number | null;
  oInclCny: number | null;
  oExclCny: number | null;
  diffQuote: number | null;
  rateQuote: number | null;
  diffInternal: number | null;
  rateInternal: number | null;
  status: '合规' | '单价超标' | null;
  qOut: number | null;
  oOut: number | null;
  outDiff: number | null;
}
const DETAIL_DATA: DetailRow[] = [
  { key: 1, cat: '图省', sup: '顺邦', qty: 100, unit: '件', qHkd: 13.3, qInclCny: 13.56, qExclCny: 12.0, iInclCny: 13.0, iExclCny: 11.5, oInclCny: 12.2, oExclCny: 10.8, diffQuote: -1.2, rateQuote: -10.0, diffInternal: -0.7, rateInternal: -6.1, status: '合规', qOut: 1200, oOut: 1080, outDiff: -120 },
  { key: 2, cat: '车缝', sup: '顺邦', qty: 100, unit: '件', qHkd: 50, qInclCny: 50.85, qExclCny: 45.0, iInclCny: 48.6, iExclCny: 43.0, oInclCny: 47.5, oExclCny: 42.0, diffQuote: -3.0, rateQuote: -6.7, diffInternal: -1.0, rateInternal: -2.3, status: '合规', qOut: 4500, oOut: 4200, outDiff: -300 },
  { key: 3, cat: '手缝', sup: null, qty: 100, unit: '件', qHkd: null, qInclCny: 9.04, qExclCny: 8.0, iInclCny: 9.04, iExclCny: 8.0, oInclCny: null, oExclCny: null, diffQuote: null, rateQuote: null, diffInternal: null, rateInternal: null, status: null, qOut: 800, oOut: null, outDiff: null },
  { key: 4, cat: '包装', sup: '信达', qty: 100, unit: '件', qHkd: null, qInclCny: 6.78, qExclCny: 6.0, iInclCny: 6.5, iExclCny: 5.75, oInclCny: 7.34, oExclCny: 6.5, diffQuote: 0.5, rateQuote: 8.3, diffInternal: 0.75, rateInternal: 13.0, status: '单价超标', qOut: 600, oOut: 650, outDiff: 50 },
];

const num = (n: number | null, d = 2) =>
  n == null ? dash : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toFixed(d)}</span>;

function Screen4Detail({ title, onBack }: { title: string; onBack: () => void }) {
  const cols: ColumnsType<DetailRow> = [
    grp<DetailRow>('标识', C.head, [
      { title: '工艺大类', dataIndex: 'cat', width: 76, render: (v) => <b>{v}</b> },
      { title: '外发厂', dataIndex: 'sup', width: 84, render: (v) => (v ? v : selfTag) },
      { title: '数量', dataIndex: 'qty', width: 60, align: 'right' },
      { title: '单位', dataIndex: 'unit', width: 48, align: 'center' },
    ]),
    grp<DetailRow>('核价工价', C.head, [
      { title: '含税HK$', dataIndex: 'qHkd', width: 78, align: 'right', render: (v) => num(v) },
      { title: '含税¥', dataIndex: 'qInclCny', width: 74, align: 'right', render: (v) => num(v) },
      { title: '不含税¥', dataIndex: 'qExclCny', width: 76, align: 'right', render: (v) => num(v) },
    ]),
    grp<DetailRow>('内部生产工价', C.head, [
      { title: '含税¥', dataIndex: 'iInclCny', width: 74, align: 'right', render: (v) => num(v) },
      { title: '不含税¥', dataIndex: 'iExclCny', width: 76, align: 'right', render: (v) => num(v) },
    ]),
    grp<DetailRow>('外发加工工价', C.head, [
      { title: '含税¥', dataIndex: 'oInclCny', width: 74, align: 'right', render: (v) => num(v) },
      { title: '不含税¥', dataIndex: 'oExclCny', width: 76, align: 'right', render: (v) => num(v) },
    ]),
    grp<DetailRow>('对比（系统算·只读）', C.headCalc, [
      { title: '外发-核价', dataIndex: 'diffQuote', width: 86, align: 'right', render: (v) => signed(v) },
      { title: '比率%', dataIndex: 'rateQuote', width: 72, align: 'right', render: (v) => signed(v, '%') },
      { title: '外发-内部', dataIndex: 'diffInternal', width: 86, align: 'right', render: (v) => signed(v) },
      { title: '比率%', dataIndex: 'rateInternal', width: 72, align: 'right', render: (v) => signed(v, '%') },
    ]),
    grp<DetailRow>('合规（外发<本厂=合规）', C.headCalc, [
      {
        title: '判定',
        dataIndex: 'status',
        width: 96,
        align: 'center',
        render: (v, r) => (v === '合规' ? okTag : v === '单价超标' ? badTag : r.sup ? dash : selfTag),
      },
    ]),
    grp<DetailRow>('产值（系统算·只读）', C.headCalc, [
      { title: '核价产值', dataIndex: 'qOut', width: 84, align: 'right', render: (v) => num(v, 0) },
      { title: '外发产值', dataIndex: 'oOut', width: 84, align: 'right', render: (v) => num(v, 0) },
      { title: '相差', dataIndex: 'outDiff', width: 76, align: 'right', render: (v) => num(v, 0) },
    ]),
  ];

  return (
    <div style={cardStyle}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <Breadcrumb
          items={[{ title: '货号 A2401' }, { title: `款 ${title}` }, { title: '工艺大类明细' }]}
          style={{ fontSize: 14 }}
        />
      </Space>
      <div style={{ ...sub, marginBottom: 10 }}>
        浅蓝表头 = 录入项（人填）；浅紫表头 = 系统算的只读列（永不可编辑）。合规规则：外发价低于本厂价 = 合规，高于 = 超标（整行标红）。
      </div>
      <Table<DetailRow>
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={DETAIL_DATA}
        pagination={false}
        scroll={{ x: 1500 }}
        onRow={(r, i) => ({
          style: {
            background: r.status === '单价超标' ? C.errBg : (i ?? 0) % 2 === 1 ? C.zebra : undefined,
          },
        })}
      />
    </div>
  );
}

/* ============================ 屏 5 · 按款批量录入 ============================ */
interface EntryRow {
  id: number;
  cat?: string;
  sup?: string;
  quote?: number;
  internal?: number;
  out?: number;
  qty?: number;
  unit?: string;
}
const CAT_OPTS = ['图省', '车缝', '手缝', '充棉', '包装', '电绣'].map((v) => ({ value: v, label: v }));
const SUP_OPTS = ['顺邦', '信达', '永和', '利丰'].map((v) => ({ value: v, label: v }));

function Screen5Entry() {
  const [rows, setRows] = useState<EntryRow[]>([
    { id: 1, cat: '图省', sup: '顺邦', quote: 12.0, internal: 11.5, out: 10.8, qty: 100, unit: '件' },
    { id: 2, cat: '车缝', sup: '顺邦', quote: 45.0, internal: 43.0, out: 42.0, qty: 100, unit: '件' },
    { id: 3, cat: '手缝', sup: undefined, quote: 8.0, internal: 8.0, out: undefined, qty: 100, unit: '件' },
  ]);
  const patch = (id: number, k: keyof EntryRow, v: unknown) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: Date.now(), unit: '件', qty: 100 }]);
  const delRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const cols: ColumnsType<EntryRow> = [
    {
      title: '工艺大类',
      width: 120,
      onHeaderCell: headCell(C.head),
      render: (_, r) => (
        <Select value={r.cat} onChange={(v) => patch(r.id, 'cat', v)} options={CAT_OPTS} style={{ width: '100%' }} placeholder="选择" />
      ),
    },
    {
      title: '外发厂（本厂自做留空）',
      width: 160,
      onHeaderCell: headCell(C.head),
      render: (_, r) => (
        <Select allowClear value={r.sup} onChange={(v) => patch(r.id, 'sup', v)} options={SUP_OPTS} style={{ width: '100%' }} placeholder="本厂自做" />
      ),
    },
    {
      title: '核价不含税¥ *',
      width: 120,
      onHeaderCell: headCell(C.head),
      render: (_, r) => (
        <InputNumber value={r.quote} onChange={(v) => patch(r.id, 'quote', v)} min={0} style={{ width: '100%' }} />
      ),
    },
    {
      title: '内部价¥',
      width: 110,
      onHeaderCell: headCell(C.head),
      render: (_, r) => <InputNumber value={r.internal} onChange={(v) => patch(r.id, 'internal', v)} min={0} style={{ width: '100%' }} />,
    },
    {
      title: '外发价¥',
      width: 110,
      onHeaderCell: headCell(C.head),
      render: (_, r) => <InputNumber value={r.out} onChange={(v) => patch(r.id, 'out', v)} min={0} style={{ width: '100%' }} />,
    },
    {
      title: '数量',
      width: 90,
      onHeaderCell: headCell(C.head),
      render: (_, r) => <InputNumber value={r.qty} onChange={(v) => patch(r.id, 'qty', v)} min={0} style={{ width: '100%' }} />,
    },
    {
      title: '单位',
      width: 70,
      onHeaderCell: headCell(C.head),
      render: (_, r) => <Input value={r.unit} onChange={(e) => patch(r.id, 'unit', e.target.value)} style={{ width: '100%' }} />,
    },
    {
      title: '',
      width: 44,
      align: 'center',
      onHeaderCell: headCell(C.head),
      render: (_, r) => <a style={{ color: C.bad }} onClick={() => delRow(r.id)}><DeleteOutlined /></a>,
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={h2}>录入核价 · 按款批量</h2>
        <div style={sub}>选一次款 → 一行一个工艺大类 → 一次保存。只填人填项，差额 / 合规 / 产值由系统算，录入表里不出现。</div>
      </div>

      {/* 款 + 日期 + 默认汇率税率 */}
      <Space size={16} wrap style={{ marginBottom: 14, background: palette.blueSoft, padding: '12px 16px', borderRadius: 10 }}>
        <span>
          <span style={{ color: C.inkSoft, marginRight: 8 }}>款式</span>
          <Select defaultValue="8802" style={{ width: 180 }} options={[{ value: '8802', label: '8802 西裤' }]} />
        </span>
        <span>
          <span style={{ color: C.inkSoft, marginRight: 8 }}>日期</span>
          <Input defaultValue="2026-06-20" style={{ width: 130 }} />
        </span>
        <span style={{ color: C.inkSoft, fontSize: 12 }}>汇率 0.9 · 税率 13%（默认带出，一般不动）</span>
      </Space>

      <Table<EntryRow> rowKey="id" size="small" bordered columns={cols} dataSource={rows} pagination={false} />

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
        <Button icon={<PlusOutlined />} onClick={addRow} style={{ borderStyle: 'dashed' }}>
          再加一行
        </Button>
        <Space style={{ marginLeft: 'auto' }}>
          <Button>取消</Button>
          <Button type="primary">保存这一款</Button>
        </Space>
      </div>
    </div>
  );
}

/* ============================ 屏 6 · 产品库（产品核价表） ============================ */
/* 参照用户另一系统「产品核价表」的列，去掉「总核价 / 总报价」两列。 */
interface ProdRow {
  key: number;
  code: string; // 产品货号
  partCount: number; // 子件数
  modDate: string; // 修改日期
  modBy: string; // 修改人
}
const PROD_DATA: ProdRow[] = [
  { key: 1, code: 'E73906', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 2, code: '110054', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 3, code: 'E73858', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 4, code: '711732', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 5, code: '71101', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 6, code: '9680', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
  { key: 7, code: '白色暴力熊', partCount: 1, modDate: '2026/6/18', modBy: '张霞' },
];

function Screen6Products() {
  const cols: ColumnsType<ProdRow> = [
    { title: '产品货号', dataIndex: 'code', width: 200, onHeaderCell: headCell(C.head), render: (v) => <b>{v}</b> },
    { title: '子件数', dataIndex: 'partCount', width: 120, align: 'center', onHeaderCell: headCell(C.head) },
    {
      title: '状态',
      key: 'status',
      width: 120,
      align: 'center',
      onHeaderCell: headCell(C.head),
      render: () => <Tag style={{ background: C.okSoft, color: C.ok, border: `1px solid ${C.ok}`, margin: 0 }}>已生效</Tag>,
    },
    { title: '修改日期', dataIndex: 'modDate', width: 150, onHeaderCell: headCell(C.head) },
    { title: '修改人', dataIndex: 'modBy', width: 120, onHeaderCell: headCell(C.head) },
    {
      title: '操作',
      key: 'op',
      width: 120,
      onHeaderCell: headCell(C.head),
      render: () => (
        <Space size={12}>
          <a style={{ color: C.blue }}>查看</a>
          <a style={{ color: C.bad }}>作废</a>
        </Space>
      ),
    },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={h2}>产品核价表（产品库）</h2>
          <div style={sub}>产品主数据地基 · 一个货号一行 · 核价录入时「货号 / 款」从这里选，不许手打。</div>
        </div>
        <Button icon={<ImportOutlined />} style={{ marginLeft: 'auto', borderColor: C.blue, color: C.blue }}>
          导入产品
        </Button>
        <Button type="primary" icon={<PlusOutlined />}>
          新建产品
        </Button>
      </div>

      {/* 搜索 + 回收站 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined style={{ color: C.inkSoft }} />} placeholder="搜货号" allowClear style={{ width: 320 }} />
        <Button icon={<RestOutlined />} style={{ marginLeft: 'auto' }}>
          回收站 (0)
        </Button>
      </div>

      <Table<ProdRow>
        rowKey="key"
        size="small"
        bordered
        columns={cols}
        dataSource={PROD_DATA}
        pagination={false}
        onRow={(_, i) => ({ style: { background: (i ?? 0) % 2 === 1 ? C.zebra : undefined } })}
      />
    </div>
  );
}

/* ================================ 预览页外壳 ================================ */
type ScreenKey = '综合评价' | '核价对比' | '录入' | '产品库';

export default function PreviewPage() {
  const [screen, setScreen] = useState<ScreenKey>('综合评价');
  const [costTab, setCostTab] = useState('按产品看'); // 核价对比内部 Tab（提到顶层，返回时不丢）
  const [detailTitle, setDetailTitle] = useState<string | null>(null); // 明细页（跳转）

  const body = (() => {
    if (detailTitle) return <Screen4Detail title={detailTitle} onBack={() => setDetailTitle(null)} />;
    switch (screen) {
      case '综合评价':
        return <Screen1Eval />;
      case '核价对比':
        return <CostCompareModule tab={costTab} setTab={setCostTab} onOpenDetail={setDetailTitle} />;
      case '录入':
        return <Screen5Entry />;
      case '产品库':
        return <Screen6Products />;
    }
  })();

  return (
    <div style={{ minHeight: '100vh', background: C.pageBg, padding: '0 0 60px' }}>
      {/* 顶栏 */}
      <div
        style={{
          background: '#fff',
          borderBottom: `1px solid ${C.line}`,
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          position: 'sticky',
          top: 0,
          zIndex: 20,
          flexWrap: 'wrap',
          boxShadow: '0 1px 6px rgba(31,99,216,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${C.blue}, #5b9bff)`,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
            }}
          >
            核
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>模块一 · UI 预览</div>
            <div style={{ fontSize: 11, color: C.inkSoft }}>静态假数据 · 仅供确认布局</div>
          </div>
        </div>
        <Segmented
          value={screen}
          onChange={(v) => {
            setScreen(v as ScreenKey);
            setDetailTitle(null);
          }}
          options={['综合评价', '核价对比', '录入', '产品库']}
          style={{ marginLeft: 8 }}
        />
      </div>

      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 24px 0' }}>{body}</div>
    </div>
  );
}
