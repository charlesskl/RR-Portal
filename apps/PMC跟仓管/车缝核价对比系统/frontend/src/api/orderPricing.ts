import { http, unwrap } from './client';

export interface OrderPricingLine {
  lineId: number;
  productId: number;
  productLabel: string;
  qty?: number | null;
  unit?: string | null;
  internalPriceExcl: number;
  outsourcePriceExcl?: number | null;
  isOver: boolean;
  changeCount: number;
  lastChangeReason?: string | null;
  lastChangedAt?: string | null;
}

export interface OrderPricingRow {
  orderId: number;
  orderNo: string;
  supplierId: number;
  supplierName: string;
  orderDate: string;
  status: string;
  isPricingComplete: boolean;
  hasStockIn: boolean;
  lines: OrderPricingLine[];
}

export interface OrderPriceHistory {
  historyId: number;
  oldPriceExcl?: number | null;
  newPriceExcl: number;
  changeReason?: string | null;
  changedBy?: number | null;
  changedByName?: string | null;
  changedAt: string;
}

export const orderPricingApi = {
  list: (keyword?: string) => unwrap<OrderPricingRow[]>(http.get('/api/order-pricing', { params: { keyword } })),
  updateLine: (lineId: number, outsourcePriceExcl: number, changeReason?: string | null) =>
    unwrap<boolean>(http.put(`/api/order-pricing/lines/${lineId}`, { outsourcePriceExcl, changeReason })),
  history: (lineId: number) =>
    unwrap<OrderPriceHistory[]>(http.get(`/api/order-pricing/lines/${lineId}/history`)),
};
