import type { RawPurchaseAnalysisRow, RMPOLine } from "@/api/types";

export const rawPolicyKey = (code?: string | null) => (code ?? "").trim().toUpperCase();
const normalizeUnit = (unit?: string | null) => {
  const value = (unit ?? "").trim().toUpperCase();
  return value === "公斤" ? "KG" : value;
};

export function rawPurchaseLimitLabel(row: RawPurchaseAnalysisRow): string {
  if (row.采购限制原因) return row.采购限制原因;
  if (row.常用原料 === true && row.可购上限 == null) return "常用原料，可按需补库";
  if (row.可购上限KG == null) return "采购上限尚未核实";
  const weight = Number(row.每包重量);
  const bags = weight > 0 ? `；整包最多 ${Math.floor((row.可购上限KG + 1e-8) / weight)} 包` : "";
  return `最多 ${row.可购上限 ?? "—"} ${row.单位 ?? ""}（${row.可购上限KG} KG${bags}）`;
}

// 采购沿用后台库存单位，同原料多行合计，不能改单位或拆行绕过额度。
export function validateRawPurchase(lines: RMPOLine[], policies: RawPurchaseAnalysisRow[]): string | null {
  const byCode = new Map(policies.map(row => [rawPolicyKey(row.原料编号), row]));
  const totals = new Map<string, number>();
  for (const line of lines) {
    const code = rawPolicyKey(line.原料编号);
    const qty = Number(line.订货数量);
    if (!code || !Number.isFinite(qty) || qty <= 0) return "每行须填写真实原料编号及大于 0 的订货数量";
    const policy = byCode.get(code);
    if (!policy) return `原料 ${line.原料编号} 的采购额度未核实，请重新查询`;
    if (policy.采购限制原因) return `原料 ${line.原料编号}：${policy.采购限制原因}`;
    const unit = normalizeUnit(line.单位);
    if (!unit || unit !== normalizeUnit(policy.单位)) return `原料 ${line.原料编号} 的采购单位须与库存单位 ${policy.单位 ?? ""} 一致，请重新选择原料`;
    if (qty > 9999999999.9999 || Math.abs(qty - Math.round(qty * 10000) / 10000) > 1e-9) return `原料 ${line.原料编号} 的订货数量须在有效范围内且最多四位小数`;
    if (unit === "包" && !Number.isInteger(qty)) return `原料 ${line.原料编号} 按包采购须填写整包数量`;
    totals.set(code, (totals.get(code) ?? 0) + qty);
  }
  for (const [code, qty] of totals) {
    const policy = byCode.get(code)!;
    if (policy.常用原料 === true && policy.可购上限 == null) continue;
    if (policy.可购上限 == null) return `原料 ${policy.原料编号} 的采购上限未核实`;
    if (qty > policy.可购上限 + 1e-8) return `原料 ${policy.原料编号} 合计 ${Number(qty.toFixed(6))} ${policy.单位 ?? ""}，超过采购上限。${rawPurchaseLimitLabel(policy)}`;
  }
  return null;
}
