// 塑胶采购订单纯逻辑(对照老系统 web/src/pages/plastics/PlasticPurchaseOrderPage.tsx +
// PlasticPurchaseOrderDrawer.tsx + web/src/utils/printPlasticContract.ts + printMoldingSheet.ts)。
// 打印素材复用 lib/printContract.ts 单源(esc/抬头/7 条注意事项/落款/A4 CSS)。
import type {
  PlasticPurchaseOrderBasisRow,
  PlasticPurchaseOrderDetail,
  PlasticPurchaseOrderHeader,
  PlasticPurchaseOrderLine,
} from "@/api/types";
import {
  COMPANY_FAX,
  COMPANY_TEL,
  companyHeaderHtml,
  d10,
  esc,
  footerHtml,
  notesHtml,
  openPrintWindow,
  wrapPrintHtml,
} from "./printContract";

// ---------- 加工内容选项 ----------

// 固定集合并上接口值(防止新类型选不了;对照老系统 processingContents 并集)
export const PROCESS_CONTENT_FIXED = ["印喷", "移印", "喷油", "电镀", "植绒", "植发"];
export const mergeProcessContents = (apiList: string[]): string[] => [
  ...new Set([...apiList, ...PROCESS_CONTENT_FIXED]),
];

// 喷油下单判定:供应商名含「喷油」(单头 加工内容 必填,只下印喷类物料)
export const is喷油供应商 = (供应商名称?: string) => (供应商名称 ?? "").includes("喷油");
// 印喷类判定:加工内容含「喷」或「印」(喷油/移印/印喷,与后端 SecondProcessCategory 同口径)
export const is印喷 = (加工内容?: string) => /[喷印]/.test(加工内容 ?? "");

// 加工类型展示(存储口径不变,仅显示派生):未选加工内容的一次加工单=纯啤机单,显示「啤机」;
// 选了加工内容才算一次加工;二次加工同理须选加工内容才算成立
export const display加工类型 = (加工类型?: string | null, 加工内容?: string | null): string => {
  const t = (加工类型 ?? "").trim() || "一次加工";
  if (!(加工内容 ?? "").trim()) return t === "二次加工" ? "" : "啤机";
  return t;
};

// ---------- 明细编辑行 ----------

// 塑胶采购订单明细编辑行(数量/用量/套数 受控串,保存时 Number();对照老系统 PPOLine 编辑态)
export interface PpoEditLine {
  key: number;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  模具编号?: string;
  用量: string;
  套数: string;
  数量: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  加工内容?: string;
  备注?: string;
  // 打开已有单据时后端带出(收货进度显示用;新建录入行无)
  入仓数量?: number | null;
  欠数?: number | null;
  // 抽屉模式附加(不提交):已订数量(默认勾选规则)/可用库存;二次加工模式 已加工工序/来源采购单号;
  // 按库存一次加工 需求加工内容(塑胶物料资料/BOM,选印喷只显示需要印喷的件)
  需求加工内容?: string;
  已订数量?: number | null;
  // 阶段已订原始值(basis 带出,不提交):已订数量 按当前加工阶段改写前的备份——
  // 啤机(未选加工内容)=已订啤机;选了工序=已订同工序(下印喷单不被啤机已订误判重复)
  已订啤机数量?: number | null;
  已订同工序数量?: number | null;
  可用库存?: number | null;
  // 塑胶物料设置.损耗率(%):默认数量=计划数量×用量×(1+损耗率/100),可手改
  损耗率?: number | null;
  // 基准需求=计划数量×用量×(1+损耗率/100)(basis 行才有,不提交,手改数量不回流):
  // 抽屉「计算库存」勾选时 订购数量=max(需求−可用库存,0),取消勾选恢复需求
  需求数量?: number | null;
  // 原料关联(啤机下单自动扣原料):单件克重=原胶件单净重;原料库存=实时原料仓库存;
  // 原料用量KG=打开单据时的入库快照(编辑时按 数量×单件克重/1000 实时重算)
  原料编号?: string;
  原料名称?: string;
  单件克重?: number | null;
  原料库存?: number | null;
  原料用量KG?: number | null;
  // 塑胶物料资料.出模数(每啤几件):同模分组算啤数=ceil(数量/出模数)、堵模提示用
  出模数?: number | null;
  已加工工序?: string;
  来源采购单号?: string;
}

// 默认勾选规则:已下单(已订数量>0) 或 实时可用库存已够需求(可用库存>=需求) 的行默认不勾,
// 防重复/多余采购(照抄老系统 PlasticPurchaseOrderDrawer.plasticDefaultSelect;
// 移植老测试 web/src/__tests__/plasticPurchaseOrderDrawerStock.test.ts)。
// 需求口径:有 需求数量(basis 基准需求)按需求判定,否则按当前数量——「计算库存」扣减后 数量 变小不影响勾选判定
export const plasticDefaultSelect = (r: {
  已订数量?: number | null;
  数量?: number | string;
  需求数量?: number | null;
  可用库存?: number | null;
}): boolean => {
  const 需求 = Number(r.需求数量 ?? r.数量 ?? 0);
  return !(Number(r.已订数量) > 0) && !(需求 > 0 && r.可用库存 != null && Number(r.可用库存) >= 需求);
};

// 计算库存(basis 行即带 需求数量 的行):勾选时 订购数量=max(需求−可用库存,0),取消恢复需求;
// 手工/补料单行无 需求数量不受影响;可用库存空=不扣
export function applyStockDeduction(lines: PpoEditLine[], deduct: boolean): PpoEditLine[] {
  return lines.map((l) => {
    if (l.需求数量 == null) return l;
    const stock = deduct ? Number(l.可用库存 ?? 0) : 0;
    return { ...l, 数量: String(Math.max(Math.round(Number(l.需求数量) - stock), 0)) };
  });
}

// basis 行 -> 编辑行:数量默认=计划数量×用量×(1+损耗率/100),四舍五入取整(数量为整数,如 100000×1/3→33333;
// 啤数=⌈数量/出模数⌉ 不受影响:⌈33333/6⌉=⌈33333.33/6⌉=5556);损耗率空=0;
// 印喷类加工内容自动写进备注(供应商直接可见)
export function basisToLine(b: PlasticPurchaseOrderBasisRow, key: number): PpoEditLine {
  const 需求 =
    b.计划数量 != null && b.用量 != null
      ? Math.round(Number(b.计划数量) * Number(b.用量) * (1 + Number(b.损耗率 ?? 0) / 100))
      : null;
  return {
    key,
    生产单号: b.生产单号,
    款号: b.款号,
    物料编号: b.物料编号,
    物料名称: b.物料名称,
    模具编号: b.模具编号,
    用量: b.用量 != null ? String(b.用量) : "",
    套数: b.套数 != null ? String(b.套数) : "",
    数量: 需求 != null ? String(需求) : "0",
    需求数量: 需求,
    颜色: b.颜色,
    色粉号: b.色粉号,
    用料名称: b.用料名称,
    加工内容: b.加工内容,
    备注: is印喷(b.加工内容) ? b.加工内容 : undefined,
    已订数量: b.已订数量 != null ? Number(b.已订数量) : undefined,
    已订啤机数量: b.已订啤机数量 != null ? Number(b.已订啤机数量) : undefined,
    已订同工序数量: b.已订同工序数量 != null ? Number(b.已订同工序数量) : undefined,
    可用库存: b.可用库存,
    损耗率: b.损耗率 != null ? Number(b.损耗率) : undefined,
    原料编号: b.原料编号 ?? undefined,
    原料名称: b.原料名称 ?? undefined,
    单件克重: b.单件克重 != null ? Number(b.单件克重) : undefined,
    原料库存: b.原料库存 != null ? Number(b.原料库存) : undefined,
    出模数: b.出模数 != null ? Number(b.出模数) : undefined,
  };
}

// 详情明细行 -> 编辑行(打开已有单据;入仓数量/欠数原样带出)
export function detailToLine(l: PlasticPurchaseOrderLine, key: number): PpoEditLine {
  return {
    key,
    生产单号: l.生产单号,
    款号: l.款号,
    物料编号: l.物料编号,
    物料名称: l.物料名称,
    模具编号: l.模具编号,
    用量: l.用量 != null ? String(l.用量) : "",
    套数: l.套数 != null ? String(l.套数) : "",
    数量: String(Number(l.数量 ?? 0)),
    颜色: l.颜色,
    色粉号: l.色粉号,
    用料名称: l.用料名称,
    加工内容: l.加工内容,
    备注: l.备注,
    入仓数量: l.入仓数量,
    欠数: l.欠数,
    原料编号: l.原料编号 ?? undefined,
    原料名称: l.原料名称 ?? undefined,
    // 单件克重优先用快照口径的 单重(原胶件单净重);原料用量KG 用入库快照,缺时按 数量×单件克重/1000 重算
    单件克重: l.单重 != null ? Number(l.单重) : undefined,
    原料库存: l.原料库存 != null ? Number(l.原料库存) : undefined,
    原料用量KG: l.原料用量KG != null ? Number(l.原料用量KG) : undefined,
    出模数: l.出模数 != null ? Number(l.出模数) : undefined,
  };
}

// ---------- 同模分组(啤数/堵模;同一套模出多个配件,需求不齐时先啤够的腔要堵掉) ----------

// 啤数=ceil(数量/出模数);出模数空或 0 返回 null(无法算)
export const shotsOf = (数量: number | string, 出模数?: number | null): number | null =>
  出模数 == null || Number(出模数) <= 0 ? null : Math.ceil(Number(数量 || 0) / Number(出模数));

export interface MoldGroupLine {
  key: number;
  物料编号?: string;
  物料名称?: string;
  数量?: string;
  出模数?: number | null;
  啤数: number | null;
}

export interface MoldGroup {
  模具编号: string;
  配件数: number;
  // 共啤数=组内最大啤数(组内全部行出模数齐全才有,否则 null);不平衡=有行啤数<共啤数(先啤够→堵模)
  共啤数: number | null;
  不平衡: boolean;
  lines: MoldGroupLine[];
}

// 按 模具编号 分组;只保留 ≥2 个不同物料编号的组(同模多配件才算家族模;同物料多颜色不算)
export function moldGroups(lines: PpoEditLine[]): MoldGroup[] {
  const byMold = new Map<string, PpoEditLine[]>();
  for (const l of lines) {
    const m = (l.模具编号 ?? "").trim();
    if (!m) continue;
    const arr = byMold.get(m) ?? [];
    arr.push(l);
    byMold.set(m, arr);
  }
  const groups: MoldGroup[] = [];
  for (const [模具编号, ls] of byMold) {
    const 配件数 = new Set(ls.map((l) => l.物料编号).filter(Boolean)).size;
    if (配件数 < 2) continue;
    const gls: MoldGroupLine[] = ls.map((l) => ({
      key: l.key,
      物料编号: l.物料编号,
      物料名称: l.物料名称,
      数量: l.数量,
      出模数: l.出模数,
      啤数: shotsOf(l.数量, l.出模数),
    }));
    const known = gls.map((g) => g.啤数).filter((s): s is number => s != null);
    const 共啤数 = known.length === gls.length && known.length > 0 ? Math.max(...known) : null;
    const 不平衡 = 共啤数 != null && known.some((s) => s < 共啤数);
    groups.push({ 模具编号, 配件数, 共啤数, 不平衡, lines: gls });
  }
  return groups;
}

// 按同模最大啤数补齐:不平衡组内啤数偏小的行,数量补足到 共啤数×出模数(件数凑整啤,多出的件进库存)
export function applyMoldBalance(lines: PpoEditLine[]): { lines: PpoEditLine[]; 补齐行数: number } {
  const target = new Map<number, number>();
  for (const g of moldGroups(lines)) {
    if (!g.不平衡 || g.共啤数 == null) continue;
    for (const gl of g.lines)
      if (gl.啤数 != null && gl.啤数 < g.共啤数 && gl.出模数 != null)
        target.set(gl.key, g.共啤数 * Number(gl.出模数));
  }
  if (target.size === 0) return { lines, 补齐行数: 0 };
  return {
    补齐行数: target.size,
    lines: lines.map((l) => (target.has(l.key) ? { ...l, 数量: String(target.get(l.key)) } : l)),
  };
}

// 原料用量KG=数量(件)×单件克重/1000,2 位取舍(与啤货表总净重口径一致);无克重返回 null(不显示)
export const rawKgOf = (数量: number | string, 单件克重?: number | null): number | null =>
  单件克重 == null || Number(单件克重) <= 0
    ? null
    : Math.round((Number(数量 || 0) * Number(单件克重)) / 10) / 100;

// 明细行的原料用量KG:编辑态实时算,打开单据优先入库快照
export const lineRawKg = (l: PpoEditLine): number | null =>
  rawKgOf(l.数量, l.单件克重) ?? l.原料用量KG ?? null;

// 原料扣减汇总行(按原料编号合并):扣减KG=各行原料用量KG合计;剩余KG=原料库存−扣减(负=原料不够,红色)
export interface RawMaterialSumRow {
  原料编号: string;
  原料名称?: string;
  单件克重?: number | null;
  扣减KG: number;
  库存KG: number | null;
  剩余KG: number | null;
}

export function mergeRawMaterials(lines: PpoEditLine[]): RawMaterialSumRow[] {
  const map = new Map<string, RawMaterialSumRow>();
  for (const l of lines) {
    const k = l.原料编号 ?? "";
    if (!k) continue;
    const kg = lineRawKg(l) ?? 0;
    const cur = map.get(k);
    if (cur) {
      cur.扣减KG = Math.round((cur.扣减KG + kg) * 100) / 100;
      if (cur.库存KG == null && l.原料库存 != null) cur.库存KG = l.原料库存;
    } else {
      map.set(k, {
        原料编号: k,
        原料名称: l.原料名称,
        单件克重: l.单件克重,
        扣减KG: Math.round(kg * 100) / 100,
        库存KG: l.原料库存 ?? null,
        剩余KG: null,
      });
    }
  }
  return Array.from(map.values()).map((r) => ({
    ...r,
    剩余KG: r.库存KG != null ? Math.round((r.库存KG - r.扣减KG) * 100) / 100 : null,
  }));
}

// 保存前过滤+兜底裁剪(对照老系统 save):
// 1. 只保留 物料编号+数量>0 的行;2. 喷油单只收印喷类;3. 单头加工内容非空时只收相同加工内容的行。
// 返回裁剪后的行与剔除计数(页面据此弹警告)。
export function filterSubmitLines(
  lines: PpoEditLine[],
  opts: { 喷油单: boolean; 加工内容: string; 二次加工?: boolean },
): { kept: PpoEditLine[]; dropped喷油: number; dropped加工: number } {
  const ok = lines.filter((l) => l.物料编号 && Number(l.数量 || 0) > 0);
  // 二次加工:行来自「可二次加工库存」,行级没有 加工内容(带的是 已加工工序);
  // 单头选的加工内容就是本次要做的工序,适用于全部勾选行,不做行级裁剪
  if (opts.二次加工) return { kept: ok, dropped喷油: 0, dropped加工: 0 };
  let kept = ok;
  let dropped喷油 = 0;
  let dropped加工 = 0;
  if (opts.喷油单) {
    const before = kept.length;
    kept = kept.filter((l) => is印喷(l.加工内容));
    dropped喷油 = before - kept.length;
  }
  const 加工 = opts.加工内容.trim();
  if (加工) {
    const before = kept.length;
    kept = kept.filter((l) => (l.加工内容 ?? "").trim() === 加工);
    dropped加工 = before - kept.length;
  }
  return { kept, dropped喷油, dropped加工 };
}

// 编辑行 -> 提交明细(空串不带;数量/用量/套数转数值。对照后端 DTO 与老系统 doSave 的 lines map)
export const toSubmitLine = (l: PpoEditLine): PlasticPurchaseOrderLine => {
  const t = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    生产单号: t(l.生产单号),
    款号: t(l.款号),
    物料编号: t(l.物料编号),
    物料名称: t(l.物料名称),
    模具编号: t(l.模具编号),
    用量: l.用量.trim() !== "" ? Number(l.用量) : undefined,
    套数: l.套数.trim() !== "" ? Number(l.套数) : undefined,
    数量: Number(l.数量 || 0),
    颜色: t(l.颜色),
    色粉号: t(l.色粉号),
    用料名称: t(l.用料名称),
    加工内容: t(l.加工内容),
    备注: t(l.备注),
  };
};

// ---------- 物料清单(合并)(对照老系统 mergeRows:按物料编号合并 数量/入仓/欠数) ----------

export interface MergeRow {
  序号: number;
  物料编号: string;
  物料名称?: string;
  数量合计: number;
  入仓合计: number | null;
  欠数合计: number | null;
}

export function mergeLines(lines: PpoEditLine[]): MergeRow[] {
  const map = new Map<string, MergeRow>();
  for (const l of lines) {
    const k = l.物料编号 ?? "";
    if (!k) continue;
    const cur = map.get(k);
    if (cur) {
      cur.数量合计 += Number(l.数量 || 0);
      if (l.入仓数量 != null) cur.入仓合计 = Number(cur.入仓合计 ?? 0) + l.入仓数量;
      if (l.欠数 != null) cur.欠数合计 = Number(cur.欠数合计 ?? 0) + l.欠数;
    } else {
      map.set(k, {
        序号: 0,
        物料编号: k,
        物料名称: l.物料名称,
        数量合计: Number(l.数量 || 0),
        入仓合计: l.入仓数量 != null ? l.入仓数量 : null,
        欠数合计: l.欠数 != null ? l.欠数 : null,
      });
    }
  }
  return Array.from(map.values()).map((r, i) => ({ ...r, 序号: i + 1 }));
}

// 收货进度状态(对照老系统 owedStatus):欠 N / 超收 N / 已完成;无入仓数据(新建录入)返回 null
// 数量一律整数:先四舍五入再判定(0.4 这类小数欠数按 0 计=已完成)
export function owedStatus(
  欠: number | null | undefined,
): { kind: "欠" | "超收" | "完成"; value: number } | null {
  if (欠 == null) return null;
  const r = Math.round(Number(欠));
  if (r > 0) return { kind: "欠", value: r };
  if (r < 0) return { kind: "超收", value: Math.abs(r) };
  return { kind: "完成", value: 0 };
}

// ---------- 打印(对照老系统 printPlasticContract/printMoldingSheet) ----------

const pnum = (v?: number | null) => (v == null ? "" : String(v));
// 数量类(件数)打印一律整数(四舍五入);克重/金额等仍用 pnum 原值
const pnumInt = (v?: number | null) => (v == null ? "" : String(Math.round(Number(v))));

// 委托加工合同(喷油及其它工序)打印 HTML(原单 ActiveReports Document.pdf DJP2300028):
// 列=款号|物料名称|用料名称|颜色|单重G|总重KG|数量|单价|金额(HK$)|备注;
// 数量千分位整数;单价 HK$+至多3位小数;金额=数量×单价 HK$+千分位1位小数;TOTAL 行金额合计同口径;
// 日期中文;交货地点空时默认公司(原单:东莞市清溪镇上元管理区 东莞兴信塑胶制品有限公司);
// 单价源=详情行 加工单价(共用物料表.加工单价 回落 塑胶物料资料.加工总单价;无「单价」权限为 null→单价/金额/TOTAL 全留空)
const sep = (n: number) => n.toLocaleString("en-US");
const pnumSep = (v?: number | null) => (v == null ? "" : sep(Math.round(Number(v))));
const hkPrice = (v?: number | null) => (v == null ? "" : `HK$${Number(v)}`);
const money1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function buildPlasticContractPrintHtml(detail: PlasticPurchaseOrderDetail): string {
  const h = detail.单头 ?? ({} as PlasticPurchaseOrderHeader);
  const lines = detail.明细 ?? [];
  const 工序 = lines.find((l) => l.加工内容?.trim())?.加工内容?.trim() ?? "";
  const 订单编号 = h.编号?.trim() || h.单号 || "";
  const 交货地点 = h.交货地点?.trim() || "东莞市清溪镇上元管理区 东莞兴信塑胶制品有限公司";

  const amountOf = (l: (typeof lines)[number]) =>
    l.加工单价 != null && l.数量 != null ? Number(l.数量) * Number(l.加工单价) : null;
  const rows = lines
    .map((l) => {
      const 总重 =
        l.单重 != null && l.数量 != null
          ? ((Number(l.单重) * Number(l.数量)) / 1000).toFixed(2)
          : "";
      const 金额 = amountOf(l);
      return (
        `<tr><td>${esc(l.款号)}</td><td>${esc(l.物料名称)}</td><td>${esc(l.用料名称)}</td><td>${esc(l.颜色)}</td>` +
        `<td class="num">${pnum(l.单重)}</td><td class="num">${总重}</td><td class="num">${pnumSep(l.数量)}</td>` +
        `<td class="num">${hkPrice(l.加工单价)}</td><td class="num">${金额 == null ? "" : `HK$${money1(金额)}`}</td><td>${esc(l.备注)}</td></tr>`
      );
    })
    .join("");
  const amounts = lines.map(amountOf);
  const 金额合计 = amounts.every((a) => a != null) ? amounts.reduce((s, a) => s + (a ?? 0), 0) : null;

  const body = `
${companyHeaderHtml()}
<h2 class="doc-title">委托加工合同</h2>
<table class="head-box"><tbody><tr>
  <td style="width:55%">
    <div>加工厂：${esc(h.供应商名称)}</div>
    <div>联系人：${esc(h.供应商联系人)}</div>
    <div>TEL：${esc(h.供应商电话)}</div>
    <div>Fax:</div>
    <div>工序：${esc(工序)}</div>
  </td>
  <td>
    <div>订单编号：${esc(订单编号)}</div>
    <div>日期：${dCN(h.日期)}</div>
    <div>联络人：${esc(h.操作员)}</div>
    <div>TEL:${COMPANY_TEL}&nbsp;&nbsp;Fax:${COMPANY_FAX}</div>
  </td>
</tr></tbody></table>
<table><thead><tr>
  <th>款号</th><th>物料名称</th><th>用料名称</th><th>颜色</th><th>单重G</th><th>总重KG</th><th>数量</th><th>单价</th><th>金额(HK$)</th><th>备注</th>
</tr></thead><tbody>${rows}
<tr><td colspan="2">备 注：${esc(h.备注)}</td><td colspan="5">TOTAL:</td><td></td><td class="num">${金额合计 == null ? "" : `HK$${money1(金额合计)}`}</td><td></td></tr>
</tbody></table>
<div class="kv-line">交货日期：${dCN(h.交货日期)}&nbsp;&nbsp;&nbsp;&nbsp;付款期:___</div>
<div class="kv-line">交货地点：${esc(交货地点)}&nbsp;&nbsp;&nbsp;&nbsp;收货人：___</div>
${notesHtml()}
${footerHtml()}`;
  return wrapPrintHtml(`委托加工合同 ${订单编号}`, body);
}

// 新窗口打印委托加工合同(喷油)。
export function printPlasticContract(detail: PlasticPurchaseOrderDetail): void {
  openPrintWindow(buildPlasticContractPrintHtml(detail));
}

const MS_COLS = 14;
// 每页明细行数(对照原单:每页 10 行,页脚 第 N 页,共 M 页)
const MS_ROWS_PER_PAGE = 10;
// 特别注明(原样)
const SPECIAL_NOTE = "凡是移印、喷油、电镀、车衣部加工配件都需要先安排啤货，谢谢。";

// 中文日期 2026年09月17日(表头出单/交货日期、接单日期用)
const dCN = (v?: string | null) => {
  const d = d10(v);
  return d ? `${d.slice(0, 4)}年${d.slice(5, 7)}月${d.slice(8, 10)}日` : "";
};

// 用料名称配比拆分(原单汇总口径):"PP EP332K + PP 1120 (7:3)"→0.7/0.3,"PP 3015+POE(4:1)"→0.8/0.2;
// 无配比 → 单一用料比率 1
export function splitMaterialMix(用料名称?: string | null): { name: string; ratio: number }[] {
  const s = (用料名称 ?? "").trim();
  if (!s) return [];
  const m = /[（(]\s*(\d+(?:\.\d+)?(?:\s*[:：]\s*\d+(?:\.\d+)?)+)\s*[)）]\s*$/.exec(s);
  if (!m) return [{ name: s, ratio: 1 }];
  const parts = m[1].split(/[:：]/).map(Number);
  const sum = parts.reduce((a, b) => a + b, 0);
  const names = s
    .slice(0, m.index)
    .split("+")
    .map((x) => x.trim())
    .filter(Boolean);
  if (names.length !== parts.length || !(sum > 0)) return [{ name: s, ratio: 1 }];
  return names.map((name, i) => ({ name, ratio: parts[i] / sum }));
}

// 发料重量=总净重×1.005(原单统一 +0.5% 发料损耗);包数=发料重量÷25(25 KG/包)
const ISSUE_LOSS = 1.005;
const BAG_KG = 25;
// 1 位小数(十进制四舍五入;加 eps 消除 70.35 这类二进制浮点误差,与原单口径一致)
const f1 = (x: number) => (x + 1e-9).toFixed(1);

// 打印行合并(对照原单:同一套模同一色粉的一对合一行)——同一 模具编号+色粉号(空则颜色)+用料名称 下,
// 名称形如 左X/右X 的成对件合并为一行「X」:一套模一啤出一种颜色的一对;
// 数量=对数(取组内最大,正常左右相等);
// 整啤净重=一啤(整模)净重,对件同模共享同值(物料资料按模登记,如耳朵模 181.5G),取组内最大,不是合计;
// 啤数/总净重/用料汇总按合并后行算;
// 色粉号不同(换色再啤)不合行;非 左/右 命名的件不合行
export function mergeMoldPairLines(
  lines: PlasticPurchaseOrderLine[],
): PlasticPurchaseOrderLine[] {
  const LR = /^(左|右)(.+)$/;
  const keyOf = (l: PlasticPurchaseOrderLine): string | null => {
    const m = (l.物料名称 ?? "").trim().match(LR);
    const mold = (l.模具编号 ?? "").trim();
    if (!m || !mold) return null;
    const color = ((l.色粉号 ?? "") || (l.颜色 ?? "")).trim();
    return `${mold}|${color}|${(l.用料名称 ?? "").trim()}|${m[2].trim()}`;
  };
  const groups = new Map<string, PlasticPurchaseOrderLine[]>();
  for (const l of lines) {
    const k = keyOf(l);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  const done = new Set<string>();
  return lines.flatMap((l) => {
    const k = keyOf(l);
    if (!k) return [l];
    const g = groups.get(k)!;
    if (g.length === 1) return [l]; // 单件不成对,原样
    if (done.has(k)) return []; // 合并行已在首个成员处输出
    done.add(k);
    const 净重s = g.map((x) => (x.整啤净重 != null ? Number(x.整啤净重) : null));
    return [
      {
        ...g[0],
        物料名称: (g[0].物料名称 ?? "").trim().replace(LR, "$2").trim(),
        数量: Math.max(...g.map((x) => Number(x.数量 ?? 0))),
        // 整啤净重=一啤(整模)净重,对件共享同值,取组内最大兜底
        整啤净重: 净重s.some((v) => v != null)
          ? Math.max(...净重s.map((v) => v ?? 0))
          : null,
      },
    ];
  });
}

// 啤机部生产啤货表打印 HTML(原单照片:东莞兴信·啤机部生产啤货表,A4 横向,分页每页 10 行+页码)。
// 列口径:总套数=订购数量(件数),啤数=⌈数量/出模数⌉,总净重KG=整啤净重×啤数/1000 保留1位;
// 加工单价 0/加工金额 0.0(塑胶单无加工费,原样);末页表格末行=用料汇总(混料按比例拆分,
// 总净重 Σ整啤净重×啤数/1000,发料重量=总净重×1.005,包数=发料重量/25,两条并排)。
export function buildMoldingSheetHtml(detail: PlasticPurchaseOrderDetail): string {
  const h = detail.单头 ?? ({} as PlasticPurchaseOrderHeader);
  // 打印行:同模同色粉的 左/右 成对件合一行(对照原单:每色一行「耳朵」)
  const lines = mergeMoldPairLines(detail.明细 ?? []);

  // 地址两行:第一行=省+市(到第一个「市」为止),第二行=市级以下(镇/区/路等)
  const [addr1, addr2] = (() => {
    const s = (h.供应商联系地址 ?? "").trim();
    const i = s.indexOf("市");
    return i < 0 ? [s, ""] : [s.slice(0, i + 1), s.slice(i + 1)];
  })();

  // 抬头:左块(供应商/地址两行/電話傳真公司名称) + 正中(标题,整页居中) + 右块顶格最右(含交货地点)
  const head = `
<div class="co">东 莞 兴 信 塑 胶 制 品 有 限 公 司</div>
<div class="ms-hd">
  <div class="ms-hd-l">
    <div>供应商：${esc(h.供应商名称)}</div>
    <div>地址：${esc(addr1)}</div>
    ${addr2 ? `<div>${esc(addr2)}</div>` : ""}
    <div>電話：${esc(h.供应商电话)}&nbsp;&nbsp;傳真：${esc(h.供应商传真)}&nbsp;&nbsp;&nbsp;&nbsp;公司名称：${esc(h.客户名称)}</div>
  </div>
  <div class="ms-hd-c"><div class="doc">啤 机 部 生 产 啤 货 表</div></div>
  <div class="ms-hd-r">
    <div><b>生产单号：${esc(h.单号)}</b></div>
    <div>出单日期：${dCN(h.日期)}</div>
    <div>交货日期：${dCN(h.交货日期)}</div>
    <div>交货地点：${esc(h.交货地点)}</div>
  </div>
</div>`;

  const thead = `<thead><tr>
  <th>款号</th><th>模具编号</th><th>工模名称</th><th>总套数</th><th>啤数</th><th>颜色</th><th>色粉号</th><th>用料名称</th>
  <th>整啤净重G.</th><th>总净重KG.</th><th>加工单价(HK$)</th><th>加工金额(HK$)</th><th>交货日期</th><th>备注</th>
</tr></thead>`;
  const rowHtml = (l: (typeof lines)[number]) => {
    const shots = shotsOf(l.数量 ?? 0, l.出模数);
    const 总净重 =
      l.整啤净重 != null && shots != null ? f1((Number(l.整啤净重) * shots) / 1000) : "";
    return (
      `<tr class="ms-d"><td>${esc(l.款号)}</td><td>${esc(l.模具编号)}</td><td>${esc(l.物料名称)}</td>` +
      `<td class="num">${pnumInt(l.数量)}</td><td class="num">${shots ?? ""}</td>` +
      `<td>${esc(l.颜色)}</td><td>${esc(l.色粉号)}</td><td>${esc(l.用料名称)}</td>` +
      `<td class="num">${pnum(l.整啤净重)}</td><td class="num">${总净重}</td>` +
      `<td class="num">0</td><td class="num">0.0</td><td>${d10(h.交货日期)}</td><td>${esc(l.备注 || l.加工内容)}</td></tr>`
    );
  };

  // 每页收尾:特别注明 + 备注(表格末两行,原单每页都有)
  const closingRows = `
<tr><td class="ctr">特别注明</td><td colspan="${MS_COLS - 1}">${esc(SPECIAL_NOTE)}</td></tr>
<tr><td class="ctr">备&nbsp;&nbsp;注</td><td colspan="${MS_COLS - 1}">${esc(h.备注)}</td></tr>`;
  // 落款 + 页码(每页页尾,靠弹性占位钉在页底)
  const foot = (page: number, total: number) => `
<div class="ms-sign"><span>操作员：${esc(h.操作员)}</span><span>收货人：</span><span>下单人：</span><span>接单人：</span><span>接单日期：${dCN(h.日期)}</span></div>
<div class="ms-page">第 ${page} 页，共 ${total} 页</div>`;

  // 用料汇总(原单:末张明细页表格末行,跨全宽;混料按配比拆开;两条并排一行)
  const agg = new Map<string, number>();
  for (const l of lines) {
    const shots = shotsOf(l.数量 ?? 0, l.出模数);
    if (l.整啤净重 == null || shots == null) continue;
    const kg = (Number(l.整啤净重) * shots) / 1000;
    for (const part of splitMaterialMix(l.用料名称))
      agg.set(part.name, (agg.get(part.name) ?? 0) + kg * part.ratio);
  }
  // 无边框表格排版:标签列/数值列分开,数值右对齐 — 总净重/发料重量/包数 上下对齐
  const aggEntries = [...agg.entries()];
  const aggTrs: string[] = [];
  const aggCell = ([name, kg]: [string, number]) => {
    const issue = kg * ISSUE_LOSS;
    return (
      `<td class="a-name">〖${esc(name)}〗</td><td class="a-lab">总净重：</td><td class="a-num">${f1(kg)} KG</td>` +
      `<td class="a-lab">发料重量：</td><td class="a-num">${f1(issue)} KG</td><td class="a-tail">（包数：${f1(issue / BAG_KG)} 包）；</td>`
    );
  };
  for (let i = 0; i < aggEntries.length; i += 2) {
    aggTrs.push(
      `<tr>${aggCell(aggEntries[i])}${i + 1 < aggEntries.length ? aggCell(aggEntries[i + 1]) : '<td colspan="6"></td>'}</tr>`,
    );
  }
  const aggRow =
    aggTrs.length > 0
      ? `<tr><td colspan="${MS_COLS}"><table class="ms-agg-t"><tbody>${aggTrs.join("")}</tbody></table></td></tr>`
      : "";

  // 末页恰好满 10 行时,汇总另起一页(对照原单:汇总行跟在末页数据后,满页则新开)
  const detailPages = Math.max(1, Math.ceil(lines.length / MS_ROWS_PER_PAGE));
  const aggOwnPage = aggTrs.length > 0 && lines.length % MS_ROWS_PER_PAGE === 0;
  const totalPages = detailPages + (aggOwnPage ? 1 : 0);
  // 每页一个定高 .ms-sheet(A4 横向可打印区),flex 列 + 弹性占位把落款钉在页底 ——
  // 保证一逻辑页=一物理页,收尾块不会溢出成孤儿页。
  // 富余空白按 表上1:表下2 分配(.ms-gap/.ms-fill):表格整体下移一点,抬头位置不动。
  const sheet = (inner: string) => `<div class="ms-sheet">${inner}</div>`;
  const pages: string[] = [];
  for (let p = 0; p < detailPages; p++) {
    const rows = lines.slice(p * MS_ROWS_PER_PAGE, (p + 1) * MS_ROWS_PER_PAGE).map(rowHtml).join("");
    const isLast = p === detailPages - 1;
    pages.push(
      sheet(
        `${head}<div class="ms-gap"></div><table class="ms-grid">${thead}<tbody>${rows}${isLast && !aggOwnPage ? aggRow : ""}${closingRows}</tbody></table>` +
          `<div class="ms-fill"></div>${foot(p + 1, totalPages)}`,
      ),
    );
  }
  if (aggOwnPage) {
    pages.push(
      sheet(
        `${head}<div class="ms-gap"></div><table class="ms-grid">${thead}<tbody>${aggRow}${closingRows}</tbody></table>` +
          `<div class="ms-fill"></div>${foot(totalPages, totalPages)}`,
      ),
    );
  }

  const body = `
<style>
  @page{size:A4 landscape;margin:0}
  .co{text-align:center;font-size:22px;font-weight:700;letter-spacing:8px;line-height:1.4}
  .doc{font-size:17px;font-weight:700;letter-spacing:6px;white-space:nowrap}
  /* @page margin:0:去掉浏览器页眉页脚(日期/标题/URL/页码画在页边距里,0 边距即无处绘制);
     屏幕预览:固定 A4 比例页(281×193mm+内嵌安全边距);
     打印时(@media print):100vh/100%=整页,恰好撑满一页——多余空白收进页内弹性层,落款始终钉在页底,不再右下积白;
     安全边距内嵌 8mm,硬件不可打印区只吃留白;溢出裁切兜底,绝不裂页 */
  .ms-sheet{width:100%;max-width:281mm;height:193mm;padding:8mm;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;page-break-after:always}
  @media print{.ms-sheet{max-width:none;height:100vh}}
  .ms-sheet:last-child{page-break-after:auto}
  /* 富余空白分配:表上 1 份(.ms-gap),表下 2 份(.ms-fill) —— 表格下移,落款钉底 */
  .ms-gap{flex:1}
  .ms-fill{flex:2}
  /* 抬头三栏:左块靠左,右块顶格最右,标题整页绝对居中(一行带内,不另占行) */
  .ms-hd{position:relative;display:flex;justify-content:space-between;margin-top:2px;font-size:12px;line-height:1.5}
  .ms-hd-l{max-width:42%}
  .ms-hd-r{text-align:left;white-space:nowrap}
  .ms-hd-c{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
  .ctr{text-align:center}
  /* 占满页面:数据行定高 10.5mm(两行内容也放得下),10 行+抬头落款铺满 A4 横向 */
  .ms-grid{width:100%;border-collapse:collapse}
  .ms-grid th,.ms-grid td{padding:5px 6px;font-size:12px;line-height:1.35}
  .ms-grid tbody tr.ms-d{height:10.5mm}
  .ms-sign{display:flex;justify-content:space-between;margin-top:6px;font-size:13px}
  .ms-page{text-align:right;margin-top:4px;font-size:12px}
  /* 原料汇总:无边框表格,标签/数值分列,数值右对齐上下对齐;收窄字号间距,保证两条并排不溢出 */
  .ms-agg-t{width:100%;border-collapse:collapse}
  .ms-agg-t td{border:none;padding:2px 3px;font-size:10.5px;white-space:nowrap}
  .ms-agg-t .a-lab{text-align:right}
  .ms-agg-t .a-num{text-align:right;min-width:70px}
  .ms-agg-t .a-tail{text-align:right;min-width:90px}
</style>
${pages.join("")}`;
  return wrapPrintHtml(`啤机部生产啤货表 ${h.单号 ?? ""}`, body);
}

// 新窗口打印啤机部生产啤货表(A4 横向)。
export function printMoldingSheet(detail: PlasticPurchaseOrderDetail): void {
  openPrintWindow(buildMoldingSheetHtml(detail));
}
