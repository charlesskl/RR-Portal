import type { DeliveryPricingMode } from './deliveryReportFormat'
export function delayedHeaders(mode: DeliveryPricingMode) {
  const currency = mode === 'hunan-rmb-tax' ? '人民币含税' : mode === 'rmb-tax' ? '不含税RMB' : '港币不含税$'
  return ['范围', '下单PMC', '加工厂', '货号', '订单号', '加工类别', '物料名称', '数量', '下单时间', '下单交货时间', '实际交货时间', '延迟时间', '订单总单数', '延期单数', '占比', '延期平均天数', `核价工价(${currency})`, `外发工价(${currency})`, '占比', '备注']
}
