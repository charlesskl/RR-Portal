// 来料仓采购订单 ->「採購單」打印模板(照抄老系统 web/src/utils/printPurchaseOrder.ts)。
// 公司抬头/7 条注意事项/落款/A4 CSS/esc/开新窗口等共享素材单源在 lib/printContract.ts
// (Batch 0E 收敛,此前为本文件内嵌副本);装配加工合同模板(printAssemblyContract)同源。
// 纯函数 build*Html 输出完整 HTML;print* 开新窗口打印(模式A,样式天然隔离)。
// hidePrice 时单价/金额/合計以 *** 脱敏。
import type { PurchaseOrderDetail, PurchaseOrderHeader } from "@/api/types";
import {
  COMPANY_FAX,
  COMPANY_NAME,
  COMPANY_TEL,
  companyHeaderHtml,
  d10,
  esc,
  footerHtml,
  notesHtml,
  openPrintWindow,
  wrapPrintHtml,
} from "./printContract";

const num = (v?: number | null) => (v == null ? "" : String(v));

export function buildPurchaseOrderPrintHtml(
  detail: PurchaseOrderDetail,
  opts: { hidePrice?: boolean } = {},
): string {
  const hide = !!opts.hidePrice;
  const h = detail.单头 ?? ({} as PurchaseOrderHeader);
  const lines = detail.明细 ?? [];
  // 无价格权限:单价/金额/合計不输出(***)
  const money = (v?: number | null) => (hide ? "***" : num(v));

  const 货币 = h.供应商货币?.trim() || "港币";
  const 生产单号 =
    h.生产单号?.trim() ||
    [...new Set(lines.map((l) => l.生产单号?.trim()).filter((x): x is string => !!x))].join("、");

  const rows = lines
    .map((l) => {
      const amt =
        l.金额 ?? (l.数量 != null && l.单价 != null ? Number(l.数量) * Number(l.单价) : null);
      const name = [esc(l.物料名称), esc(l.规格)].filter(Boolean).join("<br>");
      return `<tr><td>${esc(l.款号)}</td><td>${name}</td><td class="num">${num(l.数量)}</td><td class="ctr">${esc(l.单位)}</td>`
        + `<td class="num">${money(l.单价)}</td><td class="num">${money(amt)}</td>`
        + `<td>${esc(l.物料编号)}</td><td>${esc(l.备注)}</td></tr>`;
    })
    .join("");

  const totalAmt = h.金额 ?? lines.reduce((s, l) => s + Number(l.金额 ?? 0), 0);
  const totalRow = `<tr><td colspan="5" class="ctr">合計</td><td class="num">${hide ? "***" : num(totalAmt)}</td><td colspan="2">(HK$)</td></tr>`;

  const body = `
${companyHeaderHtml()}
<h2 class="doc-title">採購單</h2>
<table class="head-box"><tbody><tr>
  <td style="width:55%">
    <div>供應商：${esc(h.供应商名称)}</div>
    <div>聯繫人：${esc(h.供应商联系人)}</div>
    <div>TEL：${esc(h.供应商电话)}</div>
    <div>Fax：${esc(h.供应商传真)}</div>
  </td>
  <td>
    <div>採購單編號：${esc(h.单号)}</div>
    <div>日期：${d10(h.日期)}</div>
    <div>聯系人：${esc(h.收件人)}</div>
    <div>TEL:${COMPANY_TEL}&nbsp;&nbsp;Fax:${COMPANY_FAX}</div>
  </td>
</tr></tbody></table>
<div class="kv-line">货币：${esc(货币)}</div>
<table><thead><tr>
  <th>貨號</th><th>貨物名稱</th><th>數量</th><th>單位</th><th>單價</th><th>金額(HK$)</th><th>物料編號</th><th>備註</th>
</tr></thead><tbody>${rows}${totalRow}</tbody></table>
<div class="terms">
  <div>1、${d10(h.交货日期)} 前交货货送 ${esc(COMPANY_NAME)} 处，收货人：${esc(h.收件人)}</div>
  <div>2、单价已含 ___%增值税，月结 ___天；附送免费1%备品</div>
  <div>3、货物及部件质量符合国外现行最新标准</div>
</div>
<div class="kv-line">生产单号：${esc(生产单号)}</div>
${notesHtml()}
${footerHtml()}`;
  return wrapPrintHtml(`採購單 ${h.单号 ?? ""}`, body);
}

// 新窗口打印採購單。
export function printPurchaseOrder(
  detail: PurchaseOrderDetail,
  opts: { hidePrice?: boolean } = {},
): void {
  openPrintWindow(buildPurchaseOrderPrintHtml(detail, opts));
}
