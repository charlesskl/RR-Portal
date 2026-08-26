'use client';

import { useMemo, useState } from 'react';

const initialRows = [
  { factory: '兴信B', workshop: '装配', name: '视觉贴标机', qty: 51, unitPrice: 43089, investment: 252.59, maOrder: 8660, orders: 4813.52, saved: 683.04, balance: 358.20, unitSave: .1419, update: '08-15' },
  { factory: '兴信B', workshop: '装配', name: 'NFC检测机', qty: 1, unitPrice: 12000, investment: 1.38, maOrder: 0, orders: 7.2, saved: 0.05, balance: -1.38, unitSave: .007, update: '08-15' },
  { factory: '兴信A', workshop: '装配', name: '视觉贴标机-单机', qty: 2, unitPrice: 32000, investment: 7.36, maOrder: 1324, orders: 41.52, saved: 1.79, balance: -5.57, unitSave: .043, update: '08-15' },
  { factory: '兴信A', workshop: '装配', name: '称重机', qty: 15, unitPrice: 18800, investment: 32.41, maOrder: 22141, orders: 4235.53, saved: 21.18, balance: -11.24, unitSave: .005, update: '08-15' },
  { factory: '兴信A', workshop: '喷油', name: 'UV蜘蛛手', qty: 4, unitPrice: 33000, investment: 15.17, maOrder: 700, orders: 505.52, saved: 48.02, balance: 32.85, unitSave: .095, update: '08-15' },
  { factory: '华登', workshop: '喷油', name: '6轴喷油机器人', qty: 1, unitPrice: 68000, investment: 7.82, maOrder: 500, orders: 259.56, saved: 16.87, balance: 9.06, unitSave: .065, update: '08-15' },
  { factory: '华嘉', workshop: '装配', name: '富格乐飞机盒拆盒机', qty: 3, unitPrice: 68500, investment: 23.62, maOrder: 0, orders: 255.00, saved: 20.91, balance: -2.71, unitSave: .082, update: '08-15' },
  { factory: '华嘉', workshop: '装配', name: '富格乐飞机盒贴标机', qty: 5, unitPrice: 36800, investment: 21.15, maOrder: 0, orders: 353.28, saved: 17.31, balance: -3.84, unitSave: .049, update: '08-15' },
  { factory: '湖南', workshop: '装配', name: '自动拆盒粘胶装盒封盒装卡片一体机', qty: 1, unitPrice: 206000, investment: 23.68, maOrder: 0, orders: 12.11, saved: 2.06, balance: -21.62, unitSave: .17, update: '08-15' },
  { factory: '湖南', workshop: '装配', name: '半自动四方形贴标机', qty: 2, unitPrice: 14000, investment: 3.22, maOrder: 0, orders: 52.87, saved: 13.66, balance: 10.44, unitSave: .2583, update: '08-15' },
  { factory: '河源', workshop: '装配', name: '套标+收缩一体机', qty: 1, unitPrice: 95000, investment: 10.92, maOrder: 0, orders: 0, saved: 0, balance: -10.92, unitSave: .17, update: '08-15' },
  { factory: '河源', workshop: '装配', name: '立式包装机', qty: 2, unitPrice: 32500, investment: 3.74, maOrder: 0, orders: 0, saved: 0, balance: -3.74, unitSave: .04, update: '08-15' },
  { factory: '河源', workshop: '装配', name: '半自动圆形贴标机', qty: 2, unitPrice: 2500, investment: .29, maOrder: 0, orders: 0, saved: 0, balance: -.29, unitSave: .06, update: '08-15' },
  { factory: '河源', workshop: '装配', name: '点胶机', qty: 2, unitPrice: 33000, investment: 3.79, maOrder: 0, orders: 0, saved: 0, balance: -3.79, unitSave: .34, update: '08-15' },
];

export default function Home() {
  const [activeView, setActiveView] = useState<'dashboard' | 'ledger' | 'entry' | 'history' | 'users'>('dashboard');
  const [factory, setFactory] = useState('全部部门');
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [entryDepartment, setEntryDepartment] = useState('兴信B');
  const [entryWorkshop, setEntryWorkshop] = useState('装配');
  const [showEntry, setShowEntry] = useState(false);
  const [showEquipment, setShowEquipment] = useState(false);
  const [equipmentDialog, setEquipmentDialog] = useState<{ mode: 'view' | 'edit'; row: typeof initialRows[number] } | null>(null);
  const [showUser, setShowUser] = useState(false);
  const [users, setUsers] = useState([
    { id: 1, name: '陈管理员', account: 'wendyxiaowen5@gmail.com', role: '系统管理员', department: '全部部门', workshop: '全部车间', status: true },
    { id: 2, name: '兴信A负责人', account: 'xingxina@company.com', role: '部门负责人', department: '兴信A', workshop: '全部车间', status: true },
    { id: 3, name: '华嘉装配车间', account: 'huajia-zp@company.com', role: '车间录入员', department: '华嘉', workshop: '装配', status: true },
    { id: 4, name: '河源装配车间', account: 'heyuan-zp@company.com', role: '车间录入员', department: '河源', workshop: '装配', status: false },
  ]);
  const [records, setRecords] = useState([
    { date: '2026-08-15', factory: '华嘉', workshop: '装配', equipment: '富格乐飞机盒贴标机', line: '2号机', production: 18600, operator: '部门负责人', note: '日常产量上报' },
    { date: '2026-08-15', factory: '湖南', workshop: '装配', equipment: '半自动四方形贴标机', line: '1号线', production: 12400, operator: '部门负责人', note: 'SkyCastle四方盒' },
    { date: '2026-08-14', factory: '兴信B', workshop: '装配', equipment: 'NFC检测机', line: '1号线', production: 30000, operator: '部门负责人', note: '数据已同步' },
  ]);
  const visible = useMemo(() => rows.filter((r) => (factory === '全部部门' || r.factory === factory) && `${r.factory}${r.workshop}${r.name}`.includes(query)), [factory, query, rows]);
  const entryRows = rows.filter((row) => row.factory === entryDepartment && row.workshop === entryWorkshop);
  const total = visible.reduce((sum, r) => sum + r.investment, 0);
  const recovered = visible.reduce((sum, r) => sum + r.saved, 0);
  function submitEntry(formData: FormData) {
    const name = String(formData.get('equipment'));
    const department = String(formData.get('department'));
    const workshop = String(formData.get('workshop'));
    const production = Number(formData.get('production')) || 0;
    const equipment = rows.find((row) => row.name === name && row.factory === department && row.workshop === workshop);
    setRows((current) => current.map((row) => row === equipment ? { ...row, orders: row.orders + production / 10000, saved: row.saved + production * row.unitSave / 10000, balance: row.balance + production * row.unitSave / 10000, update: '今日' } : row));
    setRecords((current) => [{ date: String(formData.get('date')), factory: department, workshop, equipment: name, line: String(formData.get('line') || '未填写'), production, operator: '当前负责人', note: String(formData.get('note') || '日常产量上报') }, ...current]);
    setShowEntry(false);
    setActiveView('history');
  }
  function exportRecords() {
    const escapeCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = ['日期', '部门', '车间', '设备名称', '开机线/机台', '生产数量（个）', '上报人', '备注'];
    const csvRows = records.map((record) => [record.date, record.factory, record.workshop, record.equipment, record.line, record.production, record.operator, record.note]);
    const csv = [header, ...csvRows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `生产数据更新记录-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function exportDashboard() {
    const escapeHtml = (value: string | number) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const headers = ['部门', '车间', '设备名称', '数量（台）', '设备单价（RMB/台）', '投资金额（万HKD）', '实际生产数（万）', '已节省成本（万）', '当前结余（万）', 'MA订单（万）', '更新时间'];
    const body = visible.map((row) => [row.factory, row.workshop, row.name, row.qty, row.unitPrice, row.investment.toFixed(2), row.orders, row.saved.toFixed(2), row.balance.toFixed(2), row.maOrder, row.update]);
    const table = `<table border="1"><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const html = `<html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{padding:8px;white-space:nowrap}th{background:#e7f3f0}</style></head><body><h2>自动化设备投资成本结余统计</h2><p>部门范围：${escapeHtml(factory)}</p>${table}</body></html>`;
    const url = URL.createObjectURL(new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `自动化设备结余统计-${factory}-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function submitUser(formData: FormData) {
    setUsers((current) => [...current, { id: Date.now(), name: String(formData.get('name')), account: String(formData.get('account')), role: String(formData.get('role')), department: String(formData.get('department')), workshop: String(formData.get('workshop')), status: true }]);
    setShowUser(false);
  }
  function submitEquipment(formData: FormData) {
    const department = String(formData.get('department'));
    const quantity = Number(formData.get('quantity')) || 1;
    const unitPrice = Number(formData.get('unitPrice')) || 0;
    const manualPrice = Number(formData.get('manualPrice')) || 0;
    const machinePrice = Number(formData.get('machinePrice')) || 0;
    const maOrder = Number(formData.get('maOrder')) || 0;
    const orders = Number(formData.get('orders')) || 0;
    const unitSave = Math.max(0, manualPrice - machinePrice);
    const investment = unitPrice * quantity / .87 / 10000;
    const saved = orders * unitSave;
    setRows((current) => [...current, { factory: department, workshop: String(formData.get('workshop')), name: String(formData.get('name')), qty: quantity, unitPrice, investment, maOrder, orders, saved, balance: saved - investment, unitSave, update: '今日' }]);
    setFactory(department);
    setQuery('');
    setShowEquipment(false);
  }
  function updateEquipment(formData: FormData) {
    if (!equipmentDialog) return;
    const quantity = Number(formData.get('quantity')) || 1;
    const unitPrice = Number(formData.get('unitPrice')) || 0;
    const maOrder = Number(formData.get('maOrder')) || 0;
    const orders = Number(formData.get('orders')) || 0;
    const unitSave = Number(formData.get('unitSave')) || 0;
    const investment = unitPrice * quantity / .87 / 10000;
    const saved = orders * unitSave;
    const updated = { ...equipmentDialog.row, factory: String(formData.get('department')), workshop: String(formData.get('workshop')), name: String(formData.get('name')), qty: quantity, unitPrice, investment, maOrder, orders, saved, balance: saved - investment, unitSave, update: '今日' };
    setRows((current) => current.map((row) => row === equipmentDialog.row ? updated : row));
    setEquipmentDialog(null);
  }

  const titles = { dashboard: '投资成本结余统计', ledger: '自动化设备台账', entry: '生产数据录入', history: '数据更新记录', users: '用户与权限管理' };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><div><strong>自动化设备统计</strong><small>Automation</small></div></div>
        <nav><button className={activeView === 'dashboard' ? 'active' : ''} onClick={() => setActiveView('dashboard')}><span>▦</span>结余看板</button><button className={activeView === 'ledger' ? 'active' : ''} onClick={() => setActiveView('ledger')}><span>▤</span>设备台账</button><button className={activeView === 'entry' ? 'active' : ''} onClick={() => setActiveView('entry')}><span>✚</span>生产数据录入</button><button className={activeView === 'history' ? 'active' : ''} onClick={() => setActiveView('history')}><span>◷</span>更新记录</button><div className="nav-divider"/><button className={activeView === 'users' ? 'active' : ''} onClick={() => setActiveView('users')}><span>◉</span>用户管理</button></nav>
        <div className="side-note"><small>数据截止</small><strong>2026年8月15日</strong><span>已同步 16 张明细表</span></div>
      </aside>
      <section className="content">
        <header className="topbar"><div><p>生产自动化设备</p><h1>{titles[activeView]}</h1></div><div className="user"><span>W</span><div><strong>管理员</strong><small>管理全部数据</small></div></div></header>
        {activeView === 'dashboard' && <>
        <div className="toolbar"><div className="segmented">{['全部部门','兴信A','兴信B','华登','华嘉','湖南','河源'].map((item) => <button key={item} className={factory === item ? 'selected' : ''} onClick={() => setFactory(item)}>{item}</button>)}</div><div className="toolbar-actions"><button className="outline-button" onClick={exportDashboard}>导出Excel</button><button className="primary" onClick={() => setShowEntry(true)}>+  录入今日生产数据</button></div></div>
        <section className="metrics">
          <article><div className="metric-icon ink">¥</div><p>机器投资总额</p><strong>{total.toFixed(1)}<em>万 HKD</em></strong><small>按 Excel 汇率 0.87 折算</small></article>
          <article><div className="metric-icon jade">↗</div><p>已节省成本</p><strong>{recovered.toFixed(1)}<em>万 HKD</em></strong><small>来自实际生产数</small></article>
          <article><div className="metric-icon amber">◔</div><p>投资回收率</p><strong>{total ? Math.round(recovered / total * 100) : 0}<em>%</em></strong><small>{visible.filter(r => r.balance >= 0).length} 个设备项目已回本</small></article>
          <article><div className="metric-icon blue">▦</div><p>统计设备</p><strong>{visible.reduce((sum, r) => sum + r.qty, 0)}<em>台</em></strong><small>{new Set(visible.map(r => r.factory)).size} 个部门·{new Set(visible.map(r => r.workshop)).size} 个车间</small></article>
        </section>
        <section className="table-card">
          <div className="table-title"><div><h2>设备投资回收明细</h2><p>各部门最新上报数据与结余计算</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索设备、部门…" /></div>
          <div className="table-wrap"><table><thead><tr><th>部门 / 车间</th><th>设备名称</th><th>数量</th><th>设备单价</th><th>投资金额</th><th>实际生产数</th><th>已节省成本</th><th>当前结余</th><th>更新</th></tr></thead><tbody>{visible.map((row) => <tr key={`${row.factory}-${row.name}`}><td><strong>{row.factory}</strong><small>{row.workshop}</small></td><td><strong>{row.name}</strong></td><td>{row.qty} 台</td><td><strong>¥{row.unitPrice.toLocaleString()}</strong><small>RMB/台</small></td><td>{row.investment.toFixed(2)} 万</td><td>{row.orders.toLocaleString()} 万</td><td>{row.saved.toFixed(2)} 万</td><td><span className={row.balance >= 0 ? 'status positive' : 'status negative'}>{row.balance >= 0 ? '已盈利' : '待回收'} {Math.abs(row.balance).toFixed(2)} 万</span></td><td>{row.update}</td></tr>)}</tbody></table></div>
          <footer>显示 {visible.length} 条设备记录 <span><button>‹</button><button className="page">1</button><button>›</button></span></footer>
        </section>
        </>}
        {activeView === 'ledger' && <section className="module-view"><div className="module-toolbar"><div><h2>设备台账</h2><p>统一管理所有部门的设备信息与成本参数</p></div><div className="module-actions"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索设备…"/><button className="primary" onClick={() => setShowEquipment(true)}>+  新增设备</button></div></div><div className="filter-row">{['全部部门','兴信A','兴信B','华登','华嘉','湖南','河源'].map((item) => <button key={item} className={factory === item ? 'selected' : ''} onClick={() => setFactory(item)}>{item}</button>)}</div><div className="table-card ledger-table"><div className="table-wrap"><table><thead><tr><th>部门 / 车间</th><th>设备名称</th><th>设备数量</th><th>总投资 HKD</th><th>节省单价</th><th>实际生产数</th><th>回收状态</th><th>MA订单（万）</th><th>操作</th></tr></thead><tbody>{visible.map((row) => <tr key={`ledger-${row.factory}-${row.name}`}><td><strong>{row.factory}</strong><small>{row.workshop}</small></td><td><strong>{row.name}</strong><small>编号：{row.factory}-{row.qty.toString().padStart(2,'0')}</small></td><td>{row.qty} 台</td><td>{row.investment.toFixed(2)} 万</td><td>{row.unitSave.toFixed(4)} RMB/件</td><td>{row.orders.toLocaleString()} 万</td><td><span className={row.balance >= 0 ? 'status positive' : 'status negative'}>{row.balance >= 0 ? '已回本' : '回收中'}</span></td><td>{row.maOrder.toLocaleString()} 万</td><td><button className="text-action" onClick={() => setEquipmentDialog({ mode: 'view', row })}>查看</button><button className="text-action" onClick={() => setEquipmentDialog({ mode: 'edit', row })}>编辑</button></td></tr>)}</tbody></table></div><footer>共 {visible.length} 条设备记录</footer></div></section>}
        {activeView === 'entry' && <section className="module-view entry-page"><div className="module-toolbar"><div><h2>录入生产数据</h2><p>部门负责人每日填写，提交后自动计算设备投资结余</p></div></div><div className="entry-layout"><form className="entry-panel" action={submitEntry}><div className="entry-section"><span>01</span><div><h3>选择设备</h3><p>选择本次生产所使用的设备</p></div></div><div className="form-grid"><label>部门<select name="department" value={entryDepartment} onChange={(e) => setEntryDepartment(e.target.value)} required>{['兴信A','兴信B','华登','华嘉','湖南','河源'].map(item => <option key={`entry-dept-${item}`}>{item}</option>)}</select></label><label>车间<select name="workshop" value={entryWorkshop} onChange={(e) => setEntryWorkshop(e.target.value)} required><option>装配</option><option>喷油</option><option>啤机</option></select></label></div><label>设备<select name="equipment" required>{entryRows.map((r) => <option key={`page-${r.factory}-${r.workshop}-${r.name}`}>{r.name}</option>)}</select></label><div className="form-grid"><label>生产日期<input name="date" type="date" defaultValue="2026-08-26" required /></label><label>开机线 / 机台<input name="line" placeholder="例：2号机" /></label></div><div className="entry-section second"><span>02</span><div><h3>填写产量</h3><p>填写当日实际完成的合格生产数</p></div></div><label>今日生产数量（个）<input name="production" type="number" min="1" placeholder="请输入实际产量" required /></label><label>备注<textarea name="note" placeholder="可填写产品、异常、停机等情况" /></label><div className="form-submit"><button type="reset">重置</button><button className="primary" type="submit">提交生产数据</button></div></form><aside className="calculation-card"><span className="calc-icon">∑</span><h3>自动计算说明</h3><p>系统会根据设备台账中的节省单价自动计算：</p><div><small>已节省成本</small><strong>生产数 ×（原人工单价 − 机器工单价）</strong></div><div><small>当前结余</small><strong>累计节省成本 − 设备投资金额</strong></div><p className="safe-note">提交后可在“更新记录”中查看本次上报。</p></aside></div></section>}
        {activeView === 'history' && <section className="module-view"><div className="module-toolbar"><div><h2>更新记录</h2><p>查看各部门的生产数据上报和修改痕迹</p></div><button className="outline-button" onClick={exportRecords}>导出记录</button></div><div className="history-summary"><div><strong>{records.length}</strong><span>近期更新</span></div><div><strong>{new Set(records.map(r => r.factory)).size}</strong><span>涉及部门</span></div><div><strong>{records.reduce((s,r) => s + r.production, 0).toLocaleString()}</strong><span>累计上报产量</span></div></div><div className="history-list">{records.map((record, index) => <article key={`${record.date}-${record.equipment}-${index}`}><div className="history-date"><strong>{record.date.slice(8)}</strong><small>{record.date.slice(0,7)}</small></div><div className="history-dot"/><div className="history-main"><div><span className="dept-tag">{record.factory} · {record.workshop}</span><strong>{record.equipment}</strong></div><p>{record.line} · 生产 <b>{record.production.toLocaleString()}</b> 个 · {record.note}</p><small>由 {record.operator} 上报</small></div><span className="history-status">已计入汇总</span></article>)}</div></section>}
        {activeView === 'users' && <section className="module-view users-view"><div className="module-toolbar"><div><h2>用户与权限</h2><p>按部门和车间限定数据查看、录入与管理范围</p></div><button className="primary" onClick={() => setShowUser(true)}>+  新增用户</button></div><div className="permission-cards"><article><span className="permission-icon admin">★</span><div><strong>系统管理员</strong><p>查看和管理全部部门、车间及用户</p></div></article><article><span className="permission-icon manager">▣</span><div><strong>部门负责人</strong><p>查看本部门全部车间，可录入和审核</p></div></article><article><span className="permission-icon operator">✚</span><div><strong>车间录入员</strong><p>仅查看并录入指定部门与车间数据</p></div></article></div><div className="table-card user-table"><div className="table-title"><div><h2>用户列表</h2><p>共 {users.length} 个用户，{users.filter(u => u.status).length} 个已启用</p></div><input placeholder="搜索姓名、账号…" /></div><div className="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>授权部门</th><th>授权车间</th><th>数据权限</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><div className="user-cell"><span>{item.name.slice(0,1)}</span><div><strong>{item.name}</strong><small>{item.account}</small></div></div></td><td><span className={`role-badge ${item.role === '系统管理员' ? 'role-admin' : item.role === '部门负责人' ? 'role-manager' : ''}`}>{item.role}</span></td><td><strong>{item.department}</strong></td><td>{item.workshop}</td><td><span className="scope-text">{item.role === '系统管理员' ? '查看·录入·管理' : item.role === '部门负责人' ? '查看·录入·审核' : '查看·录入'}</span></td><td><button className={`switch ${item.status ? 'on' : ''}`} aria-label={`${item.name}账号状态`} onClick={() => setUsers(current => current.map(user => user.id === item.id ? {...user, status: !user.status} : user))}><span/></button></td><td><button className="text-action">编辑权限</button></td></tr>)}</tbody></table></div></div></section>}
        {showEntry && <div className="modal-backdrop" onMouseDown={() => setShowEntry(false)}><form className="entry-modal" action={submitEntry} onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><small>部门日常上报</small><h2>录入今日生产数据</h2></div><button type="button" onClick={() => setShowEntry(false)}>×</button></div><div className="form-grid"><label>部门<select name="department" value={entryDepartment} onChange={(e) => setEntryDepartment(e.target.value)} required>{['兴信A','兴信B','华登','华嘉','湖南','河源'].map(item => <option key={`modal-dept-${item}`}>{item}</option>)}</select></label><label>车间<select name="workshop" value={entryWorkshop} onChange={(e) => setEntryWorkshop(e.target.value)} required><option>装配</option><option>喷油</option><option>啤机</option></select></label></div><label>设备<select name="equipment" required>{entryRows.map((r) => <option key={`modal-${r.factory}-${r.workshop}-${r.name}`}>{r.name}</option>)}</select></label><div className="form-grid"><label>生产日期<input name="date" type="date" defaultValue="2026-08-26" required /></label><label>开机线 / 机台<input name="line" placeholder="例：2号机" /></label></div><label>今日生产数量（个）<input name="production" type="number" min="1" placeholder="请输入实际产量" required /></label><label>备注<textarea name="note" placeholder="可填写产品、异常、停机等情况" /></label><div className="formula-note">提交后，系统会按该设备的“原人工单价 − 机器工单价”自动重算已节省成本和待回收结余。</div><div className="modal-actions"><button type="button" onClick={() => setShowEntry(false)}>取消</button><button className="primary" type="submit">确认提交</button></div></form></div>}
        {showUser && <div className="modal-backdrop" onMouseDown={() => setShowUser(false)}><form className="entry-modal user-modal" action={submitUser} onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><small>账号授权</small><h2>新增用户</h2></div><button type="button" onClick={() => setShowUser(false)}>×</button></div><div className="form-grid"><label>姓名<input name="name" placeholder="输入用户姓名" required /></label><label>登录账号<input name="account" type="email" placeholder="name@company.com" required /></label></div><label>用户角色<select name="role" required><option>部门负责人</option><option>车间录入员</option><option>系统管理员</option></select></label><div className="form-grid"><label>授权部门<select name="department" required>{['全部部门','兴信A','兴信B','华登','华嘉','湖南','河源'].map(item => <option key={`user-${item}`}>{item}</option>)}</select></label><label>授权车间<select name="workshop" required><option>全部车间</option><option>装配</option><option>喷油</option><option>啤机</option></select></label></div><div className="permission-tip"><strong>权限规则</strong><span>用户登录后，系统只显示上述部门与车间的设备、产量和更新记录。</span></div><div className="modal-actions"><button type="button" onClick={() => setShowUser(false)}>取消</button><button className="primary" type="submit">创建用户</button></div></form></div>}
        {equipmentDialog?.mode === 'view' && <div className="modal-backdrop" onMouseDown={() => setEquipmentDialog(null)}><article className="entry-modal equipment-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><small>设备详情</small><h2>{equipmentDialog.row.name}</h2></div><button type="button" onClick={() => setEquipmentDialog(null)}>×</button></div><div className="detail-grid"><div><small>部门 / 车间</small><strong>{equipmentDialog.row.factory} · {equipmentDialog.row.workshop}</strong></div><div><small>设备数量</small><strong>{equipmentDialog.row.qty} 台</strong></div><div><small>设备单价</small><strong>¥{equipmentDialog.row.unitPrice.toLocaleString()} RMB/台</strong></div><div><small>总投资</small><strong>{equipmentDialog.row.investment.toFixed(2)} 万 HKD</strong></div><div><small>节省单价</small><strong>{equipmentDialog.row.unitSave.toFixed(4)} RMB/件</strong></div><div><small>实际生产数</small><strong>{equipmentDialog.row.orders.toLocaleString()} 万</strong></div><div><small>MA订单</small><strong>{equipmentDialog.row.maOrder.toLocaleString()} 万</strong></div><div><small>当前结余</small><strong className={equipmentDialog.row.balance >= 0 ? 'detail-positive' : 'detail-negative'}>{equipmentDialog.row.balance >= 0 ? '已盈利' : '待回收'} {Math.abs(equipmentDialog.row.balance).toFixed(2)} 万</strong></div></div><div className="modal-actions"><button type="button" onClick={() => setEquipmentDialog(null)}>关闭</button><button className="primary" type="button" onClick={() => setEquipmentDialog({ mode: 'edit', row: equipmentDialog.row })}>编辑设备</button></div></article></div>}
        {equipmentDialog?.mode === 'edit' && <div className="modal-backdrop" onMouseDown={() => setEquipmentDialog(null)}><form className="entry-modal equipment-modal" action={updateEquipment} onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><small>设备台账</small><h2>编辑设备</h2></div><button type="button" onClick={() => setEquipmentDialog(null)}>×</button></div><div className="form-grid"><label>所属部门<select name="department" defaultValue={equipmentDialog.row.factory} required>{['兴信A','兴信B','华登','华嘉','湖南','河源'].map(item => <option key={`edit-${item}`}>{item}</option>)}</select></label><label>所属车间<select name="workshop" defaultValue={equipmentDialog.row.workshop} required><option>装配</option><option>喷油</option><option>啤机</option></select></label></div><label>设备名称<input name="name" defaultValue={equipmentDialog.row.name} required /></label><div className="form-grid"><label>设备数量（台）<input name="quantity" type="number" min="1" defaultValue={equipmentDialog.row.qty} required /></label><label>设备单价（RMB/台）<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={equipmentDialog.row.unitPrice} required /></label></div><div className="form-grid"><label>节省单价（RMB/件）<input name="unitSave" type="number" min="0" step="0.0001" defaultValue={equipmentDialog.row.unitSave} required /></label><label>实际生产数（万）<input name="orders" type="number" min="0" step="0.0001" defaultValue={equipmentDialog.row.orders} required /></label></div><label>MA订单（万）<input name="maOrder" type="number" min="0" step="0.0001" defaultValue={equipmentDialog.row.maOrder} /></label><div className="formula-note">保存后，系统会自动重算总投资、已节省成本和当前结余。</div><div className="modal-actions"><button type="button" onClick={() => setEquipmentDialog(null)}>取消</button><button className="primary" type="submit">保存修改</button></div></form></div>}
        {showEquipment && <div className="modal-backdrop" onMouseDown={() => setShowEquipment(false)}><form className="entry-modal equipment-modal" action={submitEquipment} onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><small>设备台账</small><h2>新增自动化设备</h2></div><button type="button" onClick={() => setShowEquipment(false)}>×</button></div><div className="form-grid"><label>所属部门<select name="department" required>{['兴信A','兴信B','华登','华嘉','湖南','河源'].map(item => <option key={`equipment-${item}`}>{item}</option>)}</select></label><label>所属车间<select name="workshop" required><option>装配</option><option>喷油</option><option>啤机</option></select></label></div><label>设备名称<input name="name" placeholder="请输入设备名称" required /></label><div className="form-grid"><label>设备数量（台）<input name="quantity" type="number" min="1" defaultValue="1" required /></label><label>设备单价（RMB/台）<input name="unitPrice" type="number" min="0" step="0.01" placeholder="请输入设备单价" required /></label></div><div className="form-grid"><label>原人工单价（RMB/件）<input name="manualPrice" type="number" min="0" step="0.0001" placeholder="请输入人工单价" required /></label><label>机器工单价（RMB/件）<input name="machinePrice" type="number" min="0" step="0.0001" placeholder="请输入机器单价" required /></label></div><div className="form-grid"><label>MA订单（万）<input name="maOrder" type="number" min="0" step="0.0001" defaultValue="0" /></label><label>已累计生产数（万）<input name="orders" type="number" min="0" step="0.0001" defaultValue="0" /></label></div><div className="formula-note">系统会按汇率 0.87 自动换算 HKD 总投资，并用人工与机器单价差计算节省成本和初始结余。</div><div className="modal-actions"><button type="button" onClick={() => setShowEquipment(false)}>取消</button><button className="primary" type="submit">保存设备</button></div></form></div>}
      </section>
    </main>
  );
}
