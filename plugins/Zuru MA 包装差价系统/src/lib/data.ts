// ============================================================
// 9565 Packaging Cost System - Core Data Types
// ============================================================

import { QuotationItem } from "./parseQuotation";

// --- Schedule PO Row (parsed from 排期表 Excel) ---
export interface SchedulePORow {
  rowNum: number;
  orderDate: string;
  customer: string;
  country: string;
  poNumber: string;
  customerPO: string;
  itemNumber: string;
  productName: string;
  poQuantity: number;
  crd: string;
  // Packaging material quantities keyed by column letter (AH, AI, AJ, AK, AL, AM, AN, AO-AV)
  packagingQty: Record<string, number>;
}

// Column letter → display name mapping for packaging materials in the schedule
export const SCHEDULE_PACKAGING_COLUMNS: Record<string, string> = {
  AH: "1語收縮膜 (A版)",
  AI: "1語收縮膜 (B版)",
  AJ: "3語收縮膜 (A版)",
  AK: "3語收縮膜 (B版)",
  AL: "5語收藏指南 (A版)",
  AM: "5語收藏指南 (B版)",
  AN: "客版收藏指南",
  AO: "GQ1-MA 1L PDQ",
  AP: "GQ1-MA 1L PDQ (B版)",
  AQ: "GQ1-MA 3L PDQ",
  AR: "GQ1-MA 3L PDQ (B版)",
  AS: "GQ2客版 PDQ",
  AT: "GQ3 PDQ",
  AU: "GQ4 PDQ",
  AV: "SK 3L PDQ",
};

// --- MA Record ---
export interface MARecord {
  id: string;
  maNumber: string;
  date: string;
  materialColumn: string; // e.g. "AH", "AJ", "AL" - matches SCHEDULE_PACKAGING_COLUMNS
  materialName: string;
  quantity: number;        // MA order quantity
}

// Mapping: 包材MA sheet columns (I-V) → schedule columns (AH-AV)
export const MA_COL_TO_SCHEDULE_COL: Record<string, string> = {
  I: "AH",   // 1語收縮膜 (A版)
  J: "AI",   // 1語收縮膜 (B版)
  K: "AJ",   // 3語收縮膜 (A版)
  L: "AK",   // 3語收縮膜 (B版)
  M: "AL",   // 5L&6L说明书 (A版)
  N: "AM",   // 5L&6L说明书 (B版)
  O: "AO",   // 1L PDQ (A版)
  P: "AP",   // 1L PDQ (B版)
  Q: "AQ",   // 3L PDQ (A版)
  R: "AR",   // 3L PDQ (B版)
  S: "AS",   // 客版GQ2
  T: "AT",   // GQ3
  U: "AU",   // GQ4
  V: "AV",   // SK 3L
};

// --- Invoice ---
export interface InvoiceLineItem {
  poNumber: string;
  itemNumber: string;
  productName: string;
  poQuantity: number;
  materialColumn: string;
  materialName: string;
  materialQty: number;
  quotationSheet: string;
  quotationMaterial: string;
  maNumber: string;
  maQty: number;
  maTierLabel: string;
  maTierPrice: number;
  poTierLabel: string;
  poTierPrice: number;
  priceDiff: number;       // MA tier price - PO tier price (negative = MA cheaper)
  chargeAmount: number;    // priceDiff * materialQty
}

export interface SavedInvoice {
  id: string;
  date: string;
  poNumber: string;
  customerPO: string;
  customer: string;
  lineItems: InvoiceLineItem[];
  totalCharge: number;
}

// --- Mapping: schedule packaging column → quotation material matching ---
// This maps which quotation material names correspond to which schedule columns
// Multiple schedule columns may map to the same quotation material type
export const COLUMN_TO_QUOTATION_KEYWORDS: Record<string, string[]> = {
  AH: ["外收缩膜", "收缩膜9C", "收缩膜（6+"],   // 1L shrink wrap
  AI: ["外收缩膜", "收缩膜9C", "收缩膜（6+"],   // 1L shrink wrap B
  AJ: ["外收缩膜", "收缩膜9C", "收缩膜（6+"],   // 3L shrink wrap
  AK: ["外收缩膜", "收缩膜9C", "收缩膜（6+"],   // 3L shrink wrap B
  AL: ["收藏指南", "Collector guide", "收藏指南"],   // guide A
  AM: ["收藏指南", "Collector guide", "收藏指南"],   // guide B
  AO: ["PDQ盒", "PDQ"],   // GQ1 PDQ 1L
  AP: ["PDQ盒", "PDQ"],   // GQ1 PDQ 1L B
  AQ: ["PDQ盒", "PDQ"],   // GQ1 PDQ 3L
  AR: ["PDQ盒", "PDQ"],   // GQ1 PDQ 3L B
  AS: ["PDQ盒", "PDQ"],   // GQ2 PDQ
  AT: ["PDQ盒", "PDQ"],   // GQ3 PDQ
  AU: ["PDQ盒", "PDQ"],   // GQ4 PDQ
  AV: ["PDQ盒", "PDQ"],   // SK PDQ
};

// Find the matching tiered material from quotation for a given schedule column
export function findTieredMaterial(
  column: string,
  quotation: QuotationItem
): { material: QuotationItem["tieredMaterials"][0]; index: number } | null {
  const keywords = COLUMN_TO_QUOTATION_KEYWORDS[column];
  if (!keywords) return null;

  for (let i = 0; i < quotation.tieredMaterials.length; i++) {
    const mat = quotation.tieredMaterials[i];
    for (const kw of keywords) {
      if (mat.name.includes(kw) || mat.spec.includes(kw)) {
        return { material: mat, index: i };
      }
    }
  }

  return null;
}
