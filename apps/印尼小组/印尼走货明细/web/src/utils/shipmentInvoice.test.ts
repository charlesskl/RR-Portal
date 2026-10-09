import { expect, it } from 'vitest'
import { customsInvoicePrice, withShipmentInvoicePrices } from './shipmentInvoice'
import { CUSTOMS_FIXED, sortShipmentItems } from './shipmentOrder'

it('华胜益普通行和末行按导出公式计算，不提前四舍五入', () => {
  expect(customsInvoicePrice(35.34, CUSTOMS_FIXED, 2)).toBe(35.34 * 1.05 / 7.2)
  expect(customsInvoicePrice(9.09, CUSTOMS_FIXED, 2, true)).toBe((9.09 * 1.05 + 1248 / 2) / 7.2)
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
  expect(result[1].invoice_price * result[1].kg).toBe(((20 * 1.05 + 1248 / 4) / 7.2) * 4)
  expect(withShipmentInvoicePrices([rows[0]], mats)[0].invoice_price).toBe((10 * 1.05 + 1248 / 2) / 7.2)
})
