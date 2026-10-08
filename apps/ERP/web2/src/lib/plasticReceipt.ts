import type {
  PlasticPurchaseProgressRow,
  PlasticReceiptLine,
} from "@/api/types";

// 塑胶入仓单纯逻辑(对照老系统 web/src/pages/plastics/PlasticReceiptFormPage.tsx
// 与 PlasticReceiptLineTable.tsx;打印对照表单页 window.print() 口径,新系统开新窗口渲染)。

// ---------- 明细编辑行 ----------

// 塑胶入仓明细编辑行(保真列序:订单单号|生产单号|款号|物料编号|工模编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注)
export interface EditLine {
  key: number;
  订单单号?: string;
  生产单号?: string;
  // 从采购单带入且采购行带生产单号 -> 该行生产单号锁死不可改(贯穿到入库/统计;同 Task 4 replenishPoLock 口径)
  锁定生产单号?: boolean;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  塑胶货号?: string;
  仓位号?: string;
  工模编号?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换
  单价: string;
  备注?: string;
  // 供应商多送的备品:允许超订单数量入库,不占订单欠数
  备品?: boolean;
}

// 进度表欠数行 -> 明细行(数量默认=欠数即全收;订单单号=采购单号;
// 采购行带生产单号则锁定,无生产单号的行维持可编辑。照抄老系统 bringFromPurchaseOrder 的映射)
export const progressRowToLine = (
  r: PlasticPurchaseProgressRow,
  采购单号: string,
  key: number,
): EditLine => ({
  key,
  订单单号: 采购单号,
  生产单号: r.生产单号 ?? undefined,
  锁定生产单号: r.生产单号 ? true : undefined,
  款号: r.款号 ?? undefined,
  工模编号: r.模具编号 ?? undefined,
  物料编号: r.物料编号 ?? undefined,
  物料名称: r.物料名称 ?? undefined,
  颜色: r.颜色 ?? undefined,
  单位: r.单位 ?? undefined,
  数量: String(Number(r.欠数 ?? 0)),
  单价: "",
});

// 「从采购单带入」弹窗数据源:欠数行(只保留已审核单)按采购单号去重,保首现序
export function owedOrders(rows: PlasticPurchaseProgressRow[]): PlasticPurchaseProgressRow[] {
  const m = new Map<string, PlasticPurchaseProgressRow>();
  for (const r of rows) {
    if (r.审核 !== "1" || !r.采购单号) continue;
    if (!m.has(r.采购单号)) m.set(r.采购单号, r);
  }
  return [...m.values()];
}

// 弹窗内关键字前端过滤:采购单号/供应商名称(进度表 keyword 不匹配单号,照抄老系统 ppoOrders)
export function filterOwedOrders(
  orders: PlasticPurchaseProgressRow[],
  kw: string,
): PlasticPurchaseProgressRow[] {
  const k = kw.trim();
  if (!k) return orders;
  return orders.filter(
    (r) => (r.采购单号 ?? "").includes(k) || (r.供应商名称 ?? "").includes(k),
  );
}

// 提交前过滤:必须有物料编号且数量>0(对照老系统 save 的 ok 过滤)
export const validLines = (lines: EditLine[]) =>
  lines.filter((l) => !!l.物料编号 && Number(l.数量 || 0) > 0);

export const sumQty = (lines: EditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0), 0);

export const sumAmount = (lines: EditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0) * (Number(l.单价) || 0), 0);

// 编辑行 -> 提交明细(空串不带;数量转数值;单价空不带;备品勾选传 "1"。对照后端 PlasticReceiptCreateLineDto)
export const toSubmitLine = (l: EditLine): PlasticReceiptLine => {
  const t = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    订单单号: t(l.订单单号),
    生产单号: t(l.生产单号),
    款号: t(l.款号),
    工模编号: t(l.工模编号),
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
    备品: l.备品 ? "1" : undefined,
  };
};

// ---------- 打印(老系统表单页为 window.print();新系统统一开新窗口渲染单头+明细) ----------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

// 打印列与明细编辑列同序(保真);hidePrice 时不出单价/金额列(后端同时把单价/金额置 null 兜底)
const PRINT_COLS = (hidePrice: boolean): [string, string][] => [
  ["订单单号", "订单单号"],
  ["生产单号", "生产单号"],
  ["款号", "款号"],
  ["物料编号", "物料编号"],
  ["工模编号", "工模编号"],
  ["物料名称", "物料名称"],
  ["颜色", "颜色"],
  ["塑胶货号", "塑胶货号"],
  ["单位", "单位"],
  ["数量", "数量"],
  ...(hidePrice ? [] : ([["单价", "单价"], ["金额", "金额"]] as [string, string][])),
  ["备注", "备注"],
];

export function buildPlasticReceiptPrintHtml(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  opts: { hidePrice: boolean },
): string {
  const h = detail.单头 ?? {};
  const lines = detail.明细 ?? [];
  const headItems: [string, unknown][] = [
    ["送货单号", h.单号],
    ["日期", String(h.日期 ?? "").slice(0, 10)],
    ["供应商", h.供应商名称],
    ["仓库", h.仓库],
    ["入库单号", h.入仓单号],
    ["订单单号", h.订单单号],
    ["电脑单号", h.电脑单号],
    ["操作员", h.操作员],
    ["备注", h.备注],
  ];
  const headHtml = headItems
    .map(([k, v]) => `<span class="hi"><b>${esc(k)}：</b>${esc(v)}</span>`)
    .join("");
  const cols = PRINT_COLS(opts.hidePrice);
  const thead = `<tr>${cols.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr>`;
  const tbody = lines
    .map((l) => `<tr>${cols.map(([, k]) => `<td>${esc(l[k])}</td>`).join("")}</tr>`)
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

export function printPlasticReceipt(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  opts: { hidePrice: boolean },
): void {
  const w = window.open("", "_blank", "width=1100,height=760");
  if (!w) return;
  w.document.write(buildPlasticReceiptPrintHtml(title, detail, opts));
  w.document.close();
  w.focus();
  w.print();
}
