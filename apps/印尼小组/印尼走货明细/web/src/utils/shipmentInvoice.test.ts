import { expect, it } from 'vitest'
import { customsInvoiceFormula, customsInvoicePrice, withShipmentInvoicePrices } from './shipmentInvoice'
import { CUSTOMS_FIXED, sortShipmentItems } from './shipmentOrder'

it('华胜益普通行和末行按导出公式计算，不提前四舍五入', () => {
  expect(customsInvoicePrice(35.34, CUSTOMS_FIXED, 2)).toBe(35.34 * 1.05 / 7.2)
  expect(customsInvoicePrice(9.09, CUSTOMS_FIXED, 2, true)).toBeCloseTo((9.09 * 1.05 + 1248 / 2) / 7.2, 10)
})
it('其他公司取采购价；零重量不产生无穷大', () => {
  expect(customsInvoicePrice(35.34, '其他公司', 2, true)).toBe(35.34)
  expect(customsInvoicePrice(9.09, CUSTOMS_FIXED, 0, true)).toBe(9.09 * 1.05 / 7.2)
})
it('按排序及主资料确定每组末行，删除后重新计算附加费用位置', () => {
  const mats = new Map([[1, { customs_company: CUSTOMS_FIXED }], [2, { customs_company: CUSTOMS_FIXED }]])
  const rows = [{ material_id: 1, supplier: 'A', price: 10, kg: 2, qty: 99 },
    { material_id: 2, supplier: 'B', price: 20, kg: 4, qty: 50 }]
  const result = withShipmentInvoicePrices(sortShipmentItems(rows, mats), mats)
  expect(result[0].invoice_price).toBe(10 * 1.05 / 7.2)
  expect(result[1].invoice_price * result[1].kg).toBeCloseTo(((20 * 1.05 + 1248 / 4) / 7.2) * 4, 10)
  expect(withShipmentInvoicePrices([rows[0]], mats)[0].invoice_price).toBeCloseTo((10 * 1.05 + 1248 / 2) / 7.2, 10)
})

it('美元采购不加价、不重复换汇，明确华胜益末行仅换算人民币附加费', () => {
  for (const currency of ['USD', 'US$', '美元']) {
    expect(customsInvoicePrice(35.34, CUSTOMS_FIXED, 2, false, currency)).toBe(35.34)
    expect(customsInvoicePrice(9.09, CUSTOMS_FIXED, 2, true, currency)).toBeCloseTo(9.09 + 1248 / 2 / 7.2, 10)
    expect(customsInvoicePrice(9.09, '', 2, true, currency)).toBe(9.09)
    expect(customsInvoicePrice(9.09, CUSTOMS_FIXED, 0, true, currency)).toBe(9.09)
  }
})

it('空白或清空报关公司不使用显示默认值，附加费只在明确华胜益的最后一行计一次', () => {
  const mats = new Map([[1, { customs_company: CUSTOMS_FIXED }]])
  const rows = [
    { price: 35.34, kg: 2, currency: 'USD', customs_company: CUSTOMS_FIXED },
    { price: 12.0453, kg: 3.97, currency: 'USD' },
    { price: 9.09, kg: 2, currency: 'USD', customs_company: CUSTOMS_FIXED },
    { price: 10, kg: 2, currency: 'USD', material_id: 1, customs_company: '' },
  ]
  expect(withShipmentInvoicePrices(rows, mats).map(row => row.invoice_price)).toEqual([
    35.34, 12.0453, 9.09 + 1248 / 2 / 7.2, 10,
  ])
})

it('导出公式按币种和明确的报关公司采用相同规则', () => {
  expect(customsInvoiceFormula(2, '', true, 'USD')).toBe('AO2')
  expect(customsInvoiceFormula(2, '其他公司', true, 'CNY')).toBe('AO2')
  expect(customsInvoiceFormula(2, CUSTOMS_FIXED, false, 'USD')).toBe('AO2')
  expect(customsInvoiceFormula(2, CUSTOMS_FIXED, true, 'USD')).toBe('AO2+IF(K2>0,1248/K2/7.2,0)')
  expect(customsInvoiceFormula(2, CUSTOMS_FIXED, true, 'CNY')).toBe('AO2*1.05/7.2+IF(K2>0,1248/K2/7.2,0)')
})
