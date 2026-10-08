import type { IssueBasisRow, MaterialDocLine } from "@/api/types";

// 来料领料单纯逻辑(对照老系统 web/src/pages/materials/MaterialLineTable.tsx 的 usageCols 模式、
// web/src/utils/materialLines.ts 与 web/src/utils/issueBasisPick.ts)。
// 多单合并/货号挑选纯函数与塑胶领料单同口径,直接复用 lib/plasticIssue(两仓口径一致)。

export {
  parse生产单号s,
  issueBasisKey,
  mergeIssueBasisRows,
  distinct货号,
} from "./plasticIssue";

// ---------- 仓库 -> issue-basis 档(照抄 MaterialLineTable;先判半成品,因"半成品"包含"成品"子串) ----------

export type IssueBasis档 = "半成品" | "成品" | "塑胶" | "来料";

export const issueBasis档 = (仓库?: string): IssueBasis档 =>
  仓库?.includes("半成品")
    ? "半成品"
    : 仓库?.includes("成品")
      ? "成品"
      : 仓库?.includes("塑胶")
        ? "塑胶"
        : "来料";

export const issueBasis档说明 = (仓库?: string): string => {
  const 档 = issueBasis档(仓库);
  return 档 === "半成品"
    ? "该生产单半成品库存现存"
    : 档 === "成品"
      ? "该生产单成品库存现存"
      : 档 === "塑胶"
        ? "塑胶件(BOM 应领)"
        : "非塑胶件(BOM 应领)";
};

// 批量领料挑选(按货号分组弹窗)仅 来料/塑胶 档;半成品/成品档为单生产单直接带入现存
export const 可挑选档 = (仓库?: string): boolean => {
  const d = issueBasis档(仓库);
  return d === "来料" || d === "塑胶";
};

// ---------- 明细编辑行 ----------

// 来料领料明细编辑行(对照 MaterialLineTable usageCols 保真列序:
// 装配采购|生产单号|款号|物料编号|物料名称|规格|材料|颜色|库存|数量|备注)
export interface EditLine {
  key: number;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string; // 列名「材料」
  规格?: string;
  颜色?: string;
  单位?: string;
  数量: string; // 输入框受控值,保存时 Number() 转换
  备注?: string;
}

// 应领行 -> 明细行(数量=应领量/现存;照抄 bringIssueBasis/confirmIssueBasisPick 的来料映射;
// 现存档(半成品/成品)补材料列,便于台账区分)
export const basisRowToLine = (
  r: IssueBasisRow,
  fallback生产单号: string,
  key: number,
  物料类别?: string,
): EditLine => ({
  key,
  生产单号: r.生产单号 ?? fallback生产单号,
  款号: r.款号 ?? undefined,
  物料编号: r.物料编号 ?? undefined,
  物料名称: r.物料名称 ?? undefined,
  物料类别,
  规格: r.规格 ?? undefined,
  颜色: r.颜色 ?? undefined,
  单位: r.单位 ?? undefined,
  数量: String(Number(r.数量 ?? 0)),
});

// 提交前过滤:必须有物料编号且数量>0(对照老系统 save 的 ok 过滤)
export const validLines = (lines: EditLine[]) =>
  lines.filter((l) => !!l.物料编号 && Number(l.数量 || 0) > 0);

export const sumQty = (lines: { 数量?: string | number }[]) =>
  lines.reduce((a, l) => a + (Number(l.数量) || 0), 0);

// 编辑行 -> 提交明细(空串不带;数量转数值;对照后端 MaterialDocLineDto,领料不带订单单号/单价)
export const toSubmitLine = (l: EditLine): MaterialDocLine => {
  const t = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  return {
    生产单号: t(l.生产单号),
    款号: t(l.款号),
    物料编号: t(l.物料编号),
    物料名称: t(l.物料名称),
    物料类别: t(l.物料类别),
    规格: t(l.规格),
    颜色: t(l.颜色),
    单位: t(l.单位),
    数量: Number(l.数量),
    备注: t(l.备注),
  };
};
