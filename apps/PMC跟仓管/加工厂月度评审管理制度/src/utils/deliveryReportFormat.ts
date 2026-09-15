// 报表表头（单行）
export const DELIVERY_HEADERS = [
  '范围', '下单PMC', '加工厂', '货号', '模具编号', '订单号', '加工类别', '物料名称', '数量', '下单时间', '下单交货时间', '实际交货时间', '延迟时间',
  '订单总单数', '延期单数', '占比', '延期平均天数',
  '核价工价(港币不含税$)', '外发工价(港币不含税$)', '外发工价(人民币含税)', '换算汇率', '占比', '备注',
]

/** Price columns differ by region: Hunan uses tax-inclusive RMB, while sewing/electronics retain untaxed RMB. */
export type DeliveryPricingMode = 'hkd' | 'rmb-tax' | 'hunan-rmb-tax' | 'hkd-tax'

export function isRmbTaxPricingMode(mode: DeliveryPricingMode): boolean {
  return mode === 'rmb-tax' || mode === 'hunan-rmb-tax'
}

export function deliveryHeaders(
  includeMoldNumber = true,
  includeContractNumber = false,
  pricingMode: DeliveryPricingMode = includeContractNumber ? 'rmb-tax' : 'hkd',
) {
  let headers = DELIVERY_HEADERS.filter((header) => includeMoldNumber || header !== '模具编号')
  if (includeContractNumber) headers.splice(headers.indexOf('货号'), 0, '合同号')
  if (isRmbTaxPricingMode(pricingMode)) {
    headers = headers.map((header) => {
      if (header === '核价工价(港币不含税$)') {
        return pricingMode === 'hunan-rmb-tax' ? '核价工价(人民币含税)' : '核价工价(不含税RMB)'
      }
      if (header === '外发工价(港币不含税$)') return '外发工价(不含税RMB)'
      if (header === '换算汇率') return '税点'
      return header
    })
    if (pricingMode === 'hunan-rmb-tax') {
      headers = headers.filter((header) => header !== '外发工价(不含税RMB)')
    }
  } else if (pricingMode === 'hkd-tax') {
    headers.splice(headers.indexOf('换算汇率') + 1, 0, '税点')
  }
  return headers
}

export function splitSewingContractItemNo(value: unknown): { contractNo: string; itemNo: string } {
  const text = String(value ?? '').trim()
  const separator = text.lastIndexOf('/')
  if (separator <= 0 || separator >= text.length - 1) {
    return { contractNo: '', itemNo: text }
  }
  return {
    contractNo: text.slice(0, separator).trim(),
    itemNo: text.slice(separator + 1).trim(),
  }
}
