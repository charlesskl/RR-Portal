import { http, unwrap } from './client';

export interface OrderLineUpsert {
  productId: number;
  qty?: number | null;
  unit?: string | null;
  contractNo?: string | null;
}
export interface OrderUpsert {
  orderNo: string; // 手填
  supplierId: number;
  orderDate: string; // yyyy-MM-dd
  deliveryDate?: string | null;
  remark?: string | null;
  lines: OrderLineUpsert[];
}

export interface OrderListRow {
  orderId: number;
  orderNo: string;
  supplierId: number;
  supplierName: string;
  contractNos: string;
  seriesCodes: string; // 货号(合并)
  styleNames: string; // 款式(合并)
  totalQty: number;
  orderDate: string;
  deliveryDate?: string | null;
  productionProgress: number;
  delayDays: number;
  delayReason?: string | null;
  status: string;
  remark?: string | null;
  lineCount: number;
}
export interface OrderEditLine {
  lineId?: number | null;
  productId: number;
  qty?: number | null;
  unit?: string | null;
  contractNo?: string | null;
}
export interface OrderEditDto {
  orderId: number;
  orderNo: string;
  supplierId: number;
  orderDate: string;
  deliveryDate?: string | null;
  status: string;
  productionProgress: number;
  delayReason?: string | null;
  remark?: string | null;
  hasLinkedRecords: boolean;
  lines: OrderEditLine[];
}
export interface OrderEditReq {
  supplierId: number;
  orderDate: string;
  deliveryDate?: string | null;
  delayReason?: string | null;
  remark?: string | null;
  lines: OrderEditLine[];
}
export interface OrderLineDto {
  lineId: number;
  productId: number;
  productLabel: string;
  contractNo?: string | null;
  qty?: number | null;
  unit?: string | null;
  outsourcePriceExcl?: number | null;
  customerQuoteExcl?: number | null;
  internalPriceExcl?: number | null;
  dongguanPriceExcl?: number | null;
  hunanPriceExcl?: number | null;
  saving?: number | null;
  outsourceInternalRate?: number | null;
  compliance?: string | null;
}
export interface OrderDetailDto {
  orderId: number;
  orderNo: string;
  supplierId: number;
  supplierName: string;
  orderDate: string;
  deliveryDate?: string | null;
  status: string;
  remark?: string | null;
  outsourceTotal?: number | null;
  saving?: number | null;
  hasOver: boolean;
  isPricingComplete: boolean;
  productionProgress: number;
  delayDays: number;
  delayReason?: string | null;
  lines: OrderLineDto[];
}

export interface OrderImportLineInput {
  rowNo: number;
  contractNo?: string | null;
  productCode: string;
  productName: string;
  qty?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  priceIncludesTax: boolean;
  selectedProductId?: number | null;
}
export interface OrderImportProductCandidate {
  productId: number;
  productCode: string;
  productName: string;
  similarity: number;
  isActive: boolean;
  hasQuote: boolean;
}
export interface OrderImportInput {
  sourceFile: string;
  orderNo: string;
  supplierName: string;
  orderDate?: string | null;
  deliveryDate?: string | null;
  remark?: string | null;
  lines: OrderImportLineInput[];
}
export interface OrderImportPreviewLine extends OrderImportLineInput {
  sourceUnitPrice?: number | null;
  outsourcePriceExcl?: number | null;
  productId?: number | null;
  status: 'ok' | 'error';
  reason?: string | null;
  matchType?: 'exact' | 'alias' | 'normalized' | 'suggested' | 'manual' | 'merged' | null;
  candidates: OrderImportProductCandidate[];
}
export interface OrderImportPreviewOrder {
  sourceFile: string;
  orderNo: string;
  supplierName: string;
  orderDate?: string | null;
  deliveryDate?: string | null;
  remark?: string | null;
  supplierId?: number | null;
  existingOrderId?: number | null;
  status: 'ok' | 'conflict' | 'error';
  reason?: string | null;
  lines: OrderImportPreviewLine[];
}
export interface OrderImportPreviewResult {
  orders: OrderImportPreviewOrder[];
  readyCount: number;
  conflictCount: number;
  errorCount: number;
}
export interface OrderImportCommitResult {
  created: number;
  overwritten: number;
  skipped: number;
  failed: number;
}

export const orderApi = {
  list: (keyword?: string) => unwrap<OrderListRow[]>(http.get('/api/purchase-orders', { params: { keyword } })),
  get: (id: number) => unwrap<OrderDetailDto>(http.get(`/api/purchase-orders/${id}`)),
  getEdit: (id: number) => unwrap<OrderEditDto>(http.get(`/api/purchase-orders/${id}/edit`)),
  create: (body: OrderUpsert) => unwrap<number>(http.post('/api/purchase-orders', body)),
  update: (id: number, body: OrderEditReq) => unwrap<boolean>(http.put(`/api/purchase-orders/${id}`, body)),
  remove: (id: number) => unwrap<boolean>(http.delete(`/api/purchase-orders/${id}`)),
  importPreview: (orders: OrderImportInput[]) =>
    unwrap<OrderImportPreviewResult>(http.post('/api/purchase-orders/import/preview', { orders })),
  importCommit: (orders: Array<{ order: OrderImportInput; overwrite: boolean }>) =>
    unwrap<OrderImportCommitResult>(http.post('/api/purchase-orders/import/commit', { orders })),
};
