import { FileExcelOutlined, ImportOutlined } from '@ant-design/icons';
import { Alert, App, Button, Drawer, Radio, Select, Space, Spin, Table, Tag, Upload } from 'antd';
import type { UploadFile } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  orderApi,
  type OrderImportInput,
  type OrderImportPreviewLine,
  type OrderImportPreviewOrder,
  type OrderImportPreviewResult,
} from '../api/orders';
import { palette } from '../theme';

const str = (value: unknown) => (value == null ? '' : String(value).trim());
const compact = (value: unknown) => str(value).replace(/\s+/g, '').replace(/[：:]/g, '');
const numberValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(str(value).replace(/[￥¥,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const dateValue = (value: unknown): string | null => {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : null;
  }
  const valueText = str(value);
  const match = valueText.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
};
const valueAfterLabel = (row: unknown[], label: RegExp) => {
  for (let col = 0; col < row.length; col++) {
    const cell = str(row[col]);
    if (!label.test(cell)) continue;
    const inline = cell.split(/[：:]/).slice(1).join(':').trim();
    if (inline) return inline;
    for (let next = col + 1; next < row.length; next++) {
      if (str(row[next])) return str(row[next]);
    }
  }
  return '';
};
const extractProductCode = (value: unknown) => {
  const raw = str(value);
  const pieces = raw.split(/[/／]/).map((item) => item.trim()).filter(Boolean);
  return pieces.at(-1) ?? raw;
};

type LineColumns = {
  code: number;
  name: number;
  unit?: number;
  qty: number;
  price: number;
  priceIncludesTax: boolean;
};

function findLineHeader(rows: unknown[][], from: number, to: number): { row: number; columns: LineColumns } | null {
  for (let rowIndex = from; rowIndex < Math.min(to, rows.length); rowIndex++) {
    const row = rows[rowIndex] ?? [];
    let code = -1;
    let name = -1;
    let qty = -1;
    let price = -1;
    let unit: number | undefined;
    let priceIncludesTax = false;
    row.forEach((cell, col) => {
      const h = compact(cell);
      if (/合同号.*货号|货号/.test(h)) code = col;
      else if (/货品名称|产品名称|款式|品名/.test(h)) name = col;
      else if (/^单位$/.test(h)) unit = col;
      else if (/^数量$|订单数量/.test(h)) qty = col;
      else if (/单价|采购价/.test(h) && !/金额|占比/.test(h)) {
        price = col;
        priceIncludesTax = /含税/.test(h) && !/不含税/.test(h);
      }
    });
    if (code >= 0 && name >= 0 && qty >= 0 && price >= 0)
      return { row: rowIndex, columns: { code, name, unit, qty, price, priceIncludesTax } };
  }
  return null;
}

function parseWorksheet(rows: unknown[][], sourceFile: string): OrderImportInput[] {
  const markers: number[] = [];
  rows.forEach((row, index) => {
    if ((row ?? []).some((cell) => /订单编号/.test(compact(cell)))) markers.push(index);
  });
  if (markers.length === 0) throw new Error(`${sourceFile}：没有识别到“订单编号”`);

  return markers.map((marker, markerIndex) => {
    const blockEnd = markerIndex + 1 < markers.length ? markers[markerIndex + 1] : rows.length;
    const nearbyStart = Math.max(0, marker - 6);
    const nearbyEnd = Math.min(blockEnd, marker + 12);
    let orderNo = '';
    let supplierName = '';
    for (let index = nearbyStart; index < nearbyEnd; index++) {
      orderNo ||= valueAfterLabel(rows[index] ?? [], /订单编号/);
      supplierName ||= valueAfterLabel(rows[index] ?? [], /供应商/);
    }
    const header = findLineHeader(rows, marker, Math.min(blockEnd, marker + 30));
    const lines: OrderImportInput['lines'] = [];
    if (header) {
      for (let rowIndex = header.row + 1; rowIndex < blockEnd; rowIndex++) {
        const row = rows[rowIndex] ?? [];
        if (row.some((cell) => /合计/.test(compact(cell)))) break;
        const rawCode = row[header.columns.code];
        const productName = str(row[header.columns.name]);
        const qty = numberValue(row[header.columns.qty]);
        const price = numberValue(row[header.columns.price]);
        if (!str(rawCode) && !productName && qty == null && price == null) continue;
        if (!str(rawCode) && !productName) continue;
        lines.push({
          rowNo: rowIndex + 1,
          productCode: extractProductCode(rawCode),
          productName,
          qty,
          unit: header.columns.unit == null ? null : str(row[header.columns.unit]) || null,
          unitPrice: price,
          priceIncludesTax: header.columns.priceIncludesTax,
          selectedProductId: null,
        });
      }
    }
    let orderDate: string | null = null;
    let deliveryDate: string | null = null;
    for (let index = marker; index < blockEnd; index++) {
      const row = rows[index] ?? [];
      const joined = row.map(str).join(' ');
      if (!deliveryDate && /交货|交期/.test(joined)) deliveryDate = dateValue(joined);
      if (/时间|日期/.test(joined)) {
        for (const cell of row) orderDate ||= dateValue(cell);
        orderDate ||= dateValue(joined);
      }
    }
    return {
      sourceFile,
      orderNo,
      supplierName,
      orderDate,
      deliveryDate,
      remark: null,
      lines,
    };
  });
}

async function parseFiles(files: File[]): Promise<OrderImportInput[]> {
  const parsed: OrderImportInput[] = [];
  for (const file of files) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null });
      if (!rows.some((row) => row.some((cell) => /订单编号/.test(compact(cell))))) continue;
      parsed.push(...parseWorksheet(rows, workbook.SheetNames.length > 1 ? `${file.name} / ${sheetName}` : file.name));
    }
  }
  return parsed;
}

const orderKey = (order: Pick<OrderImportPreviewOrder, 'sourceFile' | 'orderNo'>) => `${order.sourceFile}\u0001${order.orderNo}`;

export default function ImportOrdersDrawer({ onDone }: { onDone: () => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [parsedOrders, setParsedOrders] = useState<OrderImportInput[]>([]);
  const [preview, setPreview] = useState<OrderImportPreviewResult | null>(null);
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setFiles([]);
    setParsedOrders([]);
    setPreview(null);
    setOverwrite({});
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const analyze = async () => {
    const selected = files.map((file) => file.originFileObj).filter(Boolean) as File[];
    if (selected.length === 0) return message.warning('请先选择 Excel 文件');
    setBusy(true);
    try {
      const orders = await parseFiles(selected);
      if (orders.length === 0) throw new Error('没有识别到任何采购订单');
      const result = await orderApi.importPreview(orders);
      setParsedOrders(orders);
      setPreview(result);
      setOverwrite(Object.fromEntries(result.orders.filter((order) => order.status === 'conflict').map((order) => [orderKey(order), false])));
    } catch (error) {
      message.error((error as Error)?.message ?? '订单解析失败');
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    const sourceMap = new Map(parsedOrders.map((order) => [`${order.sourceFile}\u0001${order.orderNo}`, order]));
    const orders = preview.orders
      .filter((order) => order.status !== 'error')
      .map((order) => ({
        order: sourceMap.get(orderKey(order))!,
        overwrite: order.status === 'conflict' ? !!overwrite[orderKey(order)] : true,
      }));
    setCommitting(true);
    try {
      const result = await orderApi.importCommit(orders);
      message.success(`导入完成：新建 ${result.created} 张，覆盖 ${result.overwritten} 张，跳过 ${result.skipped} 张，失败 ${result.failed} 张`);
      onDone();
      close();
    } finally {
      setCommitting(false);
    }
  };

  const chooseProduct = async (order: OrderImportPreviewOrder, rowNo: number, productId: number) => {
    const next = parsedOrders.map((item) =>
      orderKey(item) !== orderKey(order) ? item : {
        ...item,
        lines: item.lines.map((line) => line.rowNo === rowNo ? { ...line, selectedProductId: productId } : line),
      });
    setParsedOrders(next);
    setBusy(true);
    try {
      const result = await orderApi.importPreview(next);
      setPreview(result);
    } catch (error) {
      message.error((error as Error)?.message ?? '重新匹配失败');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<OrderImportPreviewOrder> = [
    { title: '来源', dataIndex: 'sourceFile', width: 190, ellipsis: true },
    { title: '订单编号', dataIndex: 'orderNo', width: 145, render: (value) => <b>{value || '—'}</b> },
    { title: '加工厂', dataIndex: 'supplierName', width: 145, render: (value) => value || '—' },
    { title: '下单日期', dataIndex: 'orderDate', width: 110, render: (value) => value || '—' },
    { title: '交货日期', dataIndex: 'deliveryDate', width: 110, render: (value) => value || '—' },
    { title: '款式数', key: 'lines', width: 80, align: 'center', render: (_, order) => order.lines.length },
    {
      title: '状态',
      key: 'status',
      width: 100,
      align: 'center',
      render: (_, order) =>
        order.status === 'error' ? <Tag color="error">错误</Tag>
          : order.status === 'conflict' ? <Tag color="warning">订单重复</Tag>
            : <Tag color="success">可导入</Tag>,
    },
    {
      title: '说明 / 处理',
      key: 'action',
      render: (_, order) => {
        if (order.status === 'error') return <span style={{ color: palette.bad }}>{order.reason}，自动跳过</span>;
        if (order.status !== 'conflict') return <span style={{ color: palette.inkSoft }}>将新建订单</span>;
        return (
          <Space direction="vertical" size={4}>
            <span style={{ color: palette.inkSoft }}>{order.reason}</span>
            <Radio.Group
              size="small"
              optionType="button"
              buttonStyle="solid"
              value={!!overwrite[orderKey(order)]}
              onChange={(event) => setOverwrite((current) => ({ ...current, [orderKey(order)]: event.target.value }))}
            >
              <Radio value={false}>跳过</Radio>
              <Radio value={true}>覆盖</Radio>
            </Radio.Group>
          </Space>
        );
      },
    },
  ];

  const lineColumns = (order: OrderImportPreviewOrder): ColumnsType<OrderImportPreviewLine> => [
    { title: 'Excel行', dataIndex: 'rowNo', width: 70 },
    { title: '货号', dataIndex: 'productCode', width: 110 },
    { title: '款式', dataIndex: 'productName', width: 170 },
    { title: '数量', dataIndex: 'qty', width: 90 },
    { title: '单位', dataIndex: 'unit', width: 75 },
    { title: '表格单价', dataIndex: 'sourceUnitPrice', width: 100, render: (value) => value == null ? '—' : `¥${value.toFixed(4)}` },
    { title: '不含税外发价', dataIndex: 'outsourcePriceExcl', width: 120, render: (value) => value == null ? '—' : `¥${value.toFixed(4)}` },
    {
      title: '系统匹配', key: 'match', width: 245,
      render: (_, line) => line.candidates.length === 0 ? '—' : (
        <Select
          style={{ width: 225 }}
          value={line.productId ?? undefined}
          placeholder="请选择系统款式"
          onChange={(value) => void chooseProduct(order, line.rowNo, value)}
          options={line.candidates.map((candidate) => ({
            value: candidate.productId,
            disabled: !candidate.isActive || !candidate.hasQuote,
            label: `${candidate.productName}（${Math.round(candidate.similarity * 100)}%）${
              !candidate.isActive ? ' · 已停用' : !candidate.hasQuote ? ' · 无核价' : ''}`,
          }))}
        />
      ),
    },
    {
      title: '校验', key: 'status', width: 220,
      render: (_, line) => line.status === 'error'
        ? <span style={{ color: palette.bad }}>{line.reason}</span>
        : <Space size={4}><Tag color="success">匹配成功</Tag>
          {line.matchType === 'suggested' && <Tag color="processing">相似推荐</Tag>}
          {line.matchType === 'manual' && <Tag color="blue">人工确认</Tag>}
          {line.matchType === 'alias' && <Tag color="cyan">已记住</Tag>}
          {line.matchType === 'merged' && <Tag color="purple">同款同价已合并</Tag>}
        </Space>,
    },
  ];

  return (
    <>
      <Button icon={<ImportOutlined />} onClick={() => setOpen(true)}>批量导入订单</Button>
      <Drawer
        title="批量导入外发订单"
        width={1280}
        open={open}
        onClose={close}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={close}>取消</Button>
            <Button type="primary" disabled={!preview || preview.readyCount + preview.conflictCount === 0} loading={committing} onClick={() => void commit()}>
              确认导入
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="可一次选择多个 Excel；每个文件、每个工作表都可以包含多张订单。系统按“订单编号”拆单，含税单价自动除以1.13换算为不含税外发价。"
          style={{ marginBottom: 14 }}
        />
        <Upload.Dragger
          className="order-import-dragger"
          accept=".xlsx,.xls"
          multiple
          fileList={files}
          beforeUpload={() => false}
          onChange={({ fileList }) => {
            setFiles(fileList);
            setPreview(null);
          }}
        >
          <p style={{ margin: 0 }}><FileExcelOutlined style={{ fontSize: 24, color: palette.blue }} /></p>
          <p style={{ margin: '6px 0 0' }}>点击或拖入多个 Excel 文件</p>
        </Upload.Dragger>
        <Button type="primary" style={{ margin: '14px 0' }} loading={busy} disabled={files.length === 0} onClick={() => void analyze()}>
          解析并预览
        </Button>
        <Spin spinning={busy}>
          {preview && (
            <>
              <Alert
                type={preview.errorCount > 0 ? 'warning' : 'success'}
                showIcon
                message={`识别 ${preview.orders.length} 张订单：可新建 ${preview.readyCount} 张，系统重复 ${preview.conflictCount} 张，错误跳过 ${preview.errorCount} 张`}
                style={{ marginBottom: 12 }}
              />
              <Table<OrderImportPreviewOrder>
                rowKey={orderKey}
                bordered
                size="small"
                columns={columns}
                dataSource={preview.orders}
                pagination={false}
                expandable={{
                  expandedRowRender: (order) => (
                    <Table<OrderImportPreviewLine>
                      rowKey="rowNo"
                      size="small"
                      bordered
                      columns={lineColumns(order)}
                      dataSource={order.lines}
                      pagination={false}
                    />
                  ),
                }}
                onRow={(order) => ({
                  style: order.status === 'error' ? { background: '#fff1f0' } : order.status === 'conflict' ? { background: '#fffbe6' } : undefined,
                })}
              />
            </>
          )}
        </Spin>
      </Drawer>
    </>
  );
}
