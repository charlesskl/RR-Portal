// 半成品仓单据纯函数(照抄老系统 web/src/utils/{semiReceiptOrder,semiIssue,semiScrap,semiStocktake}.ts):
// 选产品合并(按配件编号去重)/保存校验/入仓汇总侧表;单据打印 HTML(老系统表单页为 window.print(),
// 新系统统一开新窗口渲染单头+明细,与塑胶单据 printPlasticDoc 同口径,esc/openPrintWindow 单源在 printContract)。
import { esc, openPrintWindow } from "./printContract";

// ---------- 入仓单 ----------

export interface SemiReceiptEditLine {
  key: number;
  订单单号?: string;
  配件编号: string;
  客户?: string | null;
  产品货号: string;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  单位?: string;
  数量: number;
  单价?: number | null;
  备注?: string;
}

type ReceiptProduct = Omit<SemiReceiptEditLine, "key" | "数量"> & { 数量?: number | null };

// 按 配件编号|产品货号 去重合并(已有行保留数量,新行数量 0)
export function mergeSemiReceiptProducts(current: SemiReceiptEditLine[], selected: ReceiptProduct[]) {
  const result = [...current];
  const known = new Set(result.map((line) => `${line.配件编号}|${line.产品货号}`));
  for (const product of selected) {
    const identity = `${product.配件编号}|${product.产品货号}`;
    if (known.has(identity)) continue;
    known.add(identity);
    result.push({ ...product, key: result.length + 1, 数量: 0 });
  }
  return result.map((line, index) => ({ ...line, key: index + 1 }));
}

// 右侧汇总表:按 配件编号|产品装配名称 汇总入仓数量
export function summarizeSemiReceiptLines(lines: SemiReceiptEditLine[]) {
  const groups = new Map<string, { key: string; 配件编号: string; 产品装配名称: string; 入仓数量: number }>();
  for (const line of lines) {
    if (!line.配件编号 || line.数量 <= 0) continue;
    const name = line.产品装配名称 ?? "";
    const key = `${line.配件编号}|${name}`;
    const current = groups.get(key);
    if (current) current.入仓数量 += line.数量;
    else groups.set(key, { key, 配件编号: line.配件编号, 产品装配名称: name, 入仓数量: line.数量 });
  }
  return [...groups.values()].map((row, index) => ({ ...row, 序号: index + 1 }));
}

export function validateSemiReceipt(value: {
  供应商名称?: string;
  仓库?: string;
  明细: SemiReceiptEditLine[];
}) {
  if (!value.供应商名称?.trim()) return "请选择供应商";
  if (!value.仓库?.trim()) return "请选择收货仓库";
  if (!value.明细.some((line) => line.配件编号.trim() && line.产品货号.trim() && line.数量 > 0)) {
    return "请至少录入一行数量大于 0 的明细";
  }
  return null;
}

// ---------- 出库/报废/退库同构草稿行 ----------

export interface SemiDraftLine {
  key: number;
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  数量: number;
  备注?: string | null;
}

export interface SemiPickedProduct {
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
}

// 按配件编号去重合并(出库/报废共用,照抄 mergeSemiIssueLines/mergeSemiScrapLines 同构实现)
export function mergeSemiDraftLines(existing: SemiDraftLine[], picked: SemiPickedProduct[]): SemiDraftLine[] {
  const seen = new Map(existing.map((l) => [l.配件编号.trim(), l]));
  let key = existing.reduce((m, l) => Math.max(m, l.key), 0);
  for (const p of picked) {
    const code = p.配件编号?.trim();
    if (!code || seen.has(code)) continue;
    const row: SemiDraftLine = {
      key: ++key,
      配件编号: code,
      客户: p.客户 ?? null,
      产品货号: p.产品货号 ?? null,
      产品名称: p.产品名称 ?? null,
      产品装配名称: p.产品装配名称 ?? null,
      生产单号: p.生产单号 ?? null,
      数量: 0,
      备注: "",
    };
    seen.set(code, row);
  }
  return [...seen.values()];
}

// 出库/报废校验同构,仅名词不同(照抄 validateSemiIssue/validateSemiScrap)
export function validateSemiDraft(input: { 明细: SemiDraftLine[] }, noun: string): string | null {
  const valid = input.明细.filter((l) => l.配件编号.trim());
  if (valid.length === 0) return `请至少录入一行${noun}产品。`;
  for (const l of valid) if (Number(l.数量) <= 0) return `${noun}数量必须大于 0。`;
  const seen = new Set<string>();
  for (const l of valid) {
    const code = l.配件编号.trim();
    if (seen.has(code)) return `配件编号 ${code} 在同一单据中重复。`;
    seen.add(code);
  }
  return null;
}

// ---------- 盘点单 ----------

export interface SemiStkDraftLine {
  key: number;
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  系统数量: number;
  盘点数量: number;
  备注?: string | null;
}

// 选产品去重合并;新行的 系统数量 由 sysQty(配件编号) 查库存带出,盘点数量默认等于系统数量
export function mergeSemiStocktakeLines(
  existing: SemiStkDraftLine[],
  picked: SemiPickedProduct[],
  sysQty: (配件编号: string) => number,
): SemiStkDraftLine[] {
  const seen = new Map(existing.map((l) => [l.配件编号.trim(), l]));
  let key = existing.reduce((m, l) => Math.max(m, l.key), 0);
  for (const p of picked) {
    const code = p.配件编号?.trim();
    if (!code || seen.has(code)) continue;
    const sys = sysQty(code);
    const row: SemiStkDraftLine = {
      key: ++key,
      配件编号: code,
      客户: p.客户 ?? null,
      产品货号: p.产品货号 ?? null,
      产品名称: p.产品名称 ?? null,
      产品装配名称: p.产品装配名称 ?? null,
      系统数量: sys,
      盘点数量: sys,
      备注: "",
    };
    seen.set(code, row);
  }
  return [...seen.values()];
}

export function validateSemiStocktake(input: { 明细: SemiStkDraftLine[] }): string | null {
  const valid = input.明细.filter((l) => l.配件编号.trim());
  if (valid.length === 0) return "请至少录入一行盘点产品。";
  for (const l of valid) if (Number(l.盘点数量) < 0) return "盘点数量不能为负。";
  const seen = new Set<string>();
  for (const l of valid) {
    const code = l.配件编号.trim();
    if (seen.has(code)) return `配件编号 ${code} 在同一单据中重复。`;
    seen.add(code);
  }
  return null;
}

// ---------- 单据打印(入仓/出库/报废/盘点共用;价格列由调用方按权限裁剪) ----------

export interface SemiDocPrintCfg {
  headItems: [string, string][]; // [标签, 单头键]
  lineCols: [string, string][]; // [列标题, 行键]
}

export function buildSemiDocPrintHtml(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  cfg: SemiDocPrintCfg,
): string {
  const h = detail.单头 ?? {};
  const headHtml = cfg.headItems
    .map(
      ([k, key]) =>
        `<span class="hi"><b>${esc(k)}：</b>${esc(key === "日期" || key === "审核日期" ? String(h[key] ?? "").slice(0, 10) : h[key])}</span>`,
    )
    .join("");
  const thead = `<tr>${cfg.lineCols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr>`;
  const tbody = detail.明细
    .map((l) => `<tr>${cfg.lineCols.map(([, k]) => `<td>${esc(l[k])}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;margin:24px;color:#000}
  h2{text-align:center;margin:0 0 16px}
  .head{display:flex;flex-wrap:wrap;gap:6px 22px;margin-bottom:14px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #333;padding:4px 6px;text-align:left}
  th{background:#f0f0f0}
  @page{size:A4;margin:0}
  @media print{body{margin:0;padding:10mm}}
</style></head>
<body>
  <h2>${esc(title)}</h2>
  <div class="head">${headHtml}</div>
  <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
</body></html>`;
}

export function printSemiDoc(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  cfg: SemiDocPrintCfg,
): void {
  openPrintWindow(buildSemiDocPrintHtml(title, detail, cfg));
}
