// BOM物料设置 实单版「从关联 MA 勾选」的纯函数：行构造与去重（页面与测试共用，不依赖 React/antd）

// 实单追加行（与 BomSetupPage 的 MatRow 同形，但不含 key,key 由页面 uid() 补）
export interface MaBomRow {
  物料编号: string;
  物料名称: string;
  工模编号: string;
  规格: string;
  材料: string;
  颜色: string;
  单位: string;
  用量?: number;
  备注: string;
}

// MA 的 BOM 物料行（「选物料」弹窗数据源）
export interface MaMaterialLine {
  物料编号?: string | null;
  物料名称?: string | null;
  工模编号?: string | null;
  规格?: string | null;
  材料?: string | null;
  物料类别?: string | null;
  颜色?: string | null;
  单位?: string | null;
  使用数量?: number | null;
  用量?: number | null;
  备注?: string | null;
}

export type MaDefType = "半成品";

interface ExistingRow { 物料编号: string; 物料名称: string; 规格: string; 颜色: string }

const norm = (v?: string | null) => (v ?? "").trim();

// 物料行去重键：编号+规格+颜色（同一编号不同规格/颜色算不同行）
export const maMaterialKey = (编号?: string | null, 规格?: string | null, 颜色?: string | null) =>
  `${norm(编号)}|${norm(规格)}|${norm(颜色)}`;

// 勾选的 MA 物料 → 实单 BOM 行；跳过明细中已存在（编号+规格+颜色 相同）及勾选内重复的行
export function pickedMaMaterialRows(existing: ExistingRow[], picked: MaMaterialLine[]): MaBomRow[] {
  const seen = new Set(existing.map(r => maMaterialKey(r.物料编号, r.规格, r.颜色)));
  const added: MaBomRow[] = [];
  for (const m of picked) {
    const 编号 = norm(m.物料编号);
    if (!编号) continue;
    const key = maMaterialKey(编号, m.规格, m.颜色);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      物料编号: 编号,
      物料名称: norm(m.物料名称),
      工模编号: norm(m.工模编号),
      规格: norm(m.规格),
      材料: norm(m.材料 ?? m.物料类别),
      颜色: norm(m.颜色),
      单位: norm(m.单位),
      用量: m.使用数量 ?? m.用量 ?? undefined,
      备注: norm(m.备注),
    });
  }
  return added;
}

// 半成品定义 → 实单 BOM 行：编号=名称=定义名称，材料列标类型，默认单位 个;
// 用量取定义上的「半成品用量」(做 1 个成品要几个该半成品),未设置按 1
export function maDefRow(名称: string, 类型: MaDefType, 用量: number | null | undefined = 1): MaBomRow {
  const name = 名称.trim();
  return {
    物料编号: name, 物料名称: name, 工模编号: "", 规格: "",
    材料: 类型, 颜色: "", 单位: "个", 用量: 用量 ?? 1, 备注: "",
  };
}

// 勾选的半成品定义 → 实单 BOM 行；同名（编号或名称命中）跳过
export function pickedMaDefRows(existing: ExistingRow[], defs: { 名称: string; 类型: MaDefType; 用量?: number | null }[]): MaBomRow[] {
  const names = new Set(existing.flatMap(r => [norm(r.物料编号), norm(r.物料名称)]).filter(Boolean));
  const added: MaBomRow[] = [];
  for (const d of defs) {
    const name = norm(d.名称);
    if (!name || names.has(name)) continue;
    names.add(name);
    added.push(maDefRow(name, d.类型, d.用量));
  }
  return added;
}
