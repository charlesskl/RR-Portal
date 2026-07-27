import { http, unwrap } from './client';

export interface DefectUpsert {
  defectType: string;
  qty?: number | null;
}
export interface QualityUpsert {
  orderId: number;
  lineId: number;
  receivedDate: string; // yyyy-MM-dd
  checkDate?: string | null;
  maNo?: string | null;
  deliveryNo?: string | null;
  receivedQty?: number | null;
  qcQty?: number | null;
  stockInQty?: number | null;
  abGroup?: string | null;
  inspector?: string | null;
  rectification?: string | null;
  remark?: string | null;
  defects: DefectUpsert[];
}

export interface DefectDto {
  defectId: number;
  defectType: string;
  qty?: number | null;
  rate?: number | null; // 占比=数量÷质检
}
export interface QualityRow {
  inspectionId: number;
  orderId: number;
  orderNo: string;
  supplierId: number;
  supplierName: string;
  lineId?: number | null;
  productId: number;
  seriesCode: string; // 货号
  productName: string; // 款式/品名
  receivedDate: string;
  checkDate?: string | null;
  maNo?: string | null;
  deliveryNo?: string | null;
  receivedQty?: number | null;
  qcQty?: number | null;
  stockInQty?: number | null;
  inspectMode: string; // 抽检/全检
  inspectRatio?: number | null; // 检验比例
  abGroup?: string | null;
  inspector?: string | null;
  avgDefectRate?: number | null; // 平均次品率
  mainDefect?: string | null; // 主要质量短板
  rectification?: string | null;
  remark?: string | null;
  defects: DefectDto[];
}
export interface OrderLineOptionDto {
  lineId: number;
  productId: number;
  seriesCode: string;
  styleNo?: string | null;
  productName: string;
  qty?: number | null;
}
export interface QualitySummaryRow {
  supplierId: number;
  supplierName: string;
  deptName: string;
  recordCount: number;
  totalQty: number;
  totalDefect: number;
  defectRatio?: number | null; // 不良占比=总不良÷总数量
  curRate?: number | null; // 本期次品率
  prevRate?: number | null; // 上期次品率
  trendPp?: number | null; // 趋势(百分点, 正=升=变差)
  grade: string; // QC评分: 优秀/良好/差/极差
}

export const qualityApi = {
  list: (params?: { supplierId?: number; keyword?: string }) =>
    unwrap<QualityRow[]>(http.get('/api/quality-inspections', { params })),
  get: (id: number) => unwrap<QualityRow>(http.get(`/api/quality-inspections/${id}`)),
  orderLines: (orderId: number) =>
    unwrap<OrderLineOptionDto[]>(http.get('/api/quality-inspections/order-lines', { params: { orderId } })),
  create: (body: QualityUpsert) => unwrap<number>(http.post('/api/quality-inspections', body)),
  update: (id: number, body: QualityUpsert) => unwrap<boolean>(http.put(`/api/quality-inspections/${id}`, body)),
  remove: (id: number) => unwrap<boolean>(http.delete(`/api/quality-inspections/${id}`)),
  summary: (params: { deptId?: number; from: string; to: string }) =>
    unwrap<QualitySummaryRow[]>(http.get('/api/quality-inspections/summary', { params })),
};
