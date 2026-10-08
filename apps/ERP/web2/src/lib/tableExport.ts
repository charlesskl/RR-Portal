// 通用表格导出/打印(对照老系统 web/src/utils/tableExport.ts):
// 把行数据按列规格转成 CSV(Excel 可开) 或打印窗口。
export interface ExportCol {
  title: string;
  key: string;
  fmt?: (v: unknown, row: Record<string, unknown>) => string;
}

const cell = (c: ExportCol, row: Record<string, unknown>): string => {
  const v = row[c.key];
  return c.fmt ? c.fmt(v, row) : String(v ?? "");
};

// 纯函数:构造 CSV 文本(含表头)。字段含 逗号/引号/换行 时用双引号包裹并转义。
export function buildCsv(cols: ExportCol[], rows: Record<string, unknown>[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = cols.map((c) => esc(c.title)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(cell(c, r))).join(",")).join("\n");
  return header + "\n" + body;
}

// 触发浏览器下载 CSV(带 UTF-8 BOM,Excel 才能正确显示中文)。
export function downloadCsv(
  filename: string,
  cols: ExportCol[],
  rows: Record<string, unknown>[],
): void {
  const csv = "﻿" + buildCsv(cols, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 开新窗口渲染表格并触发打印。
export function printTable(
  title: string,
  cols: ExportCol[],
  rows: Record<string, unknown>[],
): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
    );
  const thead = `<tr>${cols.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(c, r))}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#000}
  h2{text-align:center;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left;white-space:nowrap}
  th{background:#f0f0f0}
  @page{size:A4;margin:0}
  @media print{body{margin:0;padding:10mm}}
</style></head>
<body><h2>${esc(title)}</h2>
<table><thead>${thead}</thead><tbody>${tbody}</tbody></table></body></html>`;
  const w = window.open("", "_blank", "width=1100,height=760");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
