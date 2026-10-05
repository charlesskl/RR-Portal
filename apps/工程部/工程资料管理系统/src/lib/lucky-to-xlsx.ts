/**
 * 把 Luckysheet 的工作簿数据（luckysheet.getAllSheets()）转成 xlsx 文件（exceljs）。
 * 覆盖：单元格值、字体/填充/对齐、合并单元格、行高列宽、边框、浮动图片。
 */
import ExcelJS from "exceljs";

type LuckyCell = {
  v?: unknown;
  m?: string;
  ct?: { fa?: string; t?: string };
  ff?: string | number;
  fs?: number;
  fc?: string;
  bg?: string;
  bl?: number;
  it?: number;
  cl?: number;
  ul?: number;
  ht?: number;
  vt?: number;
  tb?: number;
};

type LuckySheet = {
  name: string;
  order?: number;
  status?: number;
  data?: (LuckyCell | null)[][];
  celldata?: { r: number; c: number; v: LuckyCell | null }[];
  config?: {
    merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
    rowlen?: Record<string, number>;
    columnlen?: Record<string, number>;
    borderInfo?: BorderInfo[];
  };
  images?: Record<
    string,
    { src?: string; default?: { left?: number; top?: number; width?: number; height?: number; row?: number; col?: number } }
  >;
  row?: number;
  column?: number;
};

type BorderInfo = {
  rangeType?: string;
  range?: { row?: [number, number]; column?: [number, number] }[];
  borderType?: string;
  style?: number | string;
  color?: string;
  value?: {
    row_index?: number;
    col_index?: number;
    l?: { style?: number | string; color?: string };
    r?: { style?: number | string; color?: string };
    t?: { style?: number | string; color?: string };
    b?: { style?: number | string; color?: string };
  };
};

const H_ALIGN: Record<number, "center" | "left" | "right"> = { 0: "center", 1: "left", 2: "right" };
const V_ALIGN: Record<number, "middle" | "top" | "bottom"> = { 0: "middle", 1: "top", 2: "bottom" };

function normColor(c?: string): string | undefined {
  if (!c) return undefined;
  const s = String(c).trim();
  if (/^#([0-9a-fA-F]{6})$/.test(s)) return `FF${s.slice(1).toUpperCase()}`;
  if (/^#([0-9a-fA-F]{3})$/.test(s)) {
    const [r, g, b] = s.slice(1);
    return `FF${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `FF${hex(m[1])}${hex(m[2])}${hex(m[3])}`.toUpperCase();
  }
  return undefined;
}

const BORDER_STYLES: Record<number, ExcelJS.BorderStyle> = {
  1: "thin",
  2: "hair",
  3: "dotted",
  4: "dashed",
  5: "dashDot",
  6: "dashDotDot",
  7: "double",
  8: "medium",
  9: "mediumDashed",
  10: "mediumDashDot",
  11: "mediumDashDotDot",
  12: "slantDashDot",
  13: "thick",
};

function borderStyle(style?: number | string): ExcelJS.BorderStyle {
  const n = Number(style);
  if (Number.isNaN(n)) return "thin";
  return BORDER_STYLES[n] || "thin";
}

/** 从 sheet 中取出所有单元格（优先 celldata，兼容 data 二维数组） */
function extractCells(sheet: LuckySheet): { r: number; c: number; v: LuckyCell }[] {
  if (Array.isArray(sheet.celldata) && sheet.celldata.length) {
    return sheet.celldata.filter((x) => x && x.v) as { r: number; c: number; v: LuckyCell }[];
  }
  const out: { r: number; c: number; v: LuckyCell }[] = [];
  if (Array.isArray(sheet.data)) {
    sheet.data.forEach((row, r) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, c) => {
        if (cell) out.push({ r, c, v: cell });
      });
    });
  }
  return out;
}

function toEdge(b?: { style?: number | string; color?: string }): ExcelJS.Border | undefined {
  if (!b) return undefined;
  return { style: borderStyle(b.style), color: { argb: normColor(b.color) || "FF000000" } };
}

function applyBorders(ws: ExcelJS.Worksheet, infos: BorderInfo[]) {
  for (const info of infos || []) {
    // 单格格式：{rangeType:"cell", value:{row_index,col_index,l/r/t/b}}
    if (info.rangeType === "cell" && info.value) {
      const v = info.value;
      if (v.row_index === undefined || v.col_index === undefined) continue;
      const cell = ws.getCell(v.row_index + 1, v.col_index + 1);
      const b: Partial<ExcelJS.Borders> = { ...(cell.border || {}) };
      const l = toEdge(v.l);
      const r = toEdge(v.r);
      const t = toEdge(v.t);
      const bm = toEdge(v.b);
      if (l) b.left = l;
      if (r) b.right = r;
      if (t) b.top = t;
      if (bm) b.bottom = bm;
      cell.border = b;
      continue;
    }
    // 范围格式：{range:[{row:[r1,r2],column:[c1,c2]}], borderType, style, color}
    const style = borderStyle(info.style);
    const color = normColor(info.color) || "FF000000";
    const edge: ExcelJS.Border = { style, color: { argb: color } };
    for (const range of info.range || []) {
      const [r1, r2] = range.row || [0, 0];
      const [c1, c2] = range.column || [0, 0];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const cell = ws.getCell(r + 1, c + 1);
          const b: Partial<ExcelJS.Borders> = { ...(cell.border || {}) };
          const t = info.borderType || "border-all";
          if (t === "border-all" || t === "border-top") b.top = edge;
          if (t === "border-all" || t === "border-bottom") b.bottom = edge;
          if (t === "border-all" || t === "border-left") b.left = edge;
          if (t === "border-all" || t === "border-right") b.right = edge;
          if (t === "border-none") {
            b.top = b.bottom = b.left = b.right = undefined;
          }
          cell.border = b;
        }
      }
    }
  }
}

function imageExt(src: string): "png" | "jpeg" | "gif" {
  if (src.startsWith("data:image/png")) return "png";
  if (src.startsWith("data:image/gif")) return "gif";
  return "jpeg";
}

export async function luckyToXlsx(sheets: LuckySheet[], fileName: string): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "工程资料管理系统";
  wb.created = new Date();

  const ordered = [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const sheet of ordered) {
    const ws = wb.addWorksheet((sheet.name || "Sheet").slice(0, 31));
    if (sheet.status === 0) ws.state = "hidden";

    // 单元格值与样式
    for (const { r, c, v } of extractCells(sheet)) {
      const cell = ws.getCell(r + 1, c + 1);
      const raw = v?.v;
      if (typeof raw === "number" && Number.isFinite(raw)) cell.value = raw;
      else if (raw === null || raw === undefined || raw === "") {
        const m = v?.m;
        if (m !== undefined && m !== "") cell.value = String(m);
      } else cell.value = String(v?.m ?? raw);

      const font: Partial<ExcelJS.Font> = {};
      if (v?.ff && typeof v.ff === "string") font.name = v.ff;
      if (v?.fs) font.size = v.fs;
      const fc = normColor(v?.fc);
      if (fc) font.color = { argb: fc };
      if (v?.bl === 1) font.bold = true;
      if (v?.it === 1) font.italic = true;
      if (v?.cl === 1) font.strike = true;
      if (v?.ul === 1) font.underline = true;
      if (Object.keys(font).length) cell.font = font;

      const bg = normColor(v?.bg);
      if (bg && bg !== "FFFFFFFF") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      }
      const align: Partial<ExcelJS.Alignment> = {};
      if (v?.ht !== undefined && H_ALIGN[v.ht]) align.horizontal = H_ALIGN[v.ht];
      if (v?.vt !== undefined && V_ALIGN[v.vt]) align.vertical = V_ALIGN[v.vt];
      if (v?.tb === 2) align.wrapText = true;
      if (Object.keys(align).length) cell.alignment = align;
    }

    // 合并单元格
    const merges = sheet.config?.merge || {};
    for (const k of Object.keys(merges)) {
      const m = merges[k];
      if (m && m.rs > 0 && m.cs > 0) {
        try {
          ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs);
        } catch {
          /* 重叠合并忽略 */
        }
      }
    }

    // 行高 / 列宽
    const rowlen = sheet.config?.rowlen || {};
    for (const rk of Object.keys(rowlen)) {
      const px = rowlen[rk];
      if (px > 0) ws.getRow(Number(rk) + 1).height = px * 0.75;
    }
    const columnlen = sheet.config?.columnlen || {};
    for (const ck of Object.keys(columnlen)) {
      const px = columnlen[ck];
      if (px > 0) ws.getColumn(Number(ck) + 1).width = Math.max(px / 7, 2);
    }

    // 边框
    if (Array.isArray(sheet.config?.borderInfo)) applyBorders(ws, sheet.config!.borderInfo!);

    // 图片
    const images = sheet.images || {};
    for (const key of Object.keys(images)) {
      const img = images[key];
      const src = img?.src;
      if (!src || !src.startsWith("data:")) continue;
      const d = img.default || {};
      try {
        const imageId = wb.addImage({ base64: src, extension: imageExt(src) });
        ws.addImage(imageId, {
          tl: { row: Math.max(d.row ?? 0, 0), col: Math.max(d.col ?? 0, 0) } as ExcelJS.Anchor,
          ext: { width: Math.max(d.width ?? 120, 8), height: Math.max(d.height ?? 90, 8) },
        });
      } catch (e) {
        console.warn("图片写入失败", fileName, e);
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
