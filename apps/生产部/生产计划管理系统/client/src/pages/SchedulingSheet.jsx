import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button, Space, message, Modal, Table, Tag, Alert, Popconfirm } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined, DeleteOutlined, BranchesOutlined, SearchOutlined, SaveOutlined } from '@ant-design/icons';
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
      const orders = selected.map(r => {
        const order = mapRowToOrder(r.data);
        // 从服务端提取的客名
        if (!order.client && r.clientFromFile) {
          order.client = r.clientFromFile;
        }
        return { ...order, workshop, status: 'active' };
      });
      const res2 = await axios.post('/api/orders', orders);
      const ids = res2.data.ids || [];
      const skipped = res2.data.skipped || 0;
      setNewImportedIds(prev => new Set([...prev, ...ids]));
      const msg = skipped > 0
        ? `已导入 ${ids.length} 条，跳过 ${skipped} 条重复订单`
        : `已导入 ${ids.length} 条订单`;
      message.success(msg);
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

  const handleAutoAssign = async () => {
    try {
      const res = await axios.post('/api/orders/auto-assign', { workshop });
      const assignment = res.data.assignment || {};
      const summary = Object.entries(assignment).map(([line, info]) => `${line}: ${info.count}单/${info.totalQty}只`).join('、');
      message.success(`排拉完成：${summary}`);
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

  const previewColumns = [
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: t => t === 'new'
        ? <Tag color="gold">新单</Tag>
        : t === 'modified'
          ? <Tag color="blue">修改单</Tag>
          : <Tag>未知</Tag>,
    },
    { title: '文件', dataIndex: 'file', width: 200, ellipsis: true },
    { title: 'Sheet', dataIndex: 'sheet', width: 120 },
    { title: '行号', dataIndex: 'row', width: 60 },
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
          <Button icon={<PlusOutlined />} onClick={handleAddRow}>新增行</Button>
          {tab === 'active' && lineName === 'all' && (
            <Popconfirm title="按货号分组、走货期排序，自动分配到各拉？" onConfirm={handleAutoAssign} okText="开始排拉" cancelText="取消">
              <Button icon={<BranchesOutlined />} style={{ color: '#fa8c16', borderColor: '#fa8c16' }}
                disabled={allData.length === 0}>
                自动排拉
              </Button>
            </Popconfirm>
          )}
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
      />

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
        okText={`导入选中 (${selectedRowKeys.length})`}
        onOk={handleImport}
        confirmLoading={importing}
      >
        <Alert
          style={{ marginBottom: 12 }}
          message={`新单: ${previewData.filter(r => r.type === 'new').length} 条, 修改单: ${previewData.filter(r => r.type === 'modified').length} 条`}
          type="info"
          showIcon
        />
        <Table
          rowKey="_key"
          columns={previewColumns}
          dataSource={previewData}
          size="small"
          scroll={{ y: 400 }}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
        />
      </Modal>
    </div>
  );
}
