import * as XLSX from "xlsx";
import { SchedulePORow, MARecord, SCHEDULE_PACKAGING_COLUMNS, MA_COL_TO_SCHEDULE_COL } from "./data";

// Column indices (0-based)
const COL = {
  A: 0,  // 接单日期
  B: 1,  // 第三方客户名称
  C: 2,  // 国家
  D: 3,  // PO号
  E: 4,  // 客PO号
  H: 7,  // ITEM#
  I: 8,  // 中文名
  J: 9,  // PO数量(pcs)
  N: 13, // CRD
};

// Convert column letter to 0-based index
function colLetterToIndex(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1;
}

// All packaging columns to read
const PACKAGING_COL_INDICES: Record<string, number> = {};
for (const colLetter of Object.keys(SCHEDULE_PACKAGING_COLUMNS)) {
  PACKAGING_COL_INDICES[colLetter] = colLetterToIndex(colLetter);
}

function excelDateToString(serial: number): string {
  if (!serial || typeof serial !== "number") return "";
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400000);
  return date.toISOString().slice(0, 10);
}

function cellString(row: unknown[], colIdx: number): string {
  const val = row?.[colIdx];
  if (val == null) return "";
  if (typeof val === "number") return String(val);
  return String(val).trim();
}

function cellNumber(row: unknown[], colIdx: number): number {
  const val = row?.[colIdx];
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const parsed = parseFloat(String(val));
  return isNaN(parsed) ? 0 : parsed;
}

export function parseScheduleExcel(data: ArrayBuffer): SchedulePORow[] {
  const wb = XLSX.read(data, { type: "array" });

  let sheetName = wb.SheetNames.find((n) => n.includes("9565"));
  if (!sheetName) sheetName = wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  });

  const rows: SchedulePORow[] = [];

  for (let i = 3; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const poNumber = cellString(row, COL.D);
    const poQuantity = cellNumber(row, COL.J);

    if (!poNumber || poNumber === "`" || poQuantity <= 0) continue;

    // Parse packaging quantities
    const packagingQty: Record<string, number> = {};
    let hasPackaging = false;

    for (const [colLetter, colIdx] of Object.entries(PACKAGING_COL_INDICES)) {
      const qty = cellNumber(row, colIdx);
      if (qty > 0) {
        packagingQty[colLetter] = qty;
        hasPackaging = true;
      }
    }

    if (!hasPackaging) continue;

    const orderDateRaw = row[COL.A];
    let orderDate = "";
    if (typeof orderDateRaw === "number") {
      orderDate = excelDateToString(orderDateRaw);
    } else if (orderDateRaw) {
      orderDate = String(orderDateRaw);
    }

    const crdRaw = row[COL.N];
    let crd = "";
    if (typeof crdRaw === "number") {
      crd = excelDateToString(crdRaw);
    } else if (crdRaw) {
      crd = String(crdRaw);
    }

    rows.push({
      rowNum: i + 1,
      orderDate,
      customer: cellString(row, COL.B),
      country: cellString(row, COL.C),
      poNumber,
      customerPO: cellString(row, COL.E),
      itemNumber: cellString(row, COL.H),
      productName: cellString(row, COL.I),
      poQuantity,
      crd,
      packagingQty,
    });
  }

  return rows;
}

// Parse MA records from the 包材MA sheet in the schedule Excel
export function parseMAFromScheduleExcel(data: ArrayBuffer): MARecord[] {
  const wb = XLSX.read(data, { type: "array" });

  const sheetName = wb.SheetNames.find((n) => n.includes("包材MA"));
  if (!sheetName) return [];

  const ws = wb.Sheets[sheetName];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
  });

  const records: MARecord[] = [];
  // 包材MA columns: A=date, B=name, C=item, D=material, E=MA#, F=sku, G=qty, H=lang
  // I-V = material allocation columns mapping to schedule AH-AV
  const MA_DATA_COLS: { letter: string; colIdx: number }[] = Object.keys(MA_COL_TO_SCHEDULE_COL).map((letter) => ({
    letter,
    colIdx: letter.charCodeAt(0) - 65, // I=8, J=9, etc.
  }));

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const maNumber = cellString(row, 4); // col E
    if (!maNumber || !/^\d+$/.test(maNumber)) continue; // skip non-MA rows (summaries etc)

    const dateRaw = row[0]; // col A
    let date = "";
    if (typeof dateRaw === "number") {
      date = excelDateToString(dateRaw);
    } else if (dateRaw) {
      date = String(dateRaw);
    }

    const materialName = cellString(row, 3); // col D
    const totalQty = cellNumber(row, 6);     // col G

    // Check which material column has a value > 0
    for (const { letter, colIdx } of MA_DATA_COLS) {
      const qty = cellNumber(row, colIdx);
      if (qty > 0) {
        const scheduleCol = MA_COL_TO_SCHEDULE_COL[letter];
        const displayName = SCHEDULE_PACKAGING_COLUMNS[scheduleCol] || materialName;
        records.push({
          id: `ma-${maNumber}-${scheduleCol}`,
          maNumber,
          date,
          materialColumn: scheduleCol,
          materialName: displayName,
          quantity: qty,
        });
      }
    }
  }

  return records;
}
