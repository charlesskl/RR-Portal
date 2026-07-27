import { http, unwrap } from './client';

export interface PriceBoardItem {
  orderId: number;
  orderNo: string;
  series: string;
  style: string;
  productId: number;
  supplier: string;
  customerQuote?: number | null;
  selfUnit: number;
  outUnit: number;
  outSelfRate?: number | null;
  qty: number;
  saveValue: number;
}
export interface PriceBoardByStyle {
  lineId: number;
  orderId: number;
  orderNo: string;
  productId: number;
  series: string;
  style: string;
  customerQuote?: number | null;
  selfUnitSum: number;
  outUnitSum: number;
  outSelfRate?: number | null;
  qty: number;
  saveValue: number;
  over: boolean;
}
export interface PriceBoardBySupplier {
  supplierId: number;
  supplier: string;
  orderCount: number;
  styleCount: number;
  qty: number;
  outValue: number;
  selfValue: number;
  saveValue: number;
  savingRate?: number | null;
  overPriceCount: number;
  items: PriceBoardItem[];
}
export interface PriceBoardDto {
  from: string;
  to: string;
  outStyleCount: number;
  outQty: number;
  selfValueTotal: number;
  outValueTotal: number;
  saveValueTotal: number;
  byStyle: PriceBoardByStyle[];
  bySupplier: PriceBoardBySupplier[];
}
export const priceBoardApi = {
  get: (from: string, to: string) => unwrap<PriceBoardDto>(http.get('/api/price-board', { params: { from, to } })),
};
