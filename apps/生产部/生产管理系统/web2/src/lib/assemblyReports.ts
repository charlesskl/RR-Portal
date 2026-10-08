// 装配部报表群查询参数构建(纯函数,对照老系统 web/src/utils/assembly*.ts 四个文件):
// 全部/空值归一化为 undefined(不下发);双击行跳装配加工采购单(web2 路由 /assembly-purchases,
// 旧系统为 /assembly-purchase-orders,两版路径不同,其余语义一致)。

export const ASSEMBLY_ALL = "全部";

const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== ASSEMBLY_ALL ? trimmed : undefined;
};

// 双击行打开装配加工采购单整单(web2 单据页读 ?单号= 参数打开)
export const assemblyOrderPath = (单号?: string) =>
  单号 ? `/assembly-purchases?单号=${encodeURIComponent(单号)}` : undefined;

// ---------- 装配物料跟踪表(对照老系统 assemblyMaterialTracking.ts) ----------

export interface MaterialTrackingQueryInput {
  起: string;
  止: string;
  keyword?: string;
  收货仓库?: string;
  截止统计?: boolean;
}

export const buildMaterialTrackingQuery = (input: MaterialTrackingQueryInput) => ({
  起: input.起,
  止: input.止,
  keyword: clean(input.keyword),
  收货仓库: clean(input.收货仓库),
  截止统计: input.截止统计 === true,
});

// ---------- 加工厂库存汇总表(对照老系统 assemblyFactoryInventory.ts) ----------

export interface FactoryInventoryQueryInput {
  启用日期: boolean;
  起?: string;
  止?: string;
  截止日期: string;
  加工厂?: string;
  物料分类?: string;
  收货仓库?: string;
  keyword?: string;
}

export const buildFactoryInventoryQuery = (input: FactoryInventoryQueryInput) => ({
  启用日期: input.启用日期,
  起: input.启用日期 ? input.起 : undefined,
  止: input.启用日期 ? input.止 : undefined,
  截止日期: input.截止日期,
  加工厂: clean(input.加工厂),
  物料分类: clean(input.物料分类),
  收货仓库: clean(input.收货仓库),
  keyword: clean(input.keyword),
});

// ---------- 装配需领明细表(对照老系统 assemblyRequiredMaterials.ts) ----------

export interface RequiredMaterialQueryInput {
  起: string;
  止: string;
  keyword?: string;
  收货仓库?: string;
  类型?: string;
  审核情况?: string;
}

export const buildRequiredMaterialQuery = (input: RequiredMaterialQueryInput) => ({
  起: input.起,
  止: input.止,
  keyword: clean(input.keyword),
  收货仓库: clean(input.收货仓库),
  类型: clean(input.类型),
  审核情况: clean(input.审核情况),
});

// ---------- 加工厂分类月报表(对照老系统 assemblyFactoryCategoryMonthly.ts) ----------

export interface FactoryCategoryMonthlyQueryInput {
  起: string;
  止: string;
  加工厂?: string;
  keyword?: string;
}

export const buildFactoryCategoryMonthlyQuery = (input: FactoryCategoryMonthlyQueryInput) => ({
  起: input.起,
  止: input.止,
  加工厂: clean(input.加工厂),
  keyword: clean(input.keyword),
});

// ---------- 日期区间工具(装配报表群共用;无 dayjs,原生 Date) ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface DateRange {
  起: string;
  止: string;
}

// 默认区间=[今天-1月, 今天](对照老系统 defaultRange: subtract(1, "month") 到今天)
export function lastMonthToToday(): DateRange {
  const now = new Date();
  return { 起: fmtDay(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())), 止: fmtDay(now) };
}

// 区间整体平移 N 个月(对照老系统 上月/下月 按钮: range[0].subtract/add(1, "month"))
export function shiftRange(r: DateRange, months: number): DateRange {
  const shift = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return fmtDay(new Date(d.getFullYear(), d.getMonth() + months, d.getDate()));
  };
  return { 起: shift(r.起), 止: shift(r.止) };
}

// ---------- 装配采购进度表(对照老系统 AssemblyPurchaseProgressPage.tsx 内联映射/过滤) ----------

export interface AssemblyProgressSource {
  开单日期?: string;
  单号?: string;
  完成日期?: string;
  收货仓库?: string;
  供应商编号?: string;
  供应商名称?: string;
  产品货号?: string;
  配件编号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产单号?: string;
  货币?: string;
  数量?: number | null;
}

export interface AssemblyProgressRow {
  订购日期?: string;
  完成日期?: string;
  入库日期?: string;
  订单单号?: string;
  加工厂编号?: string;
  加工厂名称?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产接单日期?: string;
  生产单号?: string;
  货币?: string;
  订货数量?: number | null;
  入仓数量?: number | null;
  相差数量?: number | null;
  出货情况?: string;
}

// 明细行 -> 进度行(入仓数量恒 0:装配采购无入库回写,相差=订货,出货情况 未到/已到)
export const toAssemblyProgressRow = (row: AssemblyProgressSource): AssemblyProgressRow => {
  const qty = Number(row.数量 ?? 0);
  const inQty = 0;
  return {
    订购日期: row.开单日期,
    完成日期: row.完成日期,
    入库日期: undefined,
    订单单号: row.单号,
    加工厂编号: row.供应商编号,
    加工厂名称: row.供应商名称,
    产品货号: row.产品货号,
    产品名称: row.产品装配名称,
    配件编号: row.配件编号,
    产品装配名称: row.产品装配名称,
    装配方式: row.装配方式,
    生产接单日期: undefined,
    生产单号: row.生产单号,
    货币: row.货币,
    订货数量: qty,
    入仓数量: inQty,
    相差数量: qty - inQty,
    出货情况: qty - inQty > 0 ? "未到" : "已到",
  };
};

// 「只显示3天内交货的订单」:完成日期在 [今天, 今天+3天] 内(对照老系统 due.diff(now,"day") 0..3)
export function dueWithin3Days(完成日期: string | undefined, now = new Date()): boolean {
  if (!完成日期) return false;
  const due = new Date(`${String(完成日期).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  return days >= 0 && days <= 3;
}

// 客户端过滤:到货情况 + 只显示3天内交货(对照老系统 filteredRows)
export function filterAssemblyProgress(
  rows: AssemblyProgressRow[],
  arrival: string,
  onlyDueSoon: boolean,
  now = new Date(),
): AssemblyProgressRow[] {
  return rows.filter((r) => {
    if (arrival !== ASSEMBLY_ALL && r.出货情况 !== arrival) return false;
    if (onlyDueSoon && !dueWithin3Days(r.完成日期, now)) return false;
    return true;
  });
}

// 进度表「不选择日期」时的宽区间(对照老系统 wideRange: 2000-01-01 到今天+1年)
export function wideRange(): DateRange {
  const now = new Date();
  return { 起: "2000-01-01", 止: fmtDay(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())) };
}
