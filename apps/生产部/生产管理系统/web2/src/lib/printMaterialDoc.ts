import type { MaterialDocLine } from "@/api/types";
import { esc, openPrintWindow } from "./printContract";

// 打印物料单据(采购入仓/退仓):开新窗口渲染单头+明细表格并触发浏览器打印。
// 对照老系统 web/src/utils/printDoc.ts;尊重价格保密(hidePrice 不出单价/金额列)。
// esc/openPrintWindow 单源在 lib/printContract.ts(Batch 0E 收敛)。

const money = (v: unknown) => (v == null ? "***" : String(v));

export interface MaterialDocPrintHeader {
  单号?: string;
  日期?: string;
  操作员?: string;
  备注?: string;
  [k: string]: unknown;
}

export function buildMaterialDocPrintHtml(
  title: string,
  detail: { 单头: MaterialDocPrintHeader | null; 明细: MaterialDocLine[] },
  opts: { hidePrice: boolean; headerFields: { name: string; label: string }[] },
): string {
  const h = (detail.单头 ?? {}) as Record<string, unknown>;
  const lines = detail.明细 ?? [];
  const showProd = lines.some((l) => l.生产单号 || l.款号);

  const headItems: [string, unknown][] = [
    ["单号", h.单号],
    ["日期", String(h.日期 ?? "").slice(0, 10)],
    ...opts.headerFields.map((f) => [f.label, h[f.name]] as [string, unknown]),
    ["操作员", h.操作员],
    ["备注", h.备注],
  ];
  const headHtml = headItems
    .map(([k, v]) => `<span class="hi"><b>${esc(k)}：</b>${esc(v)}</span>`)
    .join("");

  const cols = [
    ...(showProd ? [["生产单号", "生产单号"], ["款号", "款号"]] : []),
    ["物料编号", "物料编号"],
    ["物料名称", "物料名称"],
    ["规格", "规格"],
    ["材料", "物料类别"],
    ["颜色", "颜色"],
    ["单位", "单位"],
    ["数量", "数量"],
    ...(opts.hidePrice ? [] : [["单价", "单价"], ["金额", "金额"]]),
  ] as [string, string][];

  const thead = `<tr>${cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr>`;
  const tbody = lines
    .map(
      (l) =>
        `<tr>${cols
          .map(([t, k]) => {
            const v = (l as Record<string, unknown>)[k];
            return `<td>${t === "单价" || t === "金额" ? esc(money(v)) : esc(v)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#000}
  h2{text-align:center;margin:0 0 16px}
  .head{display:flex;flex-wrap:wrap;gap:6px 22px;margin-bottom:14px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left}
  th{background:#f0f0f0}
  td:last-child,th:last-child{text-align:right}
  @page{size:A4;margin:0}
  @media print{body{margin:0;padding:10mm}}
</style></head>
<body>
  <h2>${esc(title)}</h2>
  <div class="head">${headHtml}</div>
  <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`;
}

export function printMaterialDoc(
  title: string,
  detail: { 单头: MaterialDocPrintHeader | null; 明细: MaterialDocLine[] },
  opts: { hidePrice: boolean; headerFields: { name: string; label: string }[] },
): void {
  openPrintWindow(buildMaterialDocPrintHtml(title, detail, opts));
}
