// State management with localStorage persistence

import { SchedulePORow, MARecord, SavedInvoice } from "./data";
import { QuotationItem } from "./parseQuotation";

const SCHEDULE_KEY = "pkg_schedule_rows";
const QUOTATION_KEY = "pkg_quotation_items";
const MA_KEY = "pkg_ma_records";
const INVOICES_KEY = "pkg_invoices";

// --- Schedule ---
export function getScheduleRows(): SchedulePORow[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(SCHEDULE_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveScheduleRows(rows: SchedulePORow[]) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(rows));
}

// --- Quotation ---
export function getQuotationItems(): QuotationItem[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(QUOTATION_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveQuotationItems(items: QuotationItem[]) {
  localStorage.setItem(QUOTATION_KEY, JSON.stringify(items));
}

// --- MA Records (parsed from 包材MA sheet) ---
export function getMARecords(): MARecord[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(MA_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveMARecords(records: MARecord[]) {
  localStorage.setItem(MA_KEY, JSON.stringify(records));
}

// --- Invoices ---
export function getSavedInvoices(): SavedInvoice[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(INVOICES_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveInvoice(invoice: SavedInvoice) {
  const invoices = getSavedInvoices();
  invoices.push(invoice);
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
}

// --- Reset ---
export function resetData() {
  localStorage.removeItem(SCHEDULE_KEY);
  localStorage.removeItem(QUOTATION_KEY);
  localStorage.removeItem(MA_KEY);
  localStorage.removeItem(INVOICES_KEY);
}
