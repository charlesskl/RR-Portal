// 半成品标签单明细行纯函数(照抄老系统 web/src/utils/semiFinishedLabelOrders.ts):
// 预计标签数=ceil(数量/每箱数量);实需标签数手改后不再随数量重算;
// 选产品按配件编号(大小写不敏感)合并,数量累加并重算;保存/打印两级校验。
import type { SemiProductRow } from "@/api/types";

export interface SemiLabelLine {
  ID?: number | null;
  key: number;
  序号?: number;
  配件编号: string;
  客户?: string | null;
  产品货号: string;
  产品名称?: string | null;
  产品装配名称?: string | null;
  数量: number;
  每箱数量?: number | null;
  预计标签数: number;
  实需标签数: number;
  实需标签数已手改?: boolean;
  备注?: string | null;
}

export interface LabelValidationIssue {
  字段: string;
  消息: string;
}

export const makeBlankLabelLine = (key: number): SemiLabelLine => ({
  key,
  序号: key,
  配件编号: "",
  产品货号: "",
  数量: 0,
  每箱数量: undefined,
  预计标签数: 0,
  实需标签数: 0,
  实需标签数已手改: false,
  备注: "",
});

export function calculateExpectedLabels(quantity: number, perBox?: number | null): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(perBox) || (perBox as number) <= 0)
    return 0;
  return Math.ceil(quantity / (perBox as number));
}

export function recalculateLabelLine(
  line: SemiLabelLine,
  patch: { 数量?: number; 每箱数量?: number | null },
): SemiLabelLine {
  const next = { ...line, ...patch };
  const expected = calculateExpectedLabels(next.数量, next.每箱数量);
  return {
    ...next,
    预计标签数: expected,
    实需标签数: next.实需标签数已手改 ? next.实需标签数 : expected,
  };
}

export function markActualLabelsEdited(line: SemiLabelLine, actual: number): SemiLabelLine {
  return { ...line, 实需标签数: actual, 实需标签数已手改: true };
}

function productToLine(product: SemiProductRow): Omit<SemiLabelLine, "key"> {
  const quantity = product.数量 ?? 0;
  const expected = calculateExpectedLabels(quantity, product.每箱数量);
  return {
    配件编号: product.配件编号.trim(),
    客户: product.客户,
    产品货号: product.产品货号,
    产品名称: product.产品名称,
    产品装配名称: product.产品装配名称,
    数量: quantity,
    每箱数量: product.每箱数量,
    预计标签数: expected,
    实需标签数: expected,
    实需标签数已手改: false,
  };
}

export function mergeSelectedLabelProducts(
  lines: Omit<SemiLabelLine, "key">[],
  products: SemiProductRow[],
): Omit<SemiLabelLine, "key">[] {
  const merged = new Map<string, Omit<SemiLabelLine, "key">>();
  const add = (source: Omit<SemiLabelLine, "key">) => {
    const displayValue = source.配件编号.trim();
    const key = displayValue.toLocaleLowerCase();
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...source, 配件编号: displayValue });
      return;
    }
    const nextQuantity = (current.数量 ?? 0) + (source.数量 ?? 0);
    merged.set(key, recalculateLabelLine({ ...current, 数量: nextQuantity } as SemiLabelLine, { 数量: nextQuantity }));
  };
  lines.forEach(add);
  products.map(productToLine).forEach(add);
  return [...merged.values()];
}

function validateInternal(
  order: { 明细: Omit<SemiLabelLine, "key">[] },
  requirePerBox: boolean,
): LabelValidationIssue[] {
  const issues: LabelValidationIssue[] = [];
  if (!order.明细.length) issues.push({ 字段: "明细", 消息: "至少需要一条明细" });
  order.明细.forEach((line, index) => {
    const field = (name: string) => `明细[${index}].${name}`;
    if (!line.配件编号.trim()) issues.push({ 字段: field("配件编号"), 消息: "配件编号不能为空" });
    if (!line.产品货号.trim()) issues.push({ 字段: field("产品货号"), 消息: "产品货号不能为空" });
    const quantityValid = Number.isFinite(line.数量) && line.数量 >= 0;
    const perBoxEmpty = line.每箱数量 == null;
    const perBoxPositive = Number.isFinite(line.每箱数量) && (line.每箱数量 as number) > 0;
    const perBoxValid = perBoxPositive || (!requirePerBox && perBoxEmpty);
    const expectedValid = Number.isInteger(line.预计标签数) && line.预计标签数 >= 0;
    if (!quantityValid) issues.push({ 字段: field("数量"), 消息: "数量必须为有限的非负数" });
    if (!perBoxValid) {
      issues.push({
        字段: field("每箱数量"),
        消息: requirePerBox ? "打印前每箱数量必须大于 0" : "每箱数量必须为空或大于 0",
      });
    }
    const expected = perBoxPositive ? calculateExpectedLabels(line.数量, line.每箱数量) : 0;
    if (!expectedValid || (quantityValid && perBoxValid && line.预计标签数 !== expected)) {
      issues.push({ 字段: field("预计标签数"), 消息: "预计标签数必须为按数量计算的非负整数" });
    }
    if (!Number.isFinite(line.实需标签数) || !Number.isInteger(line.实需标签数) || line.实需标签数 < 0) {
      issues.push({ 字段: field("实需标签数"), 消息: "实际标签数必须为有限的非负整数" });
    }
  });
  return issues;
}

export const validateSemiLabelOrder = (order: { 明细: Omit<SemiLabelLine, "key">[] }) =>
  validateInternal(order, false);
export const validateSemiLabelOrderForPrint = (order: { 明细: Omit<SemiLabelLine, "key">[] }) =>
  validateInternal(order, true);

// 打印预览:每行按 实需标签数 展开成标签卡片(照抄老系统 buildPrintLabels)
export interface SemiPrintLabel extends Omit<SemiLabelLine, "key"> {
  标签序号: number;
  标签总数: number;
}

export function buildSemiPrintLabels(lines: Omit<SemiLabelLine, "key">[]): SemiPrintLabel[] {
  return lines.flatMap((line) => {
    if (!Number.isInteger(line.实需标签数) || line.实需标签数 <= 0) return [];
    return Array.from({ length: line.实需标签数 }, (_v, index) => ({
      ...line,
      标签序号: index + 1,
      标签总数: line.实需标签数,
    }));
  });
}
