// 塑胶退仓单/塑胶报废单 共享纯逻辑(两单据后端同构:塑胶供应商单据,单级审核=过账;
// 对照老系统 web/src/pages/plastics/PlasticSupplierDocFormPage.tsx + PlasticSupplierDocLineTable.tsx
// 与 PlasticReceiptFormPage.tsx(cfg=plastic-warehouse-returns))。
import type { PlasticReceiptDetail, PlasticReceiptLine } from "@/api/types";

// ---------- 报废单明细编辑行(保真列序:生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注) ----------

export interface ScrapEditLine {
  key: number;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  塑胶货号?: string;
  仓位号?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换
  单价: string;
  备注?: string;
}

// 从塑胶入仓单带出明细(报废单/退仓单「选入仓单带出」共用;对照老系统 bringFromReceipt)
export const receiptLineToScrapLine = (
  l: PlasticReceiptLine,
  key: number,
): ScrapEditLine => ({
  key,
  物料编号: l.物料编号,
  物料名称: l.物料名称,
  规格: l.规格,
  颜色: l.颜色,
  仓位号: l.仓位号,
  单位: l.单位,
  数量: String(Number(l.数量 ?? 0)),
  单价: l.单价 != null ? String(l.单价) : "",
});

// 提交前过滤:必须有物料编号且数量>0(对照老系统 save 的 ok 过滤)
export const validScrapLines = (lines: ScrapEditLine[]) =>
  lines.filter((l) => !!l.物料编号 && Number(l.数量 || 0) > 0);

export const sumScrapQty = (lines: ScrapEditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0), 0);

export const sumScrapAmount = (lines: ScrapEditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0) * (Number(l.单价) || 0), 0);

// 编辑行 -> 提交明细(空串不带;数量转数值;单价空不带)
export const toSubmitScrapLine = (l: ScrapEditLine): PlasticReceiptLine => {
  const t = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    生产单号: t(l.生产单号),
    款号: t(l.款号),
    物料编号: t(l.物料编号),
    物料名称: t(l.物料名称),
    规格: t(l.规格),
    颜色: t(l.颜色),
    塑胶货号: t(l.塑胶货号),
    仓位号: t(l.仓位号),
    单位: t(l.单位),
    数量: Number(l.数量),
    单价: l.单价.trim() !== "" ? Number(l.单价) : undefined,
    备注: t(l.备注),
  };
};

// ---------- 打印(老系统表单页为 window.print();新系统统一开新窗口渲染单头+明细,
// 与塑胶入仓单 printPlasticReceipt 同口径) ----------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

export interface PlasticDocPrintCfg {
  // 单头字段(标签 -> 单头键)
  headItems: [string, string][];
  // 明细列(标题 -> 行键);hidePrice 时由调用方先剔除价格列
  lineCols: [string, string][];
}

export function buildPlasticDocPrintHtml(
  title: string,
  detail: PlasticReceiptDetail,
  cfg: PlasticDocPrintCfg,
): string {
  const h = (detail.单头 ?? {}) as Record<string, unknown>;
  const lines = (detail.明细 ?? []) as unknown as Record<string, unknown>[];
  const headHtml = cfg.headItems
    .map(([k, key]) => `<span class="hi"><b>${esc(k)}：</b>${esc(key === "日期" ? String(h[key] ?? "").slice(0, 10) : h[key])}</span>`)
    .join("");
  const thead = `<tr>${cfg.lineCols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr>`;
  const tbody = lines
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

export function printPlasticDoc(
  title: string,
  detail: PlasticReceiptDetail,
  cfg: PlasticDocPrintCfg,
): void {
  const w = window.open("", "_blank", "width=1100,height=760");
  if (!w) return;
  w.document.write(buildPlasticDocPrintHtml(title, detail, cfg));
  w.document.close();
  w.focus();
  w.print();
}
