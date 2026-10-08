// BOM 表格导入解析：Excel 粘贴(TSV) / CSV 文本 → BOM 明细行（纯函数，可单测）

import { parseQtyInput } from "@/lib/fraction";

export interface BomImportRow {
  行号: number;
  物料编号: string;
  使用数量?: number;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  错误?: string;
}

export interface BomImportParseResult {
  hasHeader: boolean;
  rows: BomImportRow[];
}

export interface BomImportMaterial {
  物料编号?: string | null;
  物料名称?: string | null;
  工模编号?: string | null;
  规格?: string | null;
  物料类别?: string | null;
  材料?: string | null;
  颜色?: string | null;
  单位?: string | null;
}

export interface BomImportCheckedRow extends BomImportRow {
  material?: BomImportMaterial;
}

// 表头归一化：去半角/全角空格，全角括号转半角（兼容 "用量（每PCS）" 等写法）
const normHeader = (s: string) =>
  s.replace(/[\s\u3000]/g, "").replace(/（/g, "(").replace(/）/g, ")");

const CODE_HEADERS = new Set(["物料编号", "编号", "料号", "物料"].map(normHeader));
const QTY_HEADERS = new Set(["使用数量", "用量", "用量(每PCS)", "数量"].map(normHeader));
const NAME_HEADERS = new Set(["物料名称", "名称"].map(normHeader));
const SPEC_HEADERS = new Set(["规格"].map(normHeader));
const COLOR_HEADERS = new Set(["颜色"].map(normHeader));
const UNIT_HEADERS = new Set(["单位"].map(normHeader));

// 物料编号清洗：去掉所有半角/全角空白
export const cleanMaterialCode = (s: string) => s.replace(/[\s\u3000]/g, "");

// 文件解码：优先 UTF-8（含 BOM），失败按 GBK 解码
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gbk").decode(buf).replace(/^\uFEFF/, "");
  }
}

// 分隔文本解析：首行含 Tab 按 TSV，否则按 CSV（支持引号包裹/转义/字段内换行）
export function splitDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delim) { cells.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      rows.push(cells); cells = [];
    } else cell += ch;
  }
  if (cell !== "" || cells.length) { cells.push(cell); rows.push(cells); }
  return rows;
}

const isEmptyRow = (cells: string[]) =>
  cells.every(c => !c.replace(/[\s\u3000]/g, ""));

const findCol = (header: string[], names: Set<string>) =>
  header.findIndex(c => names.has(normHeader(c)));

const cellAt = (cells: string[], idx: number) =>
  idx >= 0 ? (cells[idx] ?? "").trim() : "";

function buildRow(
  行号: number,
  cells: string[],
  cols: { code: number; qty: number; name: number; spec: number; color: number; unit: number },
  missingQtyCol: boolean,
): BomImportRow | null {
  if (isEmptyRow(cells)) return null;
  const 物料编号 = cleanMaterialCode(cellAt(cells, cols.code));
  const qtyText = cellAt(cells, cols.qty);
  const row: BomImportRow = { 行号, 物料编号 };
  const name = cellAt(cells, cols.name);
  const spec = cellAt(cells, cols.spec);
  const color = cellAt(cells, cols.color);
  const unit = cellAt(cells, cols.unit);
  if (name) row.物料名称 = name;
  if (spec) row.规格 = spec;
  if (color) row.颜色 = color;
  if (unit) row.单位 = unit;
  if (!物料编号) {
    row.错误 = "物料编号为空";
    return row;
  }
  if (missingQtyCol) {
    row.错误 = "缺少使用数量列";
    return row;
  }
  // 用量支持分数写法(1/6、1/2=一张料出 N 个;印刷/裁切类物料常用)
  const qty = parseQtyInput(qtyText);
  if (qty === undefined || qty <= 0) {
    row.错误 = "使用数量必须为正数";
    return row;
  }
  row.使用数量 = qty;
  return row;
}

// 解析导入文本：有表头按列名映射，无表头按位置（第1列=物料编号、第2列=使用数量）；空行跳过
export function parseBomImport(text: string): BomImportParseResult {
  const grid = splitDelimited(text);
  const firstDataIdx = grid.findIndex(cells => !isEmptyRow(cells));
  if (firstDataIdx < 0) return { hasHeader: false, rows: [] };
  const first = grid[firstDataIdx];
  const hasHeader = first.some(c => CODE_HEADERS.has(normHeader(c)));
  const rows: BomImportRow[] = [];
  if (hasHeader) {
    const cols = {
      code: findCol(first, CODE_HEADERS),
      qty: findCol(first, QTY_HEADERS),
      name: findCol(first, NAME_HEADERS),
      spec: findCol(first, SPEC_HEADERS),
      color: findCol(first, COLOR_HEADERS),
      unit: findCol(first, UNIT_HEADERS),
    };
    const missingQtyCol = cols.qty < 0;
    for (let i = firstDataIdx + 1; i < grid.length; i++) {
      const row = buildRow(i + 1, grid[i], cols, missingQtyCol);
      if (row) rows.push(row);
    }
  } else {
    const cols = { code: 0, qty: 1, name: -1, spec: -1, color: -1, unit: -1 };
    for (let i = firstDataIdx; i < grid.length; i++) {
      const row = buildRow(i + 1, grid[i], cols, false);
      if (row) rows.push(row);
    }
  }
  return { hasHeader, rows };
}

// 逐行校验物料编号是否存在于物料档案；存在则带出档案资料供预览/填网格
export function validateBomImportRows(
  rows: BomImportRow[],
  master: Map<string, BomImportMaterial>,
): BomImportCheckedRow[] {
  return rows.map(row => {
    if (row.错误) return row;
    const material = master.get(row.物料编号);
    return material ? { ...row, material } : { ...row, 错误: "物料不存在" };
  });
}
