import { expect, it } from 'vitest'
import { toolShipmentFields } from './toolShipment'

it.each([['USD', 'US$'], ['CNY', '¥'], ['HKD', 'HK$'], ['IDR', 'IDR']])('工具采购币种 %s 保持含义', (input, output) => {
  expect(toolShipmentFields({ id: 8, supplier: '供应商', purchase_price: 35.34, purchase_currency: input, unit_kg: 'PCE' }))
    .toEqual({ material_id: 8, supplier: '供应商', price: 35.34, currency: output, purchase_unit: 'PCE',
      invoice_price: 0, po_no: '', po_date: '', outbound_id: undefined })
})
it('零采购单价不丢失，缺失币种不猜测，采购价不冒充发票价', () => {
  expect(toolShipmentFields({ purchase_price: 0 })).toMatchObject({ price: 0, currency: '', invoice_price: 0 })
})
