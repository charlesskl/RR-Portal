import type { Key } from "react";
import type { SemiSetupLine } from "@/api/types";

// 供 buildSemiSetupLines 使用的精简 BOM 行形状（与 BOM 页 MatRow 对齐，不反向依赖页面组件）
export interface SemiSetupSourceRow {
  key: Key;
  物料编号: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  用量?: number;
}

// 从 BOM 行里按勾选 key 映射出设置明细载荷；过滤空物料编号；保持勾选中传入的顺序
export function buildSemiSetupLines(
  rows: SemiSetupSourceRow[],
  selectedKeys: Key[],
): SemiSetupLine[] {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const out: SemiSetupLine[] = [];
  for (const k of selectedKeys) {
    const r = byKey.get(k);
    if (!r) continue;
    const 物料编号 = (r.物料编号 ?? "").trim();
    if (!物料编号) continue;
    out.push({
      物料编号,
      物料名称: r.物料名称 || null,
      规格: r.规格 || null,
      颜色: r.颜色 || null,
      单位: r.单位 || null,
      使用数量: r.用量 ?? null,
    });
  }
  return out;
}
