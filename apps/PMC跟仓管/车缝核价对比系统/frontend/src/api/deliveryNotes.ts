import { http, unwrap } from './client';

/** 抽检明细一行（对应订单的一条款×工艺 line） */
export interface InspectionUpsert {
  lineId: number;
  sendQty?: number | null; // 送货数量
  inspectQty?: number | null; // 抽检数
  defectQty?: number | null; // 不良数
  returnQty?: number | null; // 退货数量
  remark?: string | null;
}
export interface DeliveryNoteUpsert {
  orderId: number;
  noteNo: string; // 送货单号(手填)
  receivedDate: string; // yyyy-MM-dd 实际回货日
  remark?: string | null;
  items: InspectionUpsert[];
}

export interface InspectionDto {
  inspectionId: number;
  lineId: number;
  productLabel: string;
  sendQty?: number | null;
  inspectQty?: number | null;
  defectQty?: number | null;
  returnQty?: number | null;
  defectRate?: number | null; // 不良率(0~1)
  actualReceived: number; // 实际交货=送货−退货
  remark?: string | null;
}
export interface DeliveryNoteDto {
  deliveryNoteId: number;
  orderId: number;
  noteNo: string;
  receivedDate: string;
  delayDays?: number | null; // 批次交期=回货日−交付日(正延期/负提前)
  defectRate?: number | null; // 本批不良率(0~1)
  remark?: string | null;
  items: InspectionDto[];
}

export const deliveryNoteApi = {
  listByOrder: (orderId: number) => unwrap<DeliveryNoteDto[]>(http.get('/api/delivery-notes', { params: { orderId } })),
  create: (body: DeliveryNoteUpsert) => unwrap<number>(http.post('/api/delivery-notes', body)),
  remove: (id: number) => unwrap<boolean>(http.delete(`/api/delivery-notes/${id}`)),
};
