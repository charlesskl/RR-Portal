// 来料标签单纯逻辑(独立模块,供页面与测试共用;避免组件文件导出非组件触发 fast-refresh 告警)。
// 对照老系统 web/src/pages/materials/MaterialLabelOrderPage.tsx 的 buildPayload 校验与 print() 展开。

export const PRINT_ROW_LIMIT = 2000;

export interface LabelLine {
  ID?: number | null;
  key: number;
  序号?: number;
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  数量: number;
  标签数: number;
  备注?: string | null;
}

export const makeBlankLine = (key: number): LabelLine => ({
  key,
  物料编号: "",
  数量: 0,
  标签数: 1,
  备注: "",
});

// 保存前校验:至少一条明细;数量非负有限;标签数非负整数(文案照抄老系统)
export function validateLabelLines(lines: LabelLine[]): string | null {
  const printable = lines.filter((l) => l.物料编号.trim());
  if (!printable.length) return "至少需要一条明细";
  for (const [index, line] of printable.entries()) {
    if (!Number.isFinite(line.数量) || line.数量 < 0) return `第${index + 1}行：数量必须为有限的非负数`;
    if (!Number.isInteger(line.标签数) || line.标签数 < 0) return `第${index + 1}行：标签数必须为非负整数`;
  }
  return null;
}

// 打印展开:每行按「标签数」展开成多行标签,标签序号= i/N(对照老系统 print())
export function expandLabelRows(lines: LabelLine[]): Record<string, unknown>[] {
  const printable = lines.filter((l) => l.物料编号.trim());
  const rows: Record<string, unknown>[] = [];
  let sequence = 0;
  for (const line of printable) {
    for (let index = 1; index <= line.标签数; index++) {
      rows.push({
        序号: ++sequence,
        物料编号: line.物料编号,
        物料名称: line.物料名称 ?? "",
        规格: line.规格 ?? "",
        颜色: line.颜色 ?? "",
        单位: line.单位 ?? "",
        数量: line.数量,
        标签序号: `${index}/${line.标签数}`,
      });
    }
  }
  return rows;
}
