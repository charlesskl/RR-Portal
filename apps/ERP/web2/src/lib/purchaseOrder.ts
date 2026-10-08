// 采购订单页纯逻辑(独立模块,供页面与测试共用;避免组件文件导出非组件触发 fast-refresh 告警)
import type { ReplenishmentDetail } from "@/api/types";

// 默认勾选规则:已下单(已订数量>0)或 实时可用库存已够需求(可用库存>=需订数量) 的行默认不勾,
// 防重复/多余采购(照抄老系统 PurchaseOrderDrawer.shouldDefaultSelect)
export const shouldDefaultSelect = (r: {
  已订数量?: number;
  需订数量?: number;
  可用库存?: number;
}): boolean =>
  !(Number(r.已订数量) > 0) &&
  !(r.需订数量 != null && r.可用库存 != null && Number(r.可用库存) >= Number(r.需订数量));

// 默认下单数量:需订 × (1+采购损耗率/100),保留 4 位小数;损耗率空=0 不加成(口径同后端 PurchaseMaterialSettingsService.ApplyLossRate)
export const applyLossRate = (需订: number | null | undefined, ratePct?: number | null): number | undefined =>
  需订 == null ? undefined : Number((需订 * (1 + (ratePct ?? 0) / 100)).toFixed(4));

// 从物料资料.备注 里解析材料:格式 "材料:X" 或 "备注内容;材料:X"(X 取到空格或串尾)
export const parse材料 = (备注?: string): string => {
  if (!备注) return "";
  const m = /材料[:：]([^\s]*)/.exec(备注);
  return m?.[1] ?? "";
};

// 补料单 -> 采购订单带入行(照抄老系统 utils/replenishment.replenishPurchaseLines):
// 数量=补料数量,生产单号/款号取自补料单头;单头挂了生产单号则带入行 生产单号 锁死(贯穿到入库/统计)
export interface ReplenishPurchaseLine {
  生产单号?: string;
  款号?: string;
  物料编号: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量: number;
  锁定生产单号?: boolean;
}
export function replenishPurchaseLines(d: ReplenishmentDetail): ReplenishPurchaseLine[] {
  const 锁 = !!d.单头?.生产单号;
  return d.明细
    .filter((l) => l.物料编号?.trim())
    .map((l) => ({
      生产单号: d.单头?.生产单号 ?? undefined,
      款号: d.单头?.款号 ?? undefined,
      物料编号: l.物料编号!.trim(),
      物料名称: l.物料名称 ?? undefined,
      规格: l.规格 ?? undefined,
      颜色: l.颜色 ?? undefined,
      单位: l.单位 ?? undefined,
      数量: Number(l.数量 ?? 0),
      锁定生产单号: 锁,
    }));
}
