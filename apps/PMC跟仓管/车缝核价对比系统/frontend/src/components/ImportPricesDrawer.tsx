import { ImportOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Drawer, Input, InputNumber, Radio, Space, Spin, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  productQuoteApi,
  type ImportCommitRow,
  type ImportPreviewResult,
  type ImportPreviewRow,
  type ImportRowInput,
} from '../api/productQuotes';
import { palette } from '../theme';

type FieldKey =
  | 'customerName'
  | 'code'
  | 'productName'
  | 'customerQuoteExcl'
  | 'internalPriceExcl'
  | 'dongguanPriceExcl'
  | 'hunanPriceExcl'
  | 'remark';

type HeaderMatch = {
  columns: Partial<Record<FieldKey, number>>;
  dataStart: number;
  score: number;
};

const REQUIRED_FIELDS: FieldKey[] = ['code', 'productName', 'internalPriceExcl'];

const text = (value: unknown) => (value == null ? '' : String(value).trim());
const normalized = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[\s\r\n\t（）()【】[\]／/\\、，,。.：:；;_\-&]/g, '')
    .replace(/rmb|cny|人民币|不含税|含税价|单价/g, '');

function identifyField(header: string): FieldKey | null {
  const h = normalized(header);
  if (!h || /占比|比例|比率|序号/.test(h)) return null;
  if (/备注|说明/.test(h)) return 'remark';
  if (/客名|客户名称|客户/.test(h)) return 'customerName';
  if (/产品名称|款式名称|货品名称|产品名|品名|款式/.test(h)) return 'productName';
  if (/合同号货号|产品货号|货号/.test(h)) return 'code';
  if (/外发东莞|东莞外发价|东莞价/.test(h)) return 'dongguanPriceExcl';
  if (/外发湖南|湖南外发价|湖南价/.test(h)) return 'hunanPriceExcl';
  if (/核价人工|本厂核价|核价人工|生产报价|核价/.test(h)) return 'internalPriceExcl';
  if (/报价价|报客价|客户报价|报价/.test(h)) return 'customerQuoteExcl';
  return null;
}

function matchHeaders(rows: unknown[][]): HeaderMatch {
  let best: HeaderMatch = { columns: {}, dataStart: 0, score: -1 };
  const scanCount = Math.min(rows.length, 30);

  for (let rowIndex = 0; rowIndex < scanCount; rowIndex++) {
    for (const depth of [1, 2]) {
      if (rowIndex + depth > rows.length) continue;
      const width = Math.max(...rows.slice(rowIndex, rowIndex + depth).map((r) => r?.length ?? 0), 0);
      const columns: Partial<Record<FieldKey, number>> = {};
      for (let col = 0; col < width; col++) {
        const headerParts = rows.slice(rowIndex, rowIndex + depth).map((r) => text(r?.[col])).filter(Boolean);
        // 多层表头优先识别最下层字段，避免上层“报价&核价对比”把“报价价”误判为核价。
        const field =
          [...headerParts].reverse().map(identifyField).find(Boolean) ??
          identifyField(headerParts.join(' '));
        if (field && columns[field] == null) columns[field] = col;
      }
      const requiredCount = REQUIRED_FIELDS.filter((field) => columns[field] != null).length;
      const optionalCount = Object.keys(columns).length - requiredCount;
      const score = requiredCount * 20 + optionalCount * 3;
      if (score > best.score) best = { columns, dataStart: rowIndex + depth, score };
    }
  }

  const missing = REQUIRED_FIELDS.filter((field) => best.columns[field] == null);
  if (missing.length > 0) {
    const labels: Record<FieldKey, string> = {
      customerName: '客户',
      code: '货号',
      productName: '产品名称/款式',
      customerQuoteExcl: '报客价',
      internalPriceExcl: '本厂核价',
      dongguanPriceExcl: '外发东莞价',
      hunanPriceExcl: '外发湖南价',
      remark: '备注',
    };
    throw new Error(`未识别到必要字段：${missing.map((field) => labels[field]).join('、')}`);
  }
  return best;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || text(value) === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = text(value).replace(/[￥¥,\s]/g, '');
  const valueAsNumber = Number(cleaned);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
}

function parseSheet(buffer: ArrayBuffer): ImportRowInput[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error('Excel 中没有可读取的工作表');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const match = matchHeaders(rows);
  const value = (row: unknown[], field: FieldKey) => {
    const col = match.columns[field];
    return col == null ? null : row[col];
  };

  const result: ImportRowInput[] = [];
  for (let index = match.dataStart; index < rows.length; index++) {
    const row = rows[index] ?? [];
    const code = text(value(row, 'code'));
    const productName = text(value(row, 'productName'));
    const hasAnyValue = Object.values(match.columns).some((col) => col != null && text(row[col]) !== '');
    if (!hasAnyValue || (!code && !productName)) continue;
    result.push({
      rowNo: index + 1,
      customerName: text(value(row, 'customerName')) || null,
      code,
      productName,
      customerQuoteExcl: numberOrNull(value(row, 'customerQuoteExcl')),
      internalPriceExcl: numberOrNull(value(row, 'internalPriceExcl')),
      dongguanPriceExcl: numberOrNull(value(row, 'dongguanPriceExcl')),
      hunanPriceExcl: numberOrNull(value(row, 'hunanPriceExcl')),
      remark: text(value(row, 'remark')) || null,
    });
  }
  return result;
}

const rowKey = (row: Pick<ImportPreviewRow, 'code' | 'productName'>) => `${row.code}\u0001${row.productName}`;

export default function ImportPricesDrawer({ deptId, onDone }: { deptId: number; onDone: () => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [overwrite, setOverwrite] = useState<Record<number, boolean>>({});
  const [clearEmpty, setClearEmpty] = useState<Record<number, boolean>>({});
  const [selectedDuplicate, setSelectedDuplicate] = useState<Record<string, number>>({});

  const close = () => {
    setOpen(false);
    setFileName('');
    setPreview(null);
    setOverwrite({});
    setClearEmpty({});
    setSelectedDuplicate({});
  };

  const applyPreview = (result: ImportPreviewResult) => {
    setPreview(result);
    setOverwrite((current) => ({
      ...Object.fromEntries(result.rows.filter((row) => row.hasExistingQuote).map((row) => [row.rowNo, false])),
      ...current,
    }));
    const duplicateKeys = new Set(result.rows.filter((row) => row.status === 'duplicate').map(rowKey));
    setSelectedDuplicate((current) => {
      const defaults = Object.fromEntries(
        [...duplicateKeys].map((key) => [
          key,
          Math.max(...result.rows.filter((row) => rowKey(row) === key).map((row) => row.rowNo)),
        ]),
      );
      return { ...defaults, ...current };
    });
  };

  const previewInputs = (rows: ImportPreviewRow[]): ImportRowInput[] =>
    rows.map((row) => ({
      rowNo: row.rowNo,
      customerName: row.customerName || null,
      code: row.code,
      productName: row.productName,
      customerQuoteExcl: row.customerQuoteExcl,
      internalPriceExcl: row.internalPriceExcl ?? null,
      dongguanPriceExcl: row.dongguanPriceExcl,
      hunanPriceExcl: row.hunanPriceExcl,
      remark: row.remark,
    }));

  const revalidate = async (rows?: ImportPreviewRow[]) => {
    const source = rows ?? preview?.rows;
    if (!source) return null;
    setBusy(true);
    try {
      const result = await productQuoteApi.importPreview(deptId, previewInputs(source));
      applyPreview(result);
      return result;
    } catch (error) {
      message.error((error as Error)?.message ?? '重新校验失败');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setPreview(null);
    setBusy(true);
    try {
      const parsedRows = parseSheet(await file.arrayBuffer());
      if (parsedRows.length === 0) throw new Error('没有识别到产品数据行');
      const result = await productQuoteApi.importPreview(deptId, parsedRows);
      applyPreview(result);
    } catch (error) {
      message.error((error as Error)?.message ?? 'Excel 解析失败');
    } finally {
      setBusy(false);
    }
  };

  const setAllConflicts = (value: boolean) => {
    if (!preview) return;
    setOverwrite((current) => ({
      ...current,
      ...Object.fromEntries(preview.rows.filter((row) => row.status === 'conflict').map((row) => [row.rowNo, value])),
    }));
  };

  const downloadErrors = () => {
    if (!preview) return;
    const errorRows = preview.rows
      .filter((row) => row.status === 'skip')
      .map((row) => ({
        原表行号: row.rowNo,
        客户: row.customerName,
        货号: row.code,
        款式: row.productName,
        报客价: row.customerQuoteExcl,
        本厂核价: row.internalPriceExcl,
        外发东莞价: row.dongguanPriceExcl,
        外发湖南价: row.hunanPriceExcl,
        备注: row.remark,
        错误原因: row.reason,
      }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(errorRows), '错误明细');
    XLSX.writeFile(workbook, `产品核价导入错误明细_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const confirm = async () => {
    if (!preview) return;
    const checked = await revalidate(preview.rows);
    if (!checked) return;
    const duplicateKeys = new Set(checked.rows.filter((row) => row.status === 'duplicate').map(rowKey));
    const rows: ImportCommitRow[] = checked.rows
      .filter((row) => row.status !== 'skip')
      .filter((row) => !duplicateKeys.has(rowKey(row)) || selectedDuplicate[rowKey(row)] === row.rowNo)
      .map((row) => ({
        rowNo: row.rowNo,
        customerName: row.customerName || null,
        code: row.code,
        productName: row.productName,
        customerQuoteExcl: row.customerQuoteExcl,
        internalPriceExcl: row.internalPriceExcl ?? null,
        dongguanPriceExcl: row.dongguanPriceExcl,
        hunanPriceExcl: row.hunanPriceExcl,
        remark: row.remark,
        overwrite: row.hasExistingQuote ? !!overwrite[row.rowNo] : true,
        clearEmpty: !!clearEmpty[row.rowNo],
      }));
    setCommitting(true);
    try {
      const result = await productQuoteApi.importCommit(deptId, rows);
      message.success(
        `导入完成：新建 ${result.createdProducts} 款，新增 ${result.writtenQuotes} 条价格，覆盖 ${result.overwritten} 条，保留 ${result.keptOld} 条，跳过 ${result.skipped} 行`,
      );
      onDone();
      close();
    } catch (error) {
      message.error((error as Error)?.message ?? '导入失败');
    } finally {
      setCommitting(false);
    }
  };

  const updateRow = <K extends keyof ImportPreviewRow>(rowNo: number, field: K, value: ImportPreviewRow[K]) => {
    setPreview((current) =>
      current
        ? { ...current, rows: current.rows.map((row) => (row.rowNo === rowNo ? { ...row, [field]: value } : row)) }
        : current,
    );
  };

  const editableText = (field: 'customerName' | 'code' | 'productName' | 'remark', width?: number) =>
    (_: unknown, row: ImportPreviewRow) => (
      <Input
        value={row[field] ?? ''}
        style={{ width }}
        status={row.status === 'skip' && (!row[field] || field === 'code' || field === 'productName') ? 'error' : undefined}
        onChange={(event) => updateRow(row.rowNo, field, event.target.value)}
        onBlur={() => void revalidate()}
      />
    );

  const editablePrice = (field: 'customerQuoteExcl' | 'internalPriceExcl' | 'dongguanPriceExcl' | 'hunanPriceExcl') =>
    (_: unknown, row: ImportPreviewRow) => (
      <InputNumber
        value={row[field]}
        min={0}
        precision={4}
        controls={false}
        style={{ width: '100%' }}
        status={row.status === 'skip' && field === 'internalPriceExcl' ? 'error' : undefined}
        onChange={(value) => updateRow(row.rowNo, field, value)}
        onBlur={() => void revalidate()}
      />
    );

  const columns: ColumnsType<ImportPreviewRow> = [
    { title: '行号', dataIndex: 'rowNo', width: 66, align: 'center', fixed: 'left' },
    { title: '客户', dataIndex: 'customerName', width: 120, render: editableText('customerName') },
    { title: '货号', dataIndex: 'code', width: 125, fixed: 'left', render: editableText('code') },
    { title: '款式', dataIndex: 'productName', width: 180, fixed: 'left', render: editableText('productName') },
    { title: '报客价', dataIndex: 'customerQuoteExcl', width: 115, render: editablePrice('customerQuoteExcl') },
    { title: '本厂核价', dataIndex: 'internalPriceExcl', width: 115, render: editablePrice('internalPriceExcl') },
    { title: '外发东莞价', dataIndex: 'dongguanPriceExcl', width: 125, render: editablePrice('dongguanPriceExcl') },
    { title: '外发湖南价', dataIndex: 'hunanPriceExcl', width: 125, render: editablePrice('hunanPriceExcl') },
    { title: '备注', dataIndex: 'remark', width: 160, render: editableText('remark') },
    {
      title: '状态',
      key: 'status',
      width: 92,
      align: 'center',
      render: (_, row) =>
        row.status === 'skip' ? (
          <Tag color="error">错误</Tag>
        ) : row.status === 'duplicate' ? (
          <Tag color="warning">文件内重复</Tag>
        ) : row.status === 'conflict' ? (
          <Tag color="warning">已有价格</Tag>
        ) : row.status === 'warning' ? (
          <Tag color="gold">价格异常</Tag>
        ) : row.willCreateProduct ? (
          <Tag color="success">新建款式</Tag>
        ) : (
          <Tag color="processing">可导入</Tag>
        ),
    },
    {
      title: '说明 / 处理',
      key: 'decision',
      width: 250,
      fixed: 'right',
      render: (_, row) => {
        if (row.status === 'skip') return <span style={{ color: palette.bad }}>{row.reason}，导入时自动跳过</span>;
        if (row.status === 'duplicate') {
          const selected = selectedDuplicate[rowKey(row)] === row.rowNo;
          return (
            <Space direction="vertical" size={4}>
              <span style={{ color: palette.inkSoft }}>{row.reason}</span>
              <Button size="small" type={selected ? 'primary' : 'default'} onClick={() => setSelectedDuplicate((v) => ({ ...v, [rowKey(row)]: row.rowNo }))}>
                {selected ? '已选择此行' : '改用此行'}
              </Button>
              {selected && row.hasExistingQuote && conflictDecision(row)}
            </Space>
          );
        }
        if (!row.hasExistingQuote)
          return <span style={{ color: row.status === 'warning' ? '#d48806' : palette.inkSoft }}>{row.reason ?? (row.willCreateProduct ? '将新建款式并写入价格' : '将写入价格')}</span>;
        return conflictDecision(row);
      },
    },
  ];

  function conflictDecision(row: ImportPreviewRow) {
    return (
      <Space direction="vertical" size={5}>
        <Radio.Group
          size="small"
          value={!!overwrite[row.rowNo]}
          onChange={(event) => setOverwrite((current) => ({ ...current, [row.rowNo]: event.target.value }))}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio value={false}>跳过</Radio>
          <Radio value={true}>覆盖</Radio>
        </Radio.Group>
        {!!overwrite[row.rowNo] && (
          <Checkbox
            checked={!!clearEmpty[row.rowNo]}
            onChange={(event) => setClearEmpty((current) => ({ ...current, [row.rowNo]: event.target.checked }))}
          >
            同时清空表格中的空白字段
          </Checkbox>
        )}
      </Space>
    );
  }

  const canConfirm = !!preview && preview.willWriteCount + preview.conflictCount + preview.duplicateCount > 0;

  return (
    <>
      <Button icon={<ImportOutlined />} onClick={() => setOpen(true)} style={{ borderColor: palette.blue, color: palette.blue }}>
        导入产品核价
      </Button>
      <Drawer
        title="导入产品核价 · 智能识别"
        width={1280}
        open={open}
        onClose={close}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" loading={committing} disabled={!canConfirm} onClick={confirm}>
              确认导入
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="可在预览表中直接修改识别结果，离开输入框后系统会重新校验。红色错误行自动跳过；黄色重复或异常行需要检查；系统已有价格由人工选择跳过或覆盖。"
          style={{ marginBottom: 14 }}
        />
        <Space style={{ marginBottom: 14 }} wrap>
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            maxCount={1}
            beforeUpload={(file) => {
              void handleFile(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>{fileName ? '重新选择文件' : '选择 Excel 文件'}</Button>
          </Upload>
          {fileName && <span style={{ color: palette.inkSoft }}>已选：{fileName}</span>}
        </Space>

        <Spin spinning={busy}>
          {preview && (
            <>
              <div
                style={{
                  background: palette.blueSoft,
                  border: `1px solid ${palette.line}`,
                  borderRadius: 10,
                  padding: '10px 16px',
                  marginBottom: 12,
                  display: 'flex',
                  gap: 22,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 700, color: palette.blueDark }}>
                  将新建 {preview.willCreateProductCount} 款 · 可写入 {preview.willWriteCount} 条 · 已有价格{' '}
                  {preview.conflictCount} 条 · 文件内重复 {preview.duplicateCount} 行 · 价格提醒{' '}
                  {preview.warningCount} 行 · 错误跳过 {preview.skipCount} 行
                </span>
                {preview.conflictCount > 0 && (
                  <Space>
                    <Button size="small" onClick={() => setAllConflicts(false)}>
                      全部保留系统价格
                    </Button>
                    <Button size="small" danger onClick={() => setAllConflicts(true)}>
                      全部用表格覆盖
                    </Button>
                  </Space>
                )}
                {preview.skipCount > 0 && (
                  <Button size="small" danger onClick={downloadErrors}>
                    下载错误明细
                  </Button>
                )}
              </div>
              <Table<ImportPreviewRow>
                rowKey="rowNo"
                size="small"
                bordered
                columns={columns}
                dataSource={preview.rows}
                pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 行` }}
                scroll={{ x: 1500, y: 460 }}
                onRow={(row) => ({
                  style:
                    row.status === 'skip'
                      ? { background: '#fff1f0' }
                      : ['conflict', 'duplicate', 'warning'].includes(row.status)
                        ? { background: '#fffbe6' }
                        : undefined,
                })}
              />
            </>
          )}
        </Spin>
      </Drawer>
    </>
  );
}
