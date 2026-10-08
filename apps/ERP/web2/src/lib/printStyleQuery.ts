// 工程部「BOM货号查询」按格式打印模板：老系统 A4 横向报表「货 号 资 料 查 询」。
// 纯函数拼 HTML(buildStyleQueryPrintHtml)，printStyleQuery 复用 printContract 的 openPrintWindow 开窗打印。
import { esc, openPrintWindow } from "./printContract";
import type { BomStyleRow } from "@/api/types";

export interface StyleQueryPrintOptions {
  起?: string | Date | null; // 日期区间起（不传则取打印时间所在月 1 号）
  止?: string | Date | null; // 日期区间止（不传则取打印时间所在月最后一天）
  打印时间?: Date;           // 右上角打印时间，默认当天
  hidePrice?: boolean;       // 默认价格(单价)脱敏为 ***
}

const pad2 = (n: number) => String(n).padStart(2, "0");
// 2026年09月01日（月/日补零）
const cnDate = (d: Date) => `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日`;
// 2026/9/8（不补零）
const slashDate = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;

const toDate = (v?: string | Date | null): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
};

// 审核情况：台头行不存在(空)则留空；'1'=已审核，其余=未审核
export const auditText = (审核?: string | null) =>
  审核 == null || 审核 === "" ? "" : 审核 === "1" ? "已审核" : "未审核";

const CSS = `
  @page{size:A4 landscape;margin:0}
  body{font-family:"Microsoft YaHei","SimSun",sans-serif;margin:0;padding:12mm;color:#000;font-size:12px}
  h2.doc-title{text-align:center;margin:2px 0 8px;font-size:18px;letter-spacing:8px}
  .head-line{display:flex;justify-content:space-between;margin:4px 0 6px;font-size:12px}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #000;padding:3px 5px;font-size:11px;text-align:left;vertical-align:top}
  th{text-align:center}
  .num{text-align:right}
  .page-foot{text-align:right;margin-top:10px;font-size:12px}
`;

// 表头列（客户编号/客户名称 系统无来源，列保留值为空）
const HEADERS = ["单据类型", "日期", "客户编号", "客户名称", "款号", "款式", "默认价格", "操作员", "审核情况"];

function masterRow(r: BomStyleRow, hidePrice: boolean): string {
  const price = hidePrice ? "***" : r.单价 == null ? "" : String(r.单价);
  const d = toDate(r.日期);
  return `<tr><td>总表</td><td>${d ? slashDate(d) : ""}</td><td></td><td>${esc(r.台头)}</td>` +
    `<td>${esc(r.款号)}</td><td>${esc(r.款式)}</td><td class="num">${esc(price)}</td>` +
    `<td>${esc(r.操作员)}</td><td>${esc(auditText(r.审核))}</td></tr>`;
}

function detailRows(r: BomStyleRow): string {
  return (r.明细 ?? []).map(m =>
    `<tr><td>明细</td><td></td><td></td><td></td><td>${esc(`${m.物料编号 ?? ""}${m.物料名称 ?? ""}`)}</td>` +
    `<td></td><td></td><td></td><td></td></tr>`).join("");
}

export function buildStyleQueryPrintHtml(rows: BomStyleRow[], opts: StyleQueryPrintOptions = {}): string {
  const now = opts.打印时间 ?? new Date();
  const 起 = toDate(opts.起) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const 止 = toDate(opts.止) ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const hidePrice = opts.hidePrice ?? false;

  const body = rows.map(r => masterRow(r, hidePrice) + detailRows(r)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>货号资料查询</title>
<style>${CSS}</style></head>
<body>
<h2 class="doc-title">货 号 资 料 查 询</h2>
<div class="head-line"><span>日期： ${cnDate(起)} 至 ${cnDate(止)}</span><span>打印时间： ${slashDate(now)}</span></div>
<table><thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${body}</tbody></table>
<div class="page-foot">共　页，第　页</div>
</body></html>`;
}

export function printStyleQuery(rows: BomStyleRow[], opts: StyleQueryPrintOptions = {}): void {
  openPrintWindow(buildStyleQueryPrintHtml(rows, opts));
}
