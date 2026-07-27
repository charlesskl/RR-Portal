import { ImportOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Drawer, Radio, Space, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  supplierApi,
  type SupplierImportCommitRow,
  type SupplierImportPreviewResult,
  type SupplierImportPreviewRow,
  type SupplierImportRowInput,
} from '../api/suppliers';

type FieldKey = Exclude<keyof SupplierImportRowInput, 'rowNo'>;
const required: FieldKey[] = ['supplierName'];
const labels: Record<FieldKey, string> = {
  supplierName: '加工厂名称', contact: '联系人', phone: '联系电话', address: '工厂地址',
  equipmentCount: '设备台数/生产拉线', machinesForUs: '帮我们生产的机台/生产线',
  employeeCount: '员工人数', monthlyCapacity: '月产能', mainProcess: '加工类型',
  qualification: '环评/消防/安监资质', scope: '所属范围',
};
const text = (v: unknown) => (v == null ? '' : String(v).trim());
const norm = (v: unknown) => text(v).toLowerCase().replace(/[\s\r\n\t（）()【】[\]／/\\、，,。.：:；;_\-&]/g, '');

function identify(header: unknown): FieldKey | null {
  const h = norm(header);
  if (!h || /序号/.test(h)) return null;
  if (/加工厂名称|供应商名称|工厂名称|厂名|加工厂$/.test(h)) return 'supplierName';
  if (/联系人/.test(h)) return 'contact';
  if (/联系电话|手机号码|手机号|电话/.test(h)) return 'phone';
  if (/工厂地址|详细地址|地址/.test(h)) return 'address';
  if (/帮我们生产的机台|帮我们生产的生产线|我司机台|合作机台/.test(h)) return 'machinesForUs';
  if (/设备台数|生产拉线|设备生产线/.test(h)) return 'equipmentCount';
  if (/员工人数|职工人数|人数/.test(h)) return 'employeeCount';
  if (/月产能|每月产能|产能/.test(h)) return 'monthlyCapacity';
  if (/加工类型|加工类别|主营加工/.test(h)) return 'mainProcess';
  if (/环评|消防|安监|资质/.test(h)) return 'qualification';
  if (/所属范围|所属部门|范围/.test(h)) return 'scope';
  return null;
}

function parseInteger(v: unknown, field: string, rowNo: number): number | null {
  if (text(v) === '') return null;
  const value = typeof v === 'number' ? v : Number(text(v).replace(/,/g, ''));
  if (!Number.isInteger(value)) throw new Error(`第 ${rowNo} 行“${field}”必须是整数`);
  return value;
}

function parseExcel(buffer: ArrayBuffer): SupplierImportRowInput[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const all: SupplierImportRowInput[] = [];
  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    let best: { columns: Partial<Record<FieldKey, number>>; start: number; score: number } = { columns: {}, start: 0, score: -1 };
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      for (const depth of [1, 2]) {
        const columns: Partial<Record<FieldKey, number>> = {};
        const width = Math.max(...rows.slice(r, r + depth).map((row) => row?.length ?? 0), 0);
        for (let c = 0; c < width; c++) {
          const parts = rows.slice(r, r + depth).map((row) => text(row?.[c])).filter(Boolean);
          const field = [...parts].reverse().map(identify).find(Boolean) ?? identify(parts.join(' '));
          if (field && columns[field] == null) columns[field] = c;
        }
        const score = Object.keys(columns).length + (columns.supplierName != null ? 20 : 0);
        if (score > best.score) best = { columns, start: r + depth, score };
      }
    }
    const missing = required.filter((f) => best.columns[f] == null);
    if (missing.length) throw new Error(`工作表“${sheetName}”未识别到：${missing.map((f) => labels[f]).join('、')}`);
    const val = (row: unknown[], field: FieldKey) => best.columns[field] == null ? null : row[best.columns[field]!];
    for (let r = best.start; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (!Object.values(best.columns).some((c) => c != null && text(row[c]) !== '')) continue;
      all.push({
        rowNo: r + 1, supplierName: text(val(row, 'supplierName')),
        contact: text(val(row, 'contact')) || null, phone: text(val(row, 'phone')) || null,
        address: text(val(row, 'address')) || null,
        equipmentCount: parseInteger(val(row, 'equipmentCount'), labels.equipmentCount, r + 1),
        machinesForUs: parseInteger(val(row, 'machinesForUs'), labels.machinesForUs, r + 1),
        employeeCount: parseInteger(val(row, 'employeeCount'), labels.employeeCount, r + 1),
        monthlyCapacity: text(val(row, 'monthlyCapacity')) || null,
        mainProcess: text(val(row, 'mainProcess')) || null,
        qualification: text(val(row, 'qualification')) || null, scope: text(val(row, 'scope')) || null,
      });
    }
  });
  return all;
}

export default function ImportSuppliersDrawer({ deptId, onDone }: { deptId: number; onDone: () => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<SupplierImportPreviewResult | null>(null);
  const [overwrite, setOverwrite] = useState<Record<number, boolean>>({});

  const close = () => { setOpen(false); setPreview(null); setFileName(''); setOverwrite({}); };
  const readFile = async (file: File) => {
    setBusy(true); setFileName(file.name); setPreview(null);
    try {
      const rows = parseExcel(await file.arrayBuffer());
      if (!rows.length) throw new Error('没有识别到加工厂数据行');
      const result = await supplierApi.importPreview(deptId, rows);
      setPreview(result);
      setOverwrite(Object.fromEntries(result.rows.filter((r) => r.status === 'conflict').map((r) => [r.rowNo, false])));
    } catch (e) { message.error((e as Error)?.message ?? 'Excel 解析失败'); }
    finally { setBusy(false); }
    return false;
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const rows: SupplierImportCommitRow[] = preview.rows
        .filter((r) => r.status !== 'error' && r.status !== 'duplicate')
        .map((r) => ({ ...r, overwrite: overwrite[r.rowNo] ?? false }));
      const result = await supplierApi.importCommit(deptId, rows);
      message.success(`导入完成：新增 ${result.created} 家，覆盖 ${result.overwritten} 家，跳过 ${result.keptOld + result.skipped} 行`);
      close(); onDone();
    } catch (e) { message.error((e as Error)?.message ?? '导入失败'); }
    finally { setBusy(false); }
  };
  const columns: ColumnsType<SupplierImportPreviewRow> = [
    { title: '行号', dataIndex: 'rowNo', width: 65 },
    { title: '加工厂名称', dataIndex: 'supplierName', width: 130, render: (v) => <b>{v || '—'}</b> },
    { title: '联系人', dataIndex: 'contact', width: 90, render: (v) => v || '—' },
    { title: '联系电话', dataIndex: 'phone', width: 125, render: (v) => v || '—' },
    { title: '工厂地址', dataIndex: 'address', width: 240, render: (v) => v || '—' },
    { title: '设备/拉线', dataIndex: 'equipmentCount', width: 90, render: (v) => v ?? '—' },
    { title: '我司机台', dataIndex: 'machinesForUs', width: 85, render: (v) => v ?? '—' },
    { title: '员工人数', dataIndex: 'employeeCount', width: 85, render: (v) => v ?? '—' },
    { title: '月产能', dataIndex: 'monthlyCapacity', width: 85, render: (v) => v || '—' },
    { title: '加工类型', dataIndex: 'mainProcess', width: 90, render: (v) => v || '—' },
    { title: '资质', dataIndex: 'qualification', width: 110, render: (v) => v || '—' },
    { title: '所属范围', dataIndex: 'scope', width: 90, render: (v) => v || '—' },
    {
      title: '校验/处理', key: 'decision', fixed: 'right', width: 235,
      render: (_, row) => row.status === 'ok' ? <Tag color="success">新增</Tag>
        : row.status === 'conflict' ? <Space direction="vertical" size={2}>
          <Tag color="warning">名称重复</Tag>
          <Radio.Group size="small" value={overwrite[row.rowNo] ?? false}
            onChange={(e) => setOverwrite((x) => ({ ...x, [row.rowNo]: e.target.value }))}>
            <Radio value={false}>跳过</Radio><Radio value>覆盖</Radio>
          </Radio.Group>
        </Space> : <><Tag color="error">跳过</Tag><span style={{ color: '#cf1322' }}>{row.reason}</span></>,
    },
  ];
  return <>
    <Button icon={<ImportOutlined />} onClick={() => setOpen(true)}>导入加工厂</Button>
    <Drawer title="导入加工厂 · 智能识别" width="92vw" open={open} onClose={close}
      extra={<Space><Button onClick={close}>取消</Button><Button type="primary" loading={busy}
        disabled={!preview} onClick={commit}>确认导入</Button></Space>}>
      <Alert type="info" showIcon message="直接上传现有 Excel，系统自动识别表头。错误行会标红并跳过；系统已有的同名加工厂可逐行选择跳过或覆盖。" />
      <Space style={{ margin: '16px 0' }}>
        <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={readFile}>
          <Button icon={<UploadOutlined />}>{fileName ? '重新选择文件' : '选择 Excel'}</Button>
        </Upload>
        {fileName && <span>已选：{fileName}</span>}
      </Space>
      {preview && <>
        <Alert style={{ marginBottom: 12 }} type={preview.errorCount || preview.duplicateCount ? 'warning' : 'success'}
          message={`将新增 ${preview.createCount} 家 · 已有 ${preview.conflictCount} 家 · 文件重复 ${preview.duplicateCount} 行 · 错误 ${preview.errorCount} 行`} />
        <Table rowKey={(r) => `${r.rowNo}-${r.supplierName}`} size="small" columns={columns}
          dataSource={preview.rows} loading={busy} scroll={{ x: 1600, y: 'calc(100vh - 330px)' }}
          pagination={false} rowClassName={(r) => r.status === 'error' || r.status === 'duplicate' ? 'import-error-row' : ''} />
      </>}
    </Drawer>
  </>;
}
