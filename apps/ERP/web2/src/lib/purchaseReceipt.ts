import type {
  DocQueryParams,
  MaterialDocLine,
  PurchaseOrderProgressRow,
} from "@/api/types";

// 采购入仓/退仓 编辑行(对照老系统 web/src/utils/materialLines.ts 的 DocLine)
export interface EditLine {
  key: number;
  订单单号?: string;
  生产单号?: string;
  款号?: string;
  物料编号: string;
  物料名称: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换;计入订单欠数的部分
  单价: string;
  // 供应商多送的备品:勾选后出现「备品数量」输入;备品部分不占订单欠数,审核后计入可用库存(塑胶/来料入仓共用)
  备品?: boolean;
  备品数量?: string; // 备品部分数量(受控值);实物入仓=数量+备品数量
  // 显示用(不提交):选采购订单行带出的订单口径,供「收后欠数」列实时算状态
  订购数量?: number;
  订单欠数?: number;
}

// 采购订单欠数行 -> 入仓/退仓明细行(数量默认=欠数即全收;订单单号=采购单号)
export const orderRowToLine = (row: PurchaseOrderProgressRow, key: number): EditLine => ({
  key,
  订单单号: row.采购单号 ?? undefined,
  生产单号: row.生产单号 ?? undefined,
  款号: row.款号 ?? undefined,
  物料编号: row.物料编号 ?? "",
  物料名称: row.物料名称 ?? "",
  物料类别: row.物料类别 ?? undefined,
  规格: row.规格 ?? undefined,
  颜色: row.颜色 ?? undefined,
  单位: row.单位 ?? undefined,
  数量: String(Number(row.欠数 ?? 0)),
  单价: "",
  备品数量: "",
  订购数量: Number(row.订购数量 ?? 0),
  订单欠数: Number(row.欠数 ?? 0),
});

// 勾选/取消备品时的行补丁:超收行勾选→超收部分自动拆到备品数量;取消→备品数量并回数量
export function spareTogglePatch(
  l: Pick<EditLine, "订单欠数" | "数量" | "备品数量">,
  checked: boolean,
): Partial<Pick<EditLine, "备品" | "数量" | "备品数量">> {
  const qty = Number(l.数量 || 0);
  if (checked) {
    const over =
      l.订单欠数 != null ? Math.round((qty - l.订单欠数) * 100) / 100 : 0;
    if (over > 0)
      return { 备品: true, 数量: String(qty - over), 备品数量: String(over) };
    return { 备品: true, 备品数量: l.备品数量 ?? "" };
  }
  const spare = Number(l.备品数量 || 0);
  return {
    备品: false,
    数量: spare > 0 ? String(Math.round((qty + spare) * 100) / 100) : l.数量,
    备品数量: "",
  };
}

// 收后欠数状态:仅选了采购订单行的行显示;欠N(红)/超收N(橙)/已完成(绿)
export function owedAfter(
  l: Pick<EditLine, "订单单号" | "订单欠数" | "数量">,
): { kind: "欠" | "超收" | "完成"; value: number } | null {
  if (!l.订单单号 || l.订单欠数 == null) return null;
  const 剩余 = Math.round((l.订单欠数 - Number(l.数量 || 0)) * 100) / 100;
  if (剩余 > 0) return { kind: "欠", value: 剩余 };
  if (剩余 < 0) return { kind: "超收", value: Math.abs(剩余) };
  return { kind: "完成", value: 0 };
}

// 提交前过滤:必须有物料编号且 数量>0 或 备品数量>0(纯备品行数量可为 0)
export const validLines = (lines: EditLine[]) =>
  lines.filter(
    (l) => !!l.物料编号 && (Number(l.数量 || 0) > 0 || Number(l.备品数量 || 0) > 0),
  );

// 数量合计=实物入仓总数(订单部分+备品部分)
export const sumQty = (lines: EditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0) + (Number(l.备品数量) || 0), 0);

export const sumAmount = (lines: EditLine[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0) * (Number(l.单价) || 0), 0);

// 编辑行 -> 提交明细(单价空不带;数量转数值;备品勾选传 "1" 并带备品数量)
export const toSubmitLine = (l: EditLine): MaterialDocLine => ({
  订单单号: l.订单单号?.trim() || undefined,
  生产单号: l.生产单号?.trim() || undefined,
  款号: l.款号?.trim() || undefined,
  物料编号: l.物料编号,
  物料名称: l.物料名称 || undefined,
  物料类别: l.物料类别 || undefined,
  规格: l.规格 || undefined,
  颜色: l.颜色 || undefined,
  单位: l.单位 || undefined,
  数量: Number(l.数量 || 0),
  单价: l.单价.trim() !== "" ? Number(l.单价) : undefined,
  备品: l.备品 ? "1" : undefined,
  备品数量: l.备品 && Number(l.备品数量 || 0) > 0 ? Number(l.备品数量) : undefined,
});

// ---------- 入仓/退仓查询筛选(对照老系统 web/src/utils/materialLabelQuery.ts) ----------

export const ALL_CAT = "__ALL__"; // 类别「全部」key(不下发 物料类别 过滤)
export const ALL_APPROVAL = "全部"; // 审核情况「全部」(不下发该过滤)

const trim = (v?: string) => {
  const t = v?.trim();
  return t ? t : undefined;
};

// 把页面筛选状态归一化为后端查询参数:空串/ALL/全部 -> undefined(不下发)
export function buildDocQuery(args: {
  keyword?: string;
  类别?: string;
  审核情况?: string;
  起?: string;
  止?: string;
}): DocQueryParams {
  return {
    keyword: trim(args.keyword),
    物料类别: args.类别 && args.类别 !== ALL_CAT ? args.类别 : undefined,
    审核情况: args.审核情况 && args.审核情况 !== ALL_APPROVAL ? args.审核情况 : undefined,
    起: trim(args.起),
    止: trim(args.止),
  };
}

// 本月起止(查询默认口径=本月,对照老系统 thisMonth)
export function thisMonthRange(): { 起: string; 止: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return { 起: `${y}-${p(m + 1)}-01`, 止: `${y}-${p(m + 1)}-${p(last)}` };
}

// 上/本/下月跳转(对照老系统 jumpMonth)
export function monthRange(offset: number): { 起: string; 止: string } {
  const d = new Date();
  const base = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const y = base.getFullYear();
  const m = base.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return { 起: `${y}-${p(m + 1)}-01`, 止: `${y}-${p(m + 1)}-${p(last)}` };
}

// 日级跳转(对照老系统 FinishedReceiptQueryPage shiftDay/today:起止同设为同一天)
export function shiftDayRange(起: string, offset: number): { 起: string; 止: string } {
  const d = new Date(`${起}T00:00:00`);
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { 起: s, 止: s };
}

export function todayRange(): { 起: string; 止: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { 起: s, 止: s };
}
