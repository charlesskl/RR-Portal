import { isPlanDate, shiftPlanDate } from "./planDateAdjustment";

export const fields = ["planDate", "lineId", "machineNos", "plannedQty", "workerCount", "workHours", "remark"] as const;
export type Field = typeof fields[number];
export type PlanValues = { planDate: string; lineId: number; machineNos: string[]; plannedQty: number; workerCount: number; workHours: number; remark: string };
export type Draft = Record<Field, string>;
export type WorkbenchRow = { id: number; token: string; orderNo: string; productNo: string; partName: string; stepNo: number; craft: string; demand: number; goodQty: number | null; inboundQty: number | null; lockedReason: string | null; values: PlanValues };
export type WorkbenchLine = { id: number; name: string; craftType: string; isActive: boolean; dailyLimit: number; machineNos: string[] };
export const draftOf = (v: PlanValues): Draft => ({ ...v, lineId: String(v.lineId), machineNos: v.machineNos.join("、"), plannedQty: String(v.plannedQty), workerCount: String(v.workerCount), workHours: String(v.workHours) });
export const changed = (row: WorkbenchRow, draft?: Draft) => !!draft && fields.some(f => draft[f] !== draftOf(row.values)[f]);
export function normalizeDate(value: string) {
  const match = value.trim().match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?$/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : value.trim();
}
export function valuesOf(d: Draft): PlanValues {
  const integer = (text: string, label: string, max: number) => {
    if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text.trim())) throw new Error(`${label}必须为正整数`);
    const value = Number(text.replace(/,/g, ""));
    if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(`${label}超出有效范围`);
    return value;
  };
  const planDate = normalizeDate(d.planDate);
  if (!isPlanDate(planDate)) throw new Error("日期格式应为 YYYY-MM-DD");
  if (!d.workHours.trim() || !Number.isFinite(Number(d.workHours)) || Number(d.workHours) <= 0 || Number(d.workHours) > 24) throw new Error("工时必须大于 0 且不超过 24");
  if (d.remark.length > 2000 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(d.remark)) throw new Error("备注最多 2000 字，不能含控制字符");
  return { planDate, lineId: integer(d.lineId, "拉别", 2147483647), plannedQty: integer(d.plannedQty, "计划数", 2147483647),
    workerCount: integer(d.workerCount, "人数", 10000), workHours: Number(d.workHours),
    machineNos: Array.from(new Set(d.machineNos.split(/[,，、;；\n]+/).map(v => v.trim()).filter(Boolean))), remark: d.remark };
}

/** Excel 的制表符、引号换行和双引号转义；只处理值，不执行公式。 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || value === "")) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(value); value = "";
      if (c === "\n") { rows.push(row); row = []; }
    } else value += c;
  }
  if (quoted) throw new Error("粘贴内容的引号未闭合");
  if (value || row.length) { row.push(value); rows.push(row); }
  if (!rows.length || rows.length > 1000) throw new Error("每次可粘贴 1 至 1000 行");
  return rows;
}

export function pasteDrafts(rows: WorkbenchRow[], drafts: Record<number, Draft>, startRow: number, field: Field, text: string, lines: WorkbenchLine[]) {
  const cells = parseTsv(text); const startCol = fields.indexOf(field); const result = { ...drafts };
  if (startRow + cells.length > rows.length) throw new Error("粘贴超出已有计划行，请缩小粘贴范围");
  cells.forEach((values, offset) => {
    const row = rows[startRow + offset];
    if (row.lockedReason) throw new Error(`计划 #${row.id} 已锁定，整批粘贴未应用`);
    if (startCol + values.length > fields.length) throw new Error("粘贴超出可编辑列，列顺序为日期、拉别、机台、计划数、人数、工时、备注");
    const next = { ...(result[row.id] ?? draftOf(row.values)) };
    values.forEach((value, column) => {
      const key = fields[startCol + column];
      if (key === "lineId") {
        const matches = lines.filter(l => l.isActive && (l.name === value.trim() || String(l.id) === value.trim()));
        if (matches.length !== 1) throw new Error(`无法识别拉别：${value}`);
        if (next.lineId !== String(matches[0].id)) next.machineNos = "";
        next.lineId = String(matches[0].id);
      } else next[key] = key === "planDate" ? normalizeDate(value) : value;
    });
    valuesOf(next); // 粘贴整批校验成功后才更新页面草稿。
    result[row.id] = next;
  });
  return result;
}
export function shiftDraft(draft: Draft, days: number): Draft {
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 3650) throw new Error("顺延天数为非零整数，范围 -3650 至 3650");
  return { ...draft, planDate: shiftPlanDate(normalizeDate(draft.planDate), days) };
}
