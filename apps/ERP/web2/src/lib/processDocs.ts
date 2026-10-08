// Batch 6 喷油/加工群单据纯函数(塑胶加工采购单/白件领料单/喷油加工订单制作共用;
// 照抄老系统 web/src/pages/plastics/{PlasticProcessPurchaseOrderPage,PlasticWhitePartIssuePage,PlasticProcessOrderMakePage}.tsx 内联逻辑)。
// 打印复用半成品单据的通用渲染(buildSemiDocPrintHtml 是 单头键值+明细列 配置驱动,与具体仓无关)。
import type {
  PPPOBasisRow,
  PPPOLine,
  SprayOrderReceivedRow,
  PlasticProcessOrderMakeRow,
  WPILine,
} from "@/api/types";
import { 二次加工字母 } from "./secondProcess";
import { factoryCategoryMatches } from "./factoryProcessMatch";
import { buildSemiDocPrintHtml, printSemiDoc, type SemiDocPrintCfg } from "./semiDocs";

// ---------- 三级流转状态徽章(未审核/主管已审/经理已审/已审核;两单据页同构) ----------

export interface ChainHeader {
  审核?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}

// 返回 [className, 文案];文案带审核人(对照老系统 statusTag:主管已审(张三))
export function chainBadge(h: ChainHeader | null | undefined): [string, string] {
  if (h?.审核 === "1")
    return ["border-[#16a34a]/60 bg-[#16a34a]/10 text-[#15803d]", "已审核"];
  if (h?.经理审核 === "1")
    return [
      "border-[#2563eb]/50 bg-[#2563eb]/10 text-[#2563eb]",
      `经理已审${h.经理审核人 ? `(${h.经理审核人})` : ""}`,
    ];
  if (h?.主管审核 === "1")
    return [
      "border-[#b45309]/40 bg-[#b45309]/10 text-[#b45309]",
      `主管已审${h.主管审核人 ? `(${h.主管审核人})` : ""}`,
    ];
  return ["border-black/10 bg-black/5 text-[#5f6b7d]", "未审核"];
}

// ---------- 塑胶加工采购单:明细可见性 + 显示/完整清单合并 ----------

// 明细可见性:加工内容与厂类别一致才显示;纯手工加的空白行(无物料编号且无加工内容)始终可见,便于手录
export function processLineVisible(l: PPPOLine, factoryCat?: string): boolean {
  return (
    factoryCategoryMatches(factoryCat, l.加工内容) ||
    (!l.物料编号 && !(l.加工内容 ?? "").trim())
  );
}

// 把「只显示可见行」的编辑结果按下标位置合并回完整清单(对照老系统 syncShown):
// 可见行被 next 替换(next 里没有=该行被删除);next 多出的新行追加到末尾。
export function mergeShownEdit<T>(prev: T[], isVisible: (l: T) => boolean, next: T[]): T[] {
  const pos = new Set(prev.map((l, i) => (isVisible(l) ? i : -1)).filter((i) => i >= 0));
  const out: T[] = [];
  let k = 0;
  for (let i = 0; i < prev.length; i++) {
    if (!pos.has(i)) {
      out.push(prev[i]);
      continue;
    }
    if (k < next.length) out.push(next[k++]);
  }
  for (; k < next.length; k++) out.push(next[k]);
  return out;
}

// 与厂类别一致的行数(调入/选厂提示用)
export function matchCount(ls: PPPOLine[], cat?: string): number {
  return ls.filter((l) => factoryCategoryMatches(cat, l.加工内容)).length;
}

// 调入加工清单:二次加工(BD/AF/AH)的 BOM 行展开为 第一次/第二次 两条明细,便于按加工次序分给不同供应商下单
export function expandProcessBasis(bom: PPPOBasisRow[]): PPPOLine[] {
  const ls: PPPOLine[] = [];
  for (const b of bom) {
    const base: PPPOLine = {
      生产单号: b.生产单号,
      款号: b.款号,
      模具编号: b.模具编号,
      物料编号: b.物料编号,
      物料名称: b.物料名称,
      用料名称: b.用料名称,
      颜色: b.颜色,
      加工内容: b.加工内容,
      数量: 0,
      单价: b.单价 ?? 0,
    };
    if (b.二次加工类别) {
      ls.push({
        ...base,
        加工次序: "第一次",
        加工字母: 二次加工字母(b.二次加工类别, b.加工内容) ?? undefined,
      });
      ls.push({
        ...base,
        加工内容: b.二次加工内容,
        加工次序: "第二次",
        加工字母: 二次加工字母(b.二次加工类别, b.二次加工内容) ?? undefined,
      });
    } else {
      ls.push(base);
    }
  }
  return ls;
}

// 保存校验:只下显示出来的行(与厂类别一致的);隐藏的不一致行不下单。返回 null=通过
export function validateProcessPurchaseLines(
  shownLines: PPPOLine[],
  factoryCat?: string,
): string | null {
  const ok = shownLines.filter((l) => l.物料编号 && Number(l.数量) > 0);
  if (ok.length > 0) return null;
  return factoryCat
    ? `没有与厂类别[${factoryCat}]一致的有效物料明细(物料编号+数量),无法下单`
    : "请至少录入一行有效物料明细(物料编号+数量)";
}

export function validProcessPurchaseLines(shownLines: PPPOLine[]): PPPOLine[] {
  return shownLines.filter((l) => l.物料编号 && Number(l.数量) > 0);
}

// ---------- 白件领料单 ----------

// 保存校验:至少一行有效物料明细(物料编号+数量);返回 null=通过
export function validateWpiLines(lines: WPILine[]): string | null {
  return lines.some((l) => l.物料编号 && Number(l.数量) > 0)
    ? null
    : "请至少录入一行有效物料明细(物料编号+数量)";
}

export function validWpiLines(lines: WPILine[]): WPILine[] {
  return lines.filter((l) => l.物料编号 && Number(l.数量) > 0);
}

// ---------- 喷油加工订单制作:已下喷油订单分组/带入 ----------

export interface SprayOrderGroup {
  单号: string;
  供应商名称?: string;
  单据日期?: string;
  交货日期?: string;
  行数: number;
  数量合计: number;
  接收?: string;
  接收人?: string;
  接收时间?: string;
}

// 「接收订单」弹窗:按采购单号聚合成单(对照老系统 spoGroups)
export function groupSprayOrders(recvRows: SprayOrderReceivedRow[]): SprayOrderGroup[] {
  const m = new Map<string, SprayOrderGroup>();
  for (const r of recvRows) {
    const k = r.采购单号 ?? "";
    const g =
      m.get(k) ?? {
        单号: k,
        供应商名称: r.供应商名称,
        单据日期: r.单据日期,
        交货日期: r.交货日期,
        行数: 0,
        数量合计: 0,
        接收: r.喷油接收,
        接收人: r.喷油接收人,
        接收时间: r.喷油接收时间,
      };
    g.行数++;
    g.数量合计 += Number(r.数量 ?? 0);
    m.set(k, g);
  }
  return [...m.values()];
}

// 接收状态列跨行合并:返回 采购单号 -> { count, first }(对照老系统 recvGroups;first=组首行下标)
export function sprayRowSpanGroups(
  recvRows: SprayOrderReceivedRow[],
): Map<string, { count: number; first: number }> {
  const m = new Map<string, { count: number; first: number }>();
  recvRows.forEach((r, i) => {
    const k = r.采购单号 ?? "";
    const g = m.get(k);
    if (g) g.count++;
    else m.set(k, { count: 1, first: i });
  });
  return m;
}

// 带入已接收的喷油采购单:该单明细映射为制作表行(订购数量=订单数量,单位 个;对照老系统 demandRows)
export function bringSprayRows(
  recvRows: SprayOrderReceivedRow[],
  spo: string,
): PlasticProcessOrderMakeRow[] {
  return recvRows
    .filter((r) => r.采购单号 === spo)
    .map((r) => ({
      单据日期: r.单据日期,
      生产单号: r.生产单号,
      款号: r.款号,
      塑胶货号: r.塑胶货号,
      工模编号: r.模具编号,
      物料编号: r.物料编号,
      物料名称: r.物料名称,
      颜色: r.颜色,
      色粉号: r.色粉号,
      加工内容: r.加工内容,
      用料名称: r.用料名称,
      单位: "个",
      订购数量: r.数量 ?? null,
    }));
}

// ---------- 单据打印(两单据页共用通用渲染;列由调用方按权限裁剪) ----------

export const PPPO_PRINT_CFG = (hidePrice: boolean): SemiDocPrintCfg => ({
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["交货日期", "交货日期"],
    ["加工厂", "加工厂名称"],
    ["客户名称", "客户名称"],
    ["收货仓库", "收货仓库"],
    ["收货人", "收货人"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["生产单号", "生产单号"],
    ["款号", "款号"],
    ["模具编号", "模具编号"],
    ["物料编号", "物料编号"],
    ["物料名称", "物料名称"],
    ["用料名称", "用料名称"],
    ["颜色", "颜色"],
    ["加工内容", "加工内容"],
    ["加工次序", "加工次序"],
    ["数量", "数量"],
    ...(hidePrice ? [] : ([["单价", "单价"], ["金额", "金额"]] as [string, string][])),
    ["备注", "备注"],
  ],
});

export const WPI_PRINT_CFG: SemiDocPrintCfg = {
  headItems: [
    ["单号", "单号"],
    ["日期", "日期"],
    ["领料部门", "领料部门"],
    ["领料人", "领料人"],
    ["胶箱数", "胶箱数"],
    ["卡板数", "卡板数"],
    ["领料备注", "领料备注"],
    ["操作员", "操作员"],
    ["备注", "备注"],
  ],
  lineCols: [
    ["发外采购", "发外采购"],
    ["生产单号", "生产单号"],
    ["款号", "款号"],
    ["模具编号", "模具编号"],
    ["物料编号", "物料编号"],
    ["物料名称", "物料名称"],
    ["颜色", "颜色"],
    ["用料名称", "用料名称"],
    ["单位", "单位"],
    ["数量", "数量"],
    ["备注", "备注"],
  ],
};

export function printProcessDoc(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  cfg: SemiDocPrintCfg,
): void {
  printSemiDoc(title, detail, cfg);
}

export { buildSemiDocPrintHtml };
