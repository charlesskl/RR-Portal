// 委托加工单(原装配加工采购单) 纯逻辑(页面与测试共用,避免组件文件导出非组件告警)。
// 新流程:无产品明细,生产明细行直接「选物料/半成品」或调入生产制单,外发加工厂;
// 辅料表纯手工维护(添加行/插入/删),保存为物料明细快照。
import type {
  AssemblyPurchaseAccessoryLine,
  AssemblyPurchaseOrderSaveMaterialLine,
  AssemblyPurchaseOrderSaveProductionLine,
  AssemblyPurchaseProductionLine,
} from "@/api/types";

// ---------- 编辑态行(页面 state 形状;key 为渲染键) ----------

// 单头表单状态(受控输入全字符串,保存时转换)
export interface HeaderFormState {
  供应商编号: string;
  供应商名称: string;
  客户编号: string;
  客户名称: string;
  出单日期: string;
  收货仓库: string;
  电脑单号: string;
  备注: string;
  开始交货日期: string;
  每天交货: string;
  完成日期: string;
  收货人: string;
}

export const emptyHeader = (today: string): HeaderFormState => ({
  供应商编号: "",
  供应商名称: "",
  客户编号: "",
  客户名称: "",
  出单日期: today,
  收货仓库: "半成品仓",
  电脑单号: "",
  备注: "",
  开始交货日期: today,
  每天交货: "",
  完成日期: today,
  收货人: "",
});

export interface ProductionEditLine {
  key: number;
  接单日期?: string;
  生产单号?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  加工数量?: number | null;
  单价?: number | null;
  金额?: number | null;
}

export interface AccessoryEditLine {
  key: number;
  序号: number;
  产品货号?: string;
  辅料编号?: string;
  辅料名称?: string;
  加工总数量?: number | null;
  单个产品需求量?: number | null;
  需求数克?: number | null;
  需求数个?: number | null;
}

// ---------- 数量合计:生产明细加工数量求和 ----------

export function totalQtyOf(productionLines: ProductionEditLine[]): number {
  return productionLines.reduce((s, r) => s + Number(r.加工数量 ?? 0), 0);
}

// ---------- 打开单据:后端详情 -> 编辑态行 ----------

export const productionLineToEdit = (
  r: AssemblyPurchaseProductionLine,
  key: number,
): ProductionEditLine => ({
  key,
  ...r,
  接单日期: r.接单日期 ? String(r.接单日期).slice(0, 10) : undefined,
});

export const accessoryLineToEdit = (
  r: AssemblyPurchaseAccessoryLine,
  key: number,
): AccessoryEditLine => ({ key, 序号: r.序号 ?? 0, ...r });

// ---------- 保存载荷收集 ----------
// 生产明细:行级 客户/装配方式/备注 不再逐行带(无产品明细),为空后端回落单头(db/105)
export function collectProductionLines(
  productionLines: ProductionEditLine[],
): AssemblyPurchaseOrderSaveProductionLine[] {
  return productionLines
    .filter((r) => r.生产单号 || r.产品货号)
    .map((r) => ({
      接单日期: r.接单日期 || undefined,
      生产单号: r.生产单号,
      款号: r.产品货号,
      产品名称: r.产品名称,
      配件编号: r.配件编号,
      产品装配名称: r.产品装配名称,
      加工数量: Number(r.加工数量 ?? 0),
      单价: r.单价 ?? undefined,
    }));
}

export function collectMaterialLines(
  accessoryLines: AccessoryEditLine[],
): AssemblyPurchaseOrderSaveMaterialLine[] {
  return accessoryLines
    .filter((r) => r.辅料编号)
    .map((r) => ({
      款号: r.产品货号,
      物料编号: r.辅料编号,
      物料名称: r.辅料名称,
      单位: r.需求数克 != null ? "克" : "个",
      用量: r.单个产品需求量 ?? undefined,
      需求数量: Number(r.需求数克 ?? r.需求数个 ?? 0),
    }));
}

// ---------- 前单/后单:在单号升序序列中取相邻单号(照抄 web/src/utils/docNav.ts) ----------
export function adjacentDocNo(
  nos: (string | null | undefined)[],
  current: string,
  next: boolean,
): string | undefined {
  const sorted = [...new Set(nos.filter((x): x is string => !!x))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN", { numeric: true }),
  );
  const index = sorted.indexOf(current);
  if (index < 0) return undefined;
  return sorted[index + (next ? 1 : -1)];
}
