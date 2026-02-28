import * as XLSX from "xlsx";

// Represents a single packaging material with tiered pricing for a specific item
export interface TieredMaterial {
  name: string;       // e.g. "外收缩膜9C+哑油"
  spec: string;       // full text from col A
  note: string;       // e.g. "有阶梯价\n要扣MA差价"
  tierPrices: number[]; // 12 values matching standard tier ranges
}

// Represents pricing data for one item (one sheet in the quotation file)
export interface QuotationItem {
  sheetName: string;         // original sheet name, e.g. "9565GQ1-S001,S002，S004"
  itemPatterns: string[];    // extracted item codes for matching, e.g. ["9565GQ1-S001", "9565GQ1-S002", "9565GQ1-S004"]
  exchangeRate: number;
  tieredMaterials: TieredMaterial[]; // only materials marked with tiered pricing
}

// Standard 12 tier ranges (same across all sheets)
export const TIER_LABELS = [
  "1-499",
  "500-999",
  "1,000-1,999",
  "2,000-2,999",
  "3,000-4,999",
  "5,000-9,999",
  "10,000-29,999",
  "30,000-49,999",
  "50,000-99,999",
  "100,000-299,999",
  "300,000-499,999",
  "500,000+",
];

export const TIER_RANGES: { min: number; max: number }[] = [
  { min: 1, max: 499 },
  { min: 500, max: 999 },
  { min: 1000, max: 1999 },
  { min: 2000, max: 2999 },
  { min: 3000, max: 4999 },
  { min: 5000, max: 9999 },
  { min: 10000, max: 29999 },
  { min: 30000, max: 49999 },
  { min: 50000, max: 99999 },
  { min: 100000, max: 299999 },
  { min: 300000, max: 499999 },
  { min: 500000, max: Infinity },
];

export function getTierIndex(quantity: number): number {
  for (let i = 0; i < TIER_RANGES.length; i++) {
    if (quantity >= TIER_RANGES[i].min && quantity <= TIER_RANGES[i].max) {
      return i;
    }
  }
  return TIER_RANGES.length - 1;
}

export function getTierLabel(quantity: number): string {
  return TIER_LABELS[getTierIndex(quantity)];
}

// Extract item codes from sheet name
// e.g. "9565GQ1-S001,S002，S004" → ["9565GQ1-S001", "9565GQ1-S002", "9565GQ1-S004"]
// e.g. "9565-S001" → ["9565-S001"]
function extractItemPatterns(sheetName: string): string[] {
  const cleaned = sheetName.replace(/\s+/g, "");
  // Try to find base item code + multiple suffixes
  const match = cleaned.match(/^(\d+\w*?)-?(S\d+)/);
  if (!match) return [cleaned];

  const base = match[1]; // e.g. "9565GQ1"
  // Find all S-codes
  const sCodes = cleaned.match(/S\d+/g) || [];
  return sCodes.map((s) => `${base}-${s}`);
}

export function parseQuotationExcel(data: ArrayBuffer): QuotationItem[] {
  const wb = XLSX.read(data, { type: "array" });
  const items: QuotationItem[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
    });

    if (rawData.length < 10) continue;

    // Check if this sheet has the standard tier structure
    // Look for "Quantities Break Down" or tier headers in rows 6-10
    let tierHeaderRow = -1;
    for (let r = 5; r < Math.min(12, rawData.length); r++) {
      const row = rawData[r];
      if (!row) continue;
      const text = row.slice(0, 3).filter(Boolean).join(" ");
      if (text.includes("Quantities") || text.includes("Break Down")) {
        tierHeaderRow = r;
        break;
      }
    }

    // Verify tier headers exist (columns 2-13 should have quantity labels)
    if (tierHeaderRow === -1) continue;
    const nextRow = rawData[tierHeaderRow + 1];
    if (!nextRow) continue;

    // Check if there are 12 tier columns with numeric headers or labels containing "pcs"
    let hasTierCols = false;
    for (let c = 2; c <= 13; c++) {
      const val = String(nextRow[c] || "");
      if (val.includes("pcs") || val.includes("PDQ")) {
        hasTierCols = true;
        break;
      }
    }
    // Also check the tierHeaderRow+1 for the actual header labels
    const headerCheckRow = rawData[tierHeaderRow + 1];
    if (!hasTierCols && headerCheckRow) {
      for (let c = 2; c <= 13; c++) {
        const val = String(headerCheckRow[c] || "");
        if (val.includes("pcs") || val.includes("PDQ")) {
          hasTierCols = true;
          break;
        }
      }
    }
    if (!hasTierCols) continue;

    // Find exchange rate (usually row 4-5, col 1)
    let exchangeRate = 7.25;
    for (let r = 3; r < 7; r++) {
      const row = rawData[r];
      if (!row) continue;
      const label = String(row[0] || "");
      if (label.includes("Exchange Rate") && typeof row[1] === "number") {
        exchangeRate = row[1];
        break;
      }
    }

    // Scan all rows for packaging materials with tiered pricing
    const tieredMaterials: TieredMaterial[] = [];
    const dataStartRow = tierHeaderRow + 2; // First data row after tier headers

    for (let r = dataStartRow; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row) continue;

      const col0 = String(row[0] || "");
      const col1 = String(row[1] || "");

      // Check if this row is marked as having tiered pricing
      const hasTieredPricing =
        col1.includes("阶梯") || col1.includes("MA差价") ||
        col0.includes("阶梯") || col0.includes("MA差价");

      if (!hasTieredPricing) continue;

      // Extract 12 tier prices
      const prices: number[] = [];
      let hasValidPrices = false;
      for (let c = 2; c <= 13; c++) {
        const val = row[c];
        if (typeof val === "number" && val > 0) {
          prices.push(val);
          hasValidPrices = true;
        } else {
          prices.push(0);
        }
      }

      if (!hasValidPrices || prices.length !== 12) continue;

      // Check if prices actually vary (some might be flat)
      const uniquePrices = new Set(prices.filter((p) => p > 0));
      if (uniquePrices.size < 2) continue; // Skip flat-priced items

      tieredMaterials.push({
        name: col0.split("，")[0].split(",")[0].split("\n")[0].trim().slice(0, 40),
        spec: col0.trim(),
        note: col1.trim(),
        tierPrices: prices,
      });
    }

    if (tieredMaterials.length === 0) continue;

    items.push({
      sheetName,
      itemPatterns: extractItemPatterns(sheetName),
      exchangeRate,
      tieredMaterials,
    });
  }

  return items;
}

// Find the best matching quotation item for a given item number from the schedule
export function findQuotationForItem(
  itemNumber: string,
  quotations: QuotationItem[]
): QuotationItem | null {
  // Normalize: remove spaces
  const normalized = itemNumber.replace(/\s+/g, "").toUpperCase();

  // 1. Exact match on item patterns
  for (const q of quotations) {
    for (const pattern of q.itemPatterns) {
      if (pattern.toUpperCase() === normalized) {
        return q;
      }
    }
  }

  // 2. Partial match: check if the item number starts with a known base
  for (const q of quotations) {
    for (const pattern of q.itemPatterns) {
      // e.g. schedule has "9565GQ1-S002" and quotation has "9565GQ1-S001"
      // Match on base code (before the -S part)
      const qBase = pattern.split("-")[0].toUpperCase();
      const iBase = normalized.split("-")[0].toUpperCase();
      if (qBase === iBase) {
        return q;
      }
    }
  }

  // 3. Check if sheet name contains the item code
  for (const q of quotations) {
    const sheetNorm = q.sheetName.replace(/\s+/g, "").toUpperCase();
    if (sheetNorm.includes(normalized) || normalized.includes(sheetNorm.split("-")[0])) {
      return q;
    }
  }

  return null;
}
