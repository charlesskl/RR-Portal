import type { ReportRow } from './deliveryStats'
import type { DeliveryPricingMode } from './deliveryReportFormat'

export interface DeliveryExcelRequest {
  rows: ReportRow[]
  title: string
  includeMoldNumber: boolean
  includeContractNumber: boolean
  pricingMode: DeliveryPricingMode
}

export type DeliveryExcelResponse =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; message: string }
