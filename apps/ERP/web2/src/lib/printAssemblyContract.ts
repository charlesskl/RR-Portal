// 装配加工采购单 ->「委托加工合同」打印模板(照抄老系统 DS261005 原单版式;
// 共享素材 公司抬头/注意事项/CSS 复用 lib/printContract.ts)。
// 版式要点(对照原单扫描件):宋体正文/加粗抬头/取值下划线/日期中文(2026年10月05日)/
// 数量千分位/明细 10 行定高、空行序号预填/备注+交货条款边框盒/物料汇总三列/尾部空备注盒/注意事项标题。
import type { AssemblyPurchaseOrderDetail, AssemblyPurchaseOrderHeader } from "@/api/types";
import {
  COMPANY_FAX,
  COMPANY_TEL,
  PRINT_NOTES,
  companyHeaderHtml,
  esc,
  openPrintWindow,
  wrapPrintHtml,
} from "./printContract";

const MIN_ROWS = 10;
const sep = (n: number) => n.toLocaleString("en-US");
const sepInt = (v?: number | null) => (v == null ? "" : sep(Math.round(Number(v))));
const sep2 = (v?: number | null) =>
  v == null
    ? ""
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numRaw = (v?: number | null) => (v == null ? "" : String(v));
// 2026年10月05日(月/日补零,对照原单日期写法)
const cnDate = (v?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "").slice(0, 10));
  return m ? `${m[1]}年${m[2]}月${m[3]}日` : "";
};
// 下划线取值框(原单版式:值压在下划线上)
const u = (v: unknown, cls = "u") => `<span class="${cls}">${esc(v)}</span>`;

// 委托加工合同(装配)专属版式:叠加在 printContract 基础 css 之上(同优先级后写生效)
const CONTRACT_CSS = `
  body{font-family:"SimSun","宋体",serif;font-size:13px;padding:10mm}
  .co-head .name{font-size:24px;letter-spacing:6px}
  .co-head div{font-size:12.5px;font-weight:700}
  h2.doc-title{font-size:20px;margin:4px 0 8px}
  .u{display:inline-block;min-width:150px;border-bottom:1px solid #000;padding:0 4px;text-align:center;vertical-align:bottom}
  .u.lg{min-width:220px}
  .u.sm{min-width:110px}
  .u.xs{min-width:50px}
  .ct-info{display:flex;justify-content:space-between;line-height:1.9}
  .ct-line{display:flex;justify-content:space-between;line-height:1.9}
  .ct-grid{margin-top:6px}
  .ct-grid th,.ct-grid td{font-size:12px;padding:2px 6px}
  .ct-grid tbody tr{height:7mm}
  .ct-box{margin-top:-1px}
  .ct-box td{font-size:12px;line-height:1.7}
  .ct-notes{margin-top:6px;line-height:1.6;font-size:11px}
  .ct-notes-t{font-weight:700}
  .ct-sign{display:flex;justify-content:space-between;margin-top:8px;line-height:2;font-size:13px}
`;

export function buildAssemblyContractPrintHtml(detail: AssemblyPurchaseOrderDetail): string {
  const h = detail.单头 ?? ({} as AssemblyPurchaseOrderHeader);
  const prod = detail.生产明细 ?? [];
  const 装配方式 = detail.产品明细?.find((p) => p.装配方式)?.装配方式 ?? "";
  const 加工总数量 =
    prod.reduce((s, l) => s + Number(l.加工数量 ?? 0), 0) ||
    detail.产品明细?.[0]?.加工数量 ||
    0;

  const dataRows = prod.map((l, i) => {
    const amt =
      l.金额 ??
      (l.加工数量 != null && l.单价 != null ? Number(l.加工数量) * Number(l.单价) : null);
    return (
      `<tr><td class="ctr">${i + 1}</td><td>${esc(l.产品货号)}</td><td>${esc(l.生产单号)}</td>` +
      `<td>${esc(l.产品装配名称 ?? l.产品名称)}</td><td>${esc(装配方式)}</td>` +
      `<td class="num">${sepInt(l.加工数量)}</td><td class="num">${l.单价 ? numRaw(l.单价) : ""}</td><td class="num">${amt ? sep2(amt) : ""}</td><td></td></tr>`
    );
  });
  // 不足 10 行补空行(序号预填,对照原单)
  for (let i = dataRows.length; i < MIN_ROWS; i++)
    dataRows.push(`<tr><td class="ctr">${i + 1}</td>${"<td>&nbsp;</td>".repeat(8)}</tr>`);

  // 物料汇总:辅料按名称聚合克重(KG,2位),原单三列排布
  const agg = new Map<string, number>();
  for (const a of detail.辅料表 ?? []) {
    if (!a.辅料名称 || a.需求数克 == null) continue;
    agg.set(a.辅料名称, (agg.get(a.辅料名称) ?? 0) + Number(a.需求数克));
  }
  const aggEntries = [...agg.entries()];
  const aggRows: string[] = [];
  for (let i = 0; i < aggEntries.length; i += 3) {
    const cell = ([name, g]: [string, number]) =>
      `<td style="width:33.33%">〖${esc(name)}〗 总重：${(g / 1000).toFixed(2)} KG ；</td>`;
    aggRows.push(
      `<tr>${cell(aggEntries[i])}${i + 1 < aggEntries.length ? cell(aggEntries[i + 1]) : "<td></td>"}${i + 2 < aggEntries.length ? cell(aggEntries[i + 2]) : "<td></td>"}</tr>`,
    );
  }
  const aggHtml = aggRows.length
    ? `<table class="ct-box"><tbody>${aggRows.join("")}</tbody></table>`
    : "";

  const body = `
${companyHeaderHtml()}
<h2 class="doc-title">委托加工合同</h2>
<div class="ct-info">
  <div>
    <div>加工厂：${u(h.供应商名称, "u lg")}</div>
    <div>联系人：${u(h.供应商联系人, "u lg")}</div>
    <div>TEL：${u(h.供应商电话, "u lg")}</div>
    <div>Fax：${u(h.供应商传真, "u lg")}</div>
  </div>
  <div>
    <div>订单单号：${u(h.单号)}</div>
    <div>出单日期：${u(cnDate(h.出单日期))}</div>
    <div>联系人：${u(h.操作员)}</div>
    <div>TEL：${u(COMPANY_TEL)}</div>
    <div>Fax：${u(COMPANY_FAX)}</div>
  </div>
</div>
<div class="ct-line">
  <span>开始交货日期：${u(cnDate(h.开始交货日期), "u sm")}</span>
  <span>每天交货数量：${u(h.每天交货 ?? "", "u sm")}</span>
  <span>完成日期：${u(cnDate(h.完成日期), "u sm")}</span>
</div>
<div class="ct-line">
  <span>加工总数量：${u(sep(加工总数量), "u sm")}</span>
  <span>单价(￥)：${u(numRaw(h.单价), "u sm")}</span>
  <span>金额(￥)：${u(sep2(h.金额), "u sm")}</span>
</div>
<table class="ct-grid"><thead><tr>
  <th>序号</th><th>产品货号</th><th>生产单号</th><th>产品装配名称</th><th>装配方式</th><th>加工数量</th><th>单价(￥)</th><th>金额(￥)</th><th>备注</th>
</tr></thead><tbody>${dataRows.join("")}</tbody></table>
<table class="ct-box"><tbody>
  <tr><td style="width:70%">备注：${esc(h.备注)}</td><td>锡线总需求量：</td></tr>
  <tr><td colspan="2">1、${u(cnDate(h.完成日期 ?? h.开始交货日期), "u sm")} 前交货货送 ${u("A栋三楼", "u sm")} 处，收货人：${u(h.收货人, "u sm")}</td></tr>
  <tr><td colspan="2">2、单价已含 ${u("", "u xs")} %增值税，月结 ${u("", "u xs")} 天；</td></tr>
  <tr><td colspan="2">3、货物及部件质量符合国外现行最新标准</td></tr>
</tbody></table>
${aggHtml}
<table class="ct-box"><tbody><tr><td style="height:7mm;vertical-align:top">备注：</td></tr></tbody></table>
<div class="ct-notes"><div class="ct-notes-t">注意事项：</div>${PRINT_NOTES.map((n) => `<div>${esc(n)}</div>`).join("")}</div>
<div class="ct-sign"><span>供应商确认：____________</span><span>采购签核：____________</span><span>业务：____________</span><span>主管：____________</span><span>经理：____________</span></div>
<div class="ct-sign"><span>日期：____年__月__日</span><span>日期：____年__月__日</span><span>共　页，第　页</span></div>`;
  return wrapPrintHtml(`委托加工合同 ${h.单号 ?? ""}`, body, CONTRACT_CSS);
}

// 新窗口打印委托加工合同(装配)。
export function printAssemblyContract(detail: AssemblyPurchaseOrderDetail): void {
  openPrintWindow(buildAssemblyContractPrintHtml(detail));
}
