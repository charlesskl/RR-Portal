// 补料单明细草稿行 + 保存前校验(纯函数,便于测试;照抄老系统 web/src/utils/replenishment.ts)
// 补料行 -> 采购订单带入行(replenishPurchaseLines)单源在 lib/purchaseOrder.ts,不重复。

export interface ReplenishDraftLine {
  key: number;
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  数量: number;
  备注?: string | null;
}

export function validateReplenishment(input: {
  仓库?: string;
  明细: ReplenishDraftLine[];
}): string | null {
  if (input.仓库 !== "来料仓" && input.仓库 !== "塑胶仓") return "请选择仓库（来料仓/塑胶仓）。";
  const valid = input.明细.filter((l) => l.物料编号.trim());
  if (valid.length === 0) return "请至少录入一行补料物料。";
  for (const l of valid)
    if (Number(l.数量) <= 0) return `物料 ${l.物料编号.trim()} 的补料数量必须大于 0。`;
  return null;
}
