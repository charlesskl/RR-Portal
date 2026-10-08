// 成品入仓单明细编辑行与纯函数(照抄老系统 web/src/utils/finishedReceiptOrder.ts + finishedLines.ts):
// merge 按 配件编号|产品货号 去重合并;summary 按 配件编号|产品装配名称 汇总入仓数量(右侧汇总侧表);
// validate 仓库必填+至少一行 数量>0;sumQty/validLines 为老 finished.test.ts 覆盖的合计/过滤口径。

export interface FinishedReceiptEditLine {
  key: number;
  订单单号?: string;
  配件编号: string;
  客户?: string | null;
  产品货号: string;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string;
  箱数?: number | null;
  数量: number;
  单价?: number | null;
  备注?: string;
}

type Product = Omit<FinishedReceiptEditLine, "key" | "数量"> & { 数量?: number | null };

export function mergeFinishedReceiptProducts(
  current: FinishedReceiptEditLine[],
  selected: Product[],
): FinishedReceiptEditLine[] {
  const result = [...current];
  const known = new Set(result.map((line) => `${line.配件编号}|${line.产品货号}`));
  for (const product of selected) {
    const identity = `${product.配件编号}|${product.产品货号}`;
    if (known.has(identity)) continue;
    known.add(identity);
    result.push({ ...product, key: result.length + 1, 数量: 0 });
  }
  return result.map((line, index) => ({ ...line, key: index + 1 }));
}

export function summarizeFinishedReceiptLines(lines: FinishedReceiptEditLine[]) {
  const groups = new Map<
    string,
    { key: string; 配件编号: string; 产品装配名称: string; 入仓数量: number }
  >();
  for (const line of lines) {
    if (!line.配件编号 || line.数量 <= 0) continue;
    const name = line.产品装配名称 ?? "";
    const key = `${line.配件编号}|${name}`;
    const current = groups.get(key);
    if (current) current.入仓数量 += line.数量;
    else groups.set(key, { key, 配件编号: line.配件编号, 产品装配名称: name, 入仓数量: line.数量 });
  }
  return [...groups.values()].map((row, index) => ({ ...row, 序号: index + 1 }));
}

export function validateFinishedReceipt(value: {
  仓库?: string;
  明细: FinishedReceiptEditLine[];
}): string | null {
  if (!value.仓库?.trim()) return "请选择收货仓库";
  if (!value.明细.some((line) => line.配件编号.trim() && line.数量 > 0)) {
    return "请至少录入一行数量大于 0 的明细";
  }
  return null;
}

// 提交前合计/过滤口径(老系统 web/src/utils/finishedLines.ts,finished.test.ts 覆盖)
export const sumQty = (lines: { 数量?: number }[]) =>
  lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

export const validLines = <T extends { 数量?: number }>(lines: T[]) =>
  lines.filter((l) => Number(l.数量 ?? 0) > 0);
