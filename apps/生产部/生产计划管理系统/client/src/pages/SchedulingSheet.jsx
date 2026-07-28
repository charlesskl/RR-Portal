import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button, Space, message, Modal, Table, Tag, Alert, Popconfirm, Select } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined, DeleteOutlined, BranchesOutlined, SearchOutlined, SaveOutlined, CalendarOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import axios from 'axios';
import LuckysheetEditor from './LuckysheetEditor';

const STATUS_MAP = {
  active: 'active',
  completed: 'completed',
  cancel1: 'cancelled',
  outsource: 'outsource',
  cancel2: 'cancelled',
};

const HEADER_FIELD_MAP = {
  '主管': 'supervisor',
  '拉名': 'line_name',
  '人数': 'worker_count',
  '厂区': 'factory_area',
  '客名': 'client',
  '来单日期': 'order_date',
  '接单期': 'order_date',
  '接单日期': 'order_date',
  '香港接单日期': 'order_date',
  '第三方客户名称': 'third_party',
  '国家': 'country',
  '走货国家': 'country',
  '合同': 'contract',
  'ZURU PO NO#': 'contract',
  'PO号': 'contract',
  'PO NO#': 'contract',
  '货号': 'item_no',
  'ITEM#': 'item_no',
  '系统货号': 'item_no',
  '产品名称': 'product_name',
  '货品名称': 'product_name',
  '中文名': 'product_name',
  '版本': 'version',
  '数量': 'quantity',
  'PO数量(只)': 'quantity',
  'PO数量(pcs)': 'quantity',
  '做工名称': 'work_type',
  '生产数': 'production_count',
  '生产进度': 'production_progress',
  '胶件复期': 'plastic_due',
  '来料复期': 'material_due',
  '纸箱复期': 'carton_due',
  '纸箱回复': 'carton_due',
  '包材复期': 'packaging_due',
  '客贴纸': 'sticker',
  '贴纸': 'sticker',
  '外箱贴纸': 'sticker',
  '上拉日期': 'start_date',
  '上拉期': 'start_date',
  '完成日期': 'complete_date',
  '完成期': 'complete_date',
  '走货期': 'ship_date',
  '计划出货期': 'ship_date',
  '客PO期': 'ship_date',
  '验货期': 'ship_date',
  '计划验货期': 'ship_date',
  '目标数生产时间': 'target_time',
  '每天目标数': 'daily_target',
  '天数': 'days',
  '行Q期': 'inspection_date',
  '月份': 'month',
  '单价USD': 'unit_price',
  '金额USD': 'process_value',
};

// 清理表头：去掉换行符、多余空格
function cleanHeader(h) {
  return h.replace(/[\n\r\u000a]/g, '').replace(/\s+/g, '').trim();
}

// 构建清理后的映射表
const CLEAN_HEADER_MAP = {};
for (const [k, v] of Object.entries(HEADER_FIELD_MAP)) {
  CLEAN_HEADER_MAP[cleanHeader(k)] = v;
}

function mapRowToOrder(rowData) {
  const order = {};
  for (const [header, value] of Object.entries(rowData)) {
    const cleaned = cleanHeader(header);
    const field = HEADER_FIELD_MAP[header.trim()] || CLEAN_HEADER_MAP[cleaned];
    if (field) {
      const num = Number(value);
      // 日期类字段自动转换 Excel 序列号
      const DATE_FIELDS = ['order_date', 'ship_date', 'inspection_date', 'start_date', 'complete_date', 'plastic_due', 'material_due', 'carton_due', 'packaging_due'];
      if (!isNaN(num) && num > 40000 && num < 60000 && DATE_FIELDS.includes(field)) {
        const date = new Date((num - 25569) * 86400 * 1000);
        order[field] = date.toISOString().split('T')[0];
      } else {
        order[field] = value;
      }
    }
  }
  return order;
}

// 从一行 data 里解析「货号」：优先级 货号 > ITEM# > 系统货号，取第一个非空。
// 不能直接用 mapRowToOrder.item_no —— 它遍历表头时「系统货号」会覆盖「ITEM#」，
// 导致同一 ITEM# 的行（一个有系统货号列、一个没有）算出不同货号。
function resolveItemNo(data) {
  const d = data || {};
  const buckets = { '货号': '', 'ITEM#': '', '系统货号': '' };
  for (const k of Object.keys(d)) {
    const ck = cleanHeader(k);
    if (ck in buckets && !buckets[ck]) {
      const val = d[k] == null ? '' : String(d[k]).trim();
      if (val) buckets[ck] = val;
    }
  }
  return buckets['货号'] || buckets['ITEM#'] || buckets['系统货号'] || '';
}

// 从预览行取货号（用于做工 / 拉 映射的 key）
function getItemNo(r) {
  return resolveItemNo(r.data || {});
}

// 货号 key：用完整货号（去空格），与后端 getItemGroup 一致
function itemGroup(itemNo) {
  if (itemNo == null || String(itemNo).trim() === '') return 'unknown';
  return String(itemNo).trim();
}

const SCHEDULE_HINT_COLORS = {
  danger: '#FFE1E1',
  warning: '#FFEFD6',
  tight: '#FFF7CC',
  ok: '#DFF5E1',
  missing: '#F0F0F0',
};

function localISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function parseScheduleDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (m) return new Date(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (m) return new Date(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]));
  const n = Number(s);
  if (!Number.isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date((n - 25569) * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return null;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a, b) {
  const aa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((aa - bb) / 86400000);
}

function shortDate(date) {
  if (!date) return '-';
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function buildScheduleSuggestions(rows) {
  const today = new Date();
  const lineEndMap = new Map();
  return rows.filter(row => row?.id).map((row, index) => {
    const qty = Number(row.quantity) || 0;
    const produced = Number(row.production_count) || 0;
    const remaining = qty > 0 ? Math.max(qty - produced, 0) || qty : 0;
    const dailyTarget = Number(row.daily_target) || 0;
    const daysFromField = Number(row.days) || 0;
    const requiredDays = dailyTarget > 0 && remaining > 0
      ? Math.max(1, Math.ceil(remaining / dailyTarget))
      : (daysFromField > 0 ? Math.max(1, Math.ceil(daysFromField)) : null);
    const targetDate = parseScheduleDate(row.complete_date) || parseScheduleDate(row.ship_date);
    const line = row.line_name || '未分拉';
    const base = {
      key: String(row.id) + '-' + index,
      id: row.id,
      lineName: line,
      itemNo: row.item_no || '',
      productName: row.product_name || '',
      quantity: qty,
      remaining,
      dailyTarget,
      requiredDays,
      targetDate,
      targetLabel: shortDate(targetDate),
    };
    if (!targetDate || !requiredDays) {
      return { ...base, canApply: false, risk: 'missing', riskText: !targetDate ? '缺目标日期' : '缺日产量', color: SCHEDULE_HINT_COLORS.missing };
    }
    let startDate = addDays(targetDate, -(requiredDays - 1));
    let adjusted = false;
    const prevEnd = lineEndMap.get(line);
    if (prevEnd && diffDays(startDate, prevEnd) <= 0) {
      startDate = addDays(prevEnd, 1);
      adjusted = true;
    }
    const endDate = addDays(startDate, requiredDays - 1);
    lineEndMap.set(line, endDate);
    const slipDays = diffDays(endDate, targetDate);
    const daysUntilStart = diffDays(startDate, today);
    let risk = 'ok';
    let riskText = '可排';
    if (slipDays > 0) {
      risk = 'danger';
      riskText = '晚 ' + slipDays + ' 天';
    } else if (adjusted) {
      risk = 'warning';
      riskText = '顺排挤占';
    } else if (daysUntilStart <= 1) {
      risk = 'tight';
      riskText = '临近上拉';
    }
    return {
      ...base,
      canApply: true,
      startDate,
      endDate,
      startISO: localISO(startDate),
      endISO: localISO(endDate),
      startLabel: shortDate(startDate),
      endLabel: shortDate(endDate),
      adjusted,
      slipDays,
      risk,
      riskText,
      color: SCHEDULE_HINT_COLORS[risk],
    };
  });
}

export default function SchedulingSheet({ workshop, tab, lineName = 'all', lines = [] }) {
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [importing, setImporting] = useState(false);
  const [newImportedIds, setNewImportedIds] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [uploadVisible, setUploadVisible] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [parsing, setParsing] = useState(false);
  // 导入预览里每行选的做工：{ [_key]: '成品' | '半成品' }
  const [previewWorkType, setPreviewWorkType] = useState({});
  // 导入预览里每行选的拉：{ [_key]: 拉编号 }
  const [previewLine, setPreviewLine] = useState({});
  // (货号组+做工)→拉 记忆映射，用于预览里预填拉
  const [itemLineMap, setItemLineMap] = useState({});
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [scheduleSuggestions, setScheduleSuggestions] = useState([]);
  const [scheduleApplying, setScheduleApplying] = useState(false);

  const scheduleHints = useMemo(() => {
    const hints = {};
    for (const s of scheduleSuggestions) {
      if (s.canApply) hints[s.id] = { bg: s.color };
    }
    return hints;
  }, [scheduleSuggestions]);

  // 按货号主编号计算数量合计
  const quantitySums = useMemo(() => {
    const sums = {};
    for (const r of allData) {
      const key = (r.item_no || '').match(/^(\d+)/)?.[1] || r.item_no || '';
      sums[key] = (sums[key] || 0) + (Number(r.quantity) || 0);
    }
    return sums;
  }, [allData]);

  // 按拉名和搜索过滤数据，并填充合计列
  const data = allData.filter(r => {
    if (lineName !== 'all' && r.line_name !== lineName) return false;
    if (searchText) {
      const keyword = searchText.toLowerCase();
      return Object.values(r).some(v =>
        v !== null && v !== undefined && String(v).toLowerCase().includes(keyword)
      );
    }
    return true;
  }).map(r => {
    const key = (r.item_no || '').match(/^(\d+)/)?.[1] || r.item_no || '';
    return { ...r, quantity_sum: quantitySums[key] || 0 };
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const status = STATUS_MAP[tab] || 'active';
      const res = await axios.get('/api/orders', { params: { workshop, status } });
      setAllData(res.data);
    } catch {
      message.error('加载数据失败');
    }
    setLoading(false);
  }, [workshop, tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 编辑器 ref — 父组件通过它触发 saveAll
  const editorRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving || !editorRef.current?.saveAll) return;
    setSaving(true);
    try {
      await editorRef.current.saveAll();
    } finally {
      setSaving(false);
    }
  };

  // 添加文件到待导入列表（支持拖拽和逐个选择）
  const addFiles = (files) => {
    const newFiles = Array.from(files).filter(f => /\.(xlsx|xls)$/i.test(f.name));
    setFileList(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      const uniqueNew = newFiles.filter(f => !existingNames.has(f.name));
      return [...prev, ...uniqueNew];
    });
  };

  const removeFile = (name) => {
    setFileList(prev => prev.filter(f => f.name !== name));
  };

  const handleStartImport = async () => {
    if (fileList.length === 0) {
      message.warning('请先添加文件');
      return;
    }
    setParsing(true);
    const formData = new FormData();
    fileList.forEach(f => formData.append('files', f));
    try {
      const res = await axios.post('/api/upload', formData);
      const results = res.data.results || [];
      if (results.length === 0) {
        message.info('未检测到带颜色标记的新订单');
        setParsing(false);
        return;
      }
      const withKeys = results.map((r, i) => ({ ...r, _key: i }));

      // 取货号→做工映射，给每行预填做工：半成品 sheet → 半成品；映射命中 → 映射值；否则 → 成品
      let wtMap = {};
      try {
        const mapRes = await axios.get('/api/orders/work-type-map');
        wtMap = mapRes.data || {};
      } catch { /* 映射拉取失败不阻断导入 */ }
      const wtDefaults = {};
      for (const r of withKeys) {
        if (r.sheet && r.sheet.includes('半成品')) {
          wtDefaults[r._key] = '半成品';
        } else {
          const itemNo = getItemNo(r);
          wtDefaults[r._key] = (itemNo && wtMap[itemNo]) || '成品';
        }
      }
      setPreviewWorkType(wtDefaults);

      // 取 (货号组+做工)→拉 记忆映射，预览里据此预填拉
      try {
        const lineMapRes = await axios.get('/api/orders/item-line-map', { params: { workshop } });
        setItemLineMap(lineMapRes.data || {});
      } catch { setItemLineMap({}); }
      setPreviewLine({});

      setPreviewData(withKeys);
      setSelectedRowKeys(withKeys.map(r => r._key));
      setUploadVisible(false);
      setFileList([]);
      setPreviewVisible(true);
    } catch (e) {
      message.error('上传解析失败: ' + (e.response?.data?.error || e.message));
    }
    setParsing(false);
  };

  const handleImport = async () => {
    const selected = previewData.filter(r => selectedRowKeys.includes(r._key));
    if (selected.length === 0) {
      message.warning('请至少选择一条订单');
      return;
    }
    setImporting(true);
    try {
      // 每条订单展开：成品 → 1 条；半成品 → 2 条（半成品 + 自动配对的成品）
      const orders = [];
      const lineEntries = [];   // 货号→拉 映射，导入后存盘
      for (const r of selected) {
        const base = mapRowToOrder(r.data);
        // 从服务端提取的客名
        if (!base.client && r.clientFromFile) {
          base.client = r.clientFromFile;
        }
        const itemNo = getItemNo(r);
        // 用统一口径的货号覆盖 mapRowToOrder 的结果（避免系统货号盖掉 ITEM#）
        if (itemNo) base.item_no = itemNo;
        const wt = previewWorkType[r._key] || '成品';
        const makeOrder = (work_type, line) => ({
          ...base,
          work_type,
          line_name: line || base.line_name || '',
          workshop,
          status: 'active',
          row_color: r.type === 'modified' ? 'blue' : (r.type === 'new' ? 'yellow' : null),
        });
        // 主订单：用预览里选的拉
        const mainLine = rowLine(r);
        orders.push(makeOrder(wt, mainLine));
        if (mainLine) lineEntries.push({ item_no: itemNo, work_type: wt, line: mainLine });
        // 半成品自动配一条一样的成品订单（拉用配对成品行选的）
        if (wt === '半成品') {
          const pairLine = rowLine({ ...r, _key: r._key + '__pair', _pairOf: r._key });
          orders.push(makeOrder('成品', pairLine));
          if (pairLine) lineEntries.push({ item_no: itemNo, work_type: '成品', line: pairLine });
        }
      }
      const res2 = await axios.post('/api/orders', orders);
      const ids = res2.data.ids || [];
      setNewImportedIds(prev => new Set([...prev, ...ids]));

      // 保存货号→做工映射，下次同货号自动带出
      const entries = [];
      const seen = new Set();
      for (const r of selected) {
        const itemNo = getItemNo(r);
        const wt = previewWorkType[r._key];
        if (itemNo && wt && !seen.has(itemNo)) {
          seen.add(itemNo);
          entries.push({ item_no: itemNo, work_type: wt });
        }
      }
      if (entries.length > 0) {
        axios.put('/api/orders/work-type-map', { entries }).catch(() => { /* 映射保存失败不影响导入 */ });
      }
      // 保存 (货号+做工)→拉 映射，下次导入自动带出
      if (lineEntries.length > 0) {
        axios.put('/api/orders/item-line-map', { workshop, entries: lineEntries }).catch(() => { /* 不影响导入 */ });
      }

      message.success(`已导入 ${ids.length} 条订单`);
      setPreviewVisible(false);
      setPreviewData([]);
      fetchData();
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message));
    }
    setImporting(false);
  };

  const handleDeleteAll = async () => {
    const ids = data.filter(r => r?.id).map(r => r.id);
    if (ids.length === 0) {
      message.warning('没有数据可删除');
      return;
    }
    try {
      await axios.post('/api/orders/batch-delete', { ids });
      message.success(`已删除 ${ids.length} 条`);
      fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  // 删除「当前选中」的行（按 Luckysheet 范围选择）
  // 这绕开 Luckysheet 自带的「删除行」（这版本 deleteRowOrColumn API 是坏的，删不掉行也不触发钩子）
  const handleDeleteSelectedRows = async () => {
    const ls = window.luckysheet;
    if (!ls || !ls.getRange) { message.warning('表格未加载'); return; }
    const range = ls.getRange();
    if (!range || !range[0]) { message.warning('请先在表格里选中要删除的行'); return; }
    // 收集选中行对应的 orderId（每个 range 段）
    const ids = [];
    for (const seg of range) {
      const [r0, r1] = seg.row || [];
      if (r0 == null) continue;
      for (let r = r0; r <= r1; r++) {
        if (r === 0) continue;  // 表头
        const idx = r - 1;
        if (idx < data.length) {
          const o = data[idx];
          if (o && o.id) ids.push(o.id);
        }
      }
    }
    const uniqIds = [...new Set(ids)];
    if (uniqIds.length === 0) { message.warning('选中范围里没有可删除的订单（可能是合计行或空行）'); return; }
    Modal.confirm({
      title: `确认删除 ${uniqIds.length} 条订单？`,
      content: '此操作不可恢复，订单会从数据库里彻底移除',
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await axios.post('/api/orders/batch-delete', { ids: uniqIds });
          message.success(`已删除 ${uniqIds.length} 条订单`);
          fetchData();
        } catch (e) {
          message.error('删除失败: ' + (e.response?.data?.message || e.message));
        }
      },
    });
  };

  const handleAutoAssign = async () => {
    try {
      const res = await axios.post('/api/orders/auto-assign', { workshop });
      const assignment = res.data.assignment || {};
      const unmapped = res.data.unmapped || 0;
      const summary = Object.entries(assignment).map(([line, info]) => `${line}: ${info.count}单/${info.totalQty}只`).join('、');
      if (summary) {
        message.success(
          unmapped > 0
            ? `排拉完成：${summary}；另有 ${unmapped} 单的货号还没排过、未分配（手动排好后再点一次会记住）`
            : `排拉完成：${summary}`
        );
      } else {
        message.warning(`没有货号排过拉，${unmapped} 单全部未分配。请先手动把订单分到拉、保存，再点自动排拉记忆。`);
      }
      fetchData();
    } catch (e) {
      message.error('排拉失败: ' + (e.response?.data?.message || e.message));
    }
  };

  const handleAddRow = async () => {
    try {
      await axios.post('/api/orders', { workshop, status: STATUS_MAP[tab] || 'active' });
      fetchData();
    } catch {
      message.error('新增失败');
    }
  };

  const handleExport = () => {
    const basePrefix = import.meta.env.BASE_URL.replace(/\/$/, '');
    window.open(`${basePrefix}/api/export?workshop=${workshop}`, '_blank');
  };

  const handleGenerateSchedule = () => {
    if (data.length === 0) {
      message.warning('当前没有可排的数据');
      return;
    }
    const suggestions = buildScheduleSuggestions(data);
    setScheduleSuggestions(suggestions);
    setScheduleVisible(true);
    const validCount = suggestions.filter(s => s.canApply).length;
    message.success('已生成 ' + validCount + ' 条建议日期');
  };

  const handleApplySchedule = async () => {
    const applyRows = scheduleSuggestions.filter(s => s.canApply && s.startISO);
    if (applyRows.length === 0) {
      message.warning('没有可应用的建议日期');
      return;
    }
    setScheduleApplying(true);
    try {
      await axios.post('/api/orders/batch-update', {
        updates: applyRows.map(s => ({ id: s.id, fields: { start_date: s.startISO } })),
      });
      message.success('已应用 ' + applyRows.length + ' 条上拉日期');
      setScheduleVisible(false);
      setScheduleSuggestions([]);
      fetchData();
    } catch (e) {
      message.error('应用建议日期失败: ' + (e.response?.data?.message || e.message));
    }
    setScheduleApplying(false);
  };

  const scheduleColumns = [
    { title: '拉名', dataIndex: 'lineName', width: 90, fixed: 'left' },
    { title: '货号', dataIndex: 'itemNo', width: 140, ellipsis: true },
    { title: '产品名称', dataIndex: 'productName', width: 180, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', width: 80 },
    { title: '剩余数量', dataIndex: 'remaining', width: 90 },
    { title: '日产量', dataIndex: 'dailyTarget', width: 90 },
    { title: '需天数', dataIndex: 'requiredDays', width: 80, render: v => v || '-' },
    { title: '目标日期', dataIndex: 'targetLabel', width: 90 },
    { title: '建议上拉', dataIndex: 'startLabel', width: 100, render: (_, r) => r.startLabel || '-' },
    { title: '计划完成', dataIndex: 'endLabel', width: 100, render: (_, r) => r.endLabel || '-' },
    { title: '状态', dataIndex: 'riskText', width: 100, render: (_, r) => { const colorMap = { danger: 'red', warning: 'orange', tight: 'gold', ok: 'green', missing: 'default' }; return <Tag color={colorMap[r.risk] || 'default'}>{r.riskText}</Tag>; } },
  ];

  // 展开显示：原始行 + 半成品的配对成品行（配对行 key = 原 key + '__pair'）
  const displayRows = useMemo(() => {
    const out = [];
    for (const r of previewData) {
      out.push(r);
      if (previewWorkType[r._key] === '半成品') {
        out.push({ ...r, _key: r._key + '__pair', _pairOf: r._key });
      }
    }
    return out;
  }, [previewData, previewWorkType]);

  // 显示用选中键：选中的原始行 + 它们的配对成品行
  const displaySelectedKeys = useMemo(() => {
    const out = [];
    for (const k of selectedRowKeys) {
      out.push(k);
      if (previewWorkType[k] === '半成品') out.push(k + '__pair');
    }
    return out;
  }, [selectedRowKeys, previewWorkType]);

  // 取某预览行的做工（原始行用选的，配对成品行固定成品）
  const rowWorkType = (r) => (r._pairOf != null ? '成品' : (previewWorkType[r._key] || '成品'));
  // 取某预览行的拉：用户选过用选的，否则按 (货号+做工) 查记忆映射
  const rowLine = (r) => {
    if (previewLine[r._key] !== undefined) return previewLine[r._key];
    const key = itemGroup(getItemNo(r)) + '|' + rowWorkType(r);
    return itemLineMap[key] || '';
  };

  // 选拉联动：同 Sheet + 同做工 的行一起跟着跳（成品和半成品分开，可去不同拉）
  const handleLineChange = (row, value) => {
    const sheet = row.sheet;
    const targetWt = rowWorkType(row);   // 配对成品行 → 成品
    const v = value || '';
    setPreviewLine(prev => {
      const next = { ...prev };
      for (const r of previewData) {
        if (r.sheet !== sheet) continue;
        const rWt = previewWorkType[r._key] || '成品';
        if (rWt === targetWt) next[r._key] = v;
        // 半成品原始行的「配对成品行」做工是成品：目标是成品时跟跳
        if (rWt === '半成品' && targetWt === '成品') next[r._key + '__pair'] = v;
      }
      return next;
    });
  };

  // 选做工联动：同一个 Excel Sheet 的所有行一起改成同样的做工
  const handleWorkTypeChange = (row, value) => {
    const sheet = row.sheet;
    setPreviewWorkType(prev => {
      const next = { ...prev };
      for (const r of previewData) {
        if (r.sheet === sheet) next[r._key] = value;
      }
      return next;
    });
  };

  const previewColumns = [
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (t, r) => {
        if (r._pairOf != null) return <Tag color="green">配对成品</Tag>;
        return t === 'new'
          ? <Tag color="gold">新单</Tag>
          : t === 'modified'
            ? <Tag color="blue">修改单</Tag>
            : <Tag>未知</Tag>;
      },
    },
    { title: '文件', dataIndex: 'file', width: 180, ellipsis: true },
    { title: 'Sheet', dataIndex: 'sheet', width: 110 },
    { title: '行号', dataIndex: 'row', width: 60 },
    {
      title: '做工', key: 'work_type', width: 110,
      render: (_, r) => {
        // 配对成品行：固定成品，不可改（它是半成品行自动带出来的）
        if (r._pairOf != null) {
          return <Tag color="green">成品</Tag>;
        }
        return (
          <Select
            size="small"
            style={{ width: 90 }}
            value={previewWorkType[r._key] || '成品'}
            onChange={v => handleWorkTypeChange(r, v)}
            options={[
              { value: '成品', label: '成品' },
              { value: '半成品', label: '半成品' },
            ]}
          />
        );
      },
    },
    {
      title: '拉', key: 'line', width: 130,
      render: (_, r) => (
        <Select
          size="small"
          style={{ width: 112 }}
          allowClear
          placeholder="选拉"
          value={rowLine(r) || undefined}
          onChange={v => handleLineChange(r, v)}
          options={lines.map(l => ({ value: l.key, label: `${l.key}(${l.name})` }))}
        />
      ),
    },
    {
      title: '主要信息', key: 'info',
      render: (_, r) => {
        const d = r.data;
        const parts = [];
        for (const key of ['客名', '货号', 'ITEM#', '产品名称', '货品名称', '数量', 'PO数量(只)', '合同', 'ZURU PO NO#', '第三方客户名称', '接单期', '来单日期']) {
          if (d[key]) parts.push(`${key}: ${d[key]}`);
        }
        return parts.join(' | ') || '-';
      },
    },
  ];

  // 批量把选中行（无选中则全部）的做工设为指定值（只针对原始行）
  const setAllWorkType = (wt) => {
    const keys = selectedRowKeys.length > 0 ? selectedRowKeys : previewData.map(r => r._key);
    setPreviewWorkType(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = wt;
      return next;
    });
  };

  // 批量把选中行（无选中则全部）的拉设为指定值
  const setAllLine = (line) => {
    const keys = selectedRowKeys.length > 0 ? selectedRowKeys : previewData.map(r => r._key);
    setPreviewLine(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = line;
      return next;
    });
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          {tab === 'active' && (
            <Button icon={<UploadOutlined />} type="primary" onClick={() => setUploadVisible(true)}>
              导入排期
            </Button>
          )}
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存</Button>
          {tab === 'active' && (
            <Button icon={<CalendarOutlined />} onClick={handleGenerateSchedule} disabled={data.length === 0}>
              建议排期
            </Button>
          )}
          <Button icon={<PlusOutlined />} onClick={handleAddRow}>新增行</Button>
          {tab === 'active' && lineName === 'all' && (
            <Popconfirm title="按货号记忆分拉：排过的货号自动进原拉，没排过的保持不动。确定？" onConfirm={handleAutoAssign} okText="开始排拉" cancelText="取消">
              <Button icon={<BranchesOutlined />} style={{ color: '#fa8c16', borderColor: '#fa8c16' }}
                disabled={allData.length === 0}>
                自动排拉
              </Button>
            </Popconfirm>
          )}
          <Button icon={<DeleteOutlined />} danger onClick={handleDeleteSelectedRows}>
            删除选中行
          </Button>
          <Popconfirm title={`确定清空当前全部 ${data.length} 条数据吗？`} onConfirm={handleDeleteAll} okText="确定清空" cancelText="取消">
            <Button icon={<DeleteOutlined />} danger disabled={data.length === 0}>
              清空全部{data.length > 0 ? ` (${data.length})` : ''}
            </Button>
          </Popconfirm>
        </Space>
        <Space>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索货号、客名、产品..."
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ width: 220 }}
          />
          <Button icon={<DownloadOutlined />} onClick={handleExport}>导出Excel</Button>
        </Space>
      </div>

      <LuckysheetEditor
        ref={editorRef}
        data={data}
        onRefreshData={fetchData}
        workshop={workshop}
        height={600}
        newImportedIds={newImportedIds}
        scheduleHints={scheduleHints}
      />

      <Modal
        title={'建议排期（当前筛选 ' + scheduleSuggestions.length + ' 条）'}
        open={scheduleVisible}
        onCancel={() => setScheduleVisible(false)}
        width={1180}
        okText="应用建议日期"
        onOk={handleApplySchedule}
        confirmLoading={scheduleApplying}
        okButtonProps={{ disabled: scheduleSuggestions.filter(s => s.canApply).length === 0 }}
      >
        <Alert
          style={{ marginBottom: 12 }}
          message="按当前表格顺序、同一拉名顺排计算；应用后只写入“上拉日期”，不会改完成日期和走货期。"
          type="info"
          showIcon
        />
        <Table
          rowKey="key"
          columns={scheduleColumns}
          dataSource={scheduleSuggestions}
          size="small"
          scroll={{ x: 1120, y: 420 }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
        />
      </Modal>

      {/* 文件上传弹窗（拖拽+逐个添加） */}
      <Modal
        title="导入排期"
        open={uploadVisible}
        onCancel={() => { setUploadVisible(false); setFileList([]); }}
        width={700}
        okText={`开始解析 (${fileList.length})`}
        onOk={handleStartImport}
        confirmLoading={parsing}
        okButtonProps={{ disabled: fileList.length === 0 }}
      >
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#1890ff'; e.currentTarget.style.background = '#e6f4ff'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = '#d9d9d9'; e.currentTarget.style.background = '#fafafa'; }}
          onDrop={e => {
            e.preventDefault();
            e.currentTarget.style.borderColor = '#d9d9d9';
            e.currentTarget.style.background = '#fafafa';
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => document.getElementById('file-input-add').click()}
          style={{
            border: '2px dashed #d9d9d9', borderRadius: 8, padding: '32px 16px',
            textAlign: 'center', cursor: 'pointer', background: '#fafafa', marginBottom: 12,
          }}
        >
          <UploadOutlined style={{ fontSize: 32, color: '#1890ff' }} />
          <div style={{ marginTop: 8, fontSize: 14 }}>拖拽文件到此处 或 点击选择文件</div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>支持 .xlsx / .xls，可多次添加</div>
        </div>
        <input
          id="file-input-add"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
        />
        {fileList.length > 0 && (
          <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 4 }}>
            {fileList.map(f => (
              <div key={f.name} style={{
                padding: '8px 12px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', borderBottom: '1px solid #f5f5f5', fontSize: 13,
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {f.name}
                </span>
                <span style={{ color: '#999', fontSize: 12, margin: '0 12px' }}>
                  {(f.size / 1024).toFixed(0)}KB
                </span>
                <Button size="small" type="text" danger onClick={() => removeFile(f.name)}>移除</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        title={`检测到 ${previewData.length} 条订单`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        width={1000}
        okText={`导入选中 (${displaySelectedKeys.length})`}
        onOk={handleImport}
        confirmLoading={importing}
      >
        <Alert
          style={{ marginBottom: 12 }}
          message={`新单: ${previewData.filter(r => r.type === 'new').length} 条, 修改单: ${previewData.filter(r => r.type === 'modified').length} 条 · 选半成品会自动配一条成品（共导入 ${displaySelectedKeys.length} 条）`}
          type="info"
          showIcon
        />
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#666' }}>批量（{selectedRowKeys.length > 0 ? `选中 ${selectedRowKeys.length} 行` : '全部'}）：</span>
          <Button size="small" onClick={() => setAllWorkType('成品')}>全设成品</Button>
          <Button size="small" onClick={() => setAllWorkType('半成品')}>全设半成品</Button>
          <Select
            size="small"
            style={{ width: 140 }}
            placeholder="批量设拉"
            value={undefined}
            onChange={v => setAllLine(v)}
            options={lines.map(l => ({ value: l.key, label: `全设 ${l.key}(${l.name})` }))}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: '#999' }}>选做工：同 Sheet 全部联动 · 选拉：同 Sheet 同做工联动（成品/半成品分开选拉）· 选半成品自动配「成品」行</span>
        </div>
        <Table
          rowKey="_key"
          columns={previewColumns}
          dataSource={displayRows}
          size="small"
          scroll={{ y: 400 }}
          pagination={false}
          rowSelection={{
            selectedRowKeys: displaySelectedKeys,
            onChange: (keys) => setSelectedRowKeys(keys.filter(k => !String(k).endsWith('__pair'))),
            getCheckboxProps: (r) => ({ disabled: r._pairOf != null }),
          }}
        />
      </Modal>
    </div>
  );
}
