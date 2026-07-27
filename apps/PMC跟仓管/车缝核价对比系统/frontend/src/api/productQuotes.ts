import { http, unwrap } from './client';

export interface ProductPrice {
  productId: number;
  styleNo?: string | null;
  productName: string;
  customerName?: string | null;
  customerQuoteExcl?: number | null;
  internalPriceExcl: number;
  dongguanPriceExcl?: number | null;
  hunanPriceExcl?: number | null;
  remark?: string | null;
}
export interface ProductPriceSave {
  customerName?: string | null;
  customerQuoteExcl?: number | null;
  internalPriceExcl: number;
  dongguanPriceExcl?: number | null;
  hunanPriceExcl?: number | null;
  remark?: string | null;
}

/* 产品核价导入（前端智能识别 Excel 表头 → 后端校验/落库） */
export interface ImportRowInput {
  rowNo: number;
  customerName?: string | null;
  code: string;
  productName: string;
  customerQuoteExcl?: number | null;
  internalPriceExcl: number | null;
  dongguanPriceExcl?: number | null;
  hunanPriceExcl?: number | null;
  remark?: string | null;
}
export interface ImportPreviewRow {
  rowNo: number;
  customerName: string;
  code: string;
  productName: string;
  customerQuoteExcl?: number | null;
  internalPriceExcl?: number | null;
  dongguanPriceExcl?: number | null;
  hunanPriceExcl?: number | null;
  remark?: string | null;
  status: 'ok' | 'conflict' | 'duplicate' | 'warning' | 'skip';
  reason?: string | null;
  willCreateProduct: boolean;
  hasExistingQuote: boolean;
  productId?: number | null;
}
export interface ImportPreviewResult {
  rows: ImportPreviewRow[];
  willCreateProductCount: number;
  willWriteCount: number;
  conflictCount: number;
  duplicateCount: number;
  warningCount: number;
  skipCount: number;
}
export interface ImportCommitRow extends ImportRowInput {
  overwrite: boolean;
  clearEmpty?: boolean;
}
export interface ImportCommitResult {
  createdProducts: number;
  writtenQuotes: number;
  overwritten: number;
  keptOld: number;
  skipped: number;
}

export const productQuoteApi = {
  getBySeries: (code: string) =>
    unwrap<ProductPrice[]>(http.get('/api/product-quotes/by-series', { params: { code } })),
  getByProduct: (productId: number) =>
    unwrap<ProductPrice | null>(http.get('/api/product-quotes/by-product', { params: { productId } })),
  save: (productId: number, deptId: number, price: ProductPriceSave) =>
    unwrap<boolean>(http.put(`/api/product-quotes/${productId}`, { deptId, ...price })),
  importPreview: (deptId: number, rows: ImportRowInput[]) =>
    unwrap<ImportPreviewResult>(http.post('/api/product-quotes/import/preview', { deptId, rows })),
  importCommit: (deptId: number, rows: ImportCommitRow[]) =>
    unwrap<ImportCommitResult>(http.post('/api/product-quotes/import/commit', { deptId, rows })),
};
