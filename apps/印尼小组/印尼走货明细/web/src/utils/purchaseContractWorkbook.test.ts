import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { combinePurchaseContracts, formatPurchaseContractFonts, formatPurchaseContractTotals, roundPurchaseContractAmount, setPurchaseContractLineAmounts } from './purchaseContractWorkbook'
import { numToChinese } from './poNumber'

describe('采购导出计算精度', () => {
  it.each([
    [1.005, 1.01], [2.675, 2.68], [1.255, 1.26], [0.005, 0.01],
    [-1.005, -1.01], [-2.675, -2.68], [-1.255, -1.26], [-0.005, -0.01],
    [1.0049999999999999, 1.01], [-1.0049999999999999, -1.01],
    [1.0049, 1], [-1.0049, -1], [12345.675, 12345.68],
  ])('金额 %s 按 Excel 分位规则舍入为 %s', (amount, expected) => {
    expect(roundPurchaseContractAmount(amount)).toBe(expected)
  })

  it.each([
    [1, 1.005, 1.004],
    [100, 100 * 0.01005, 100 * 0.01004],
  ])('半分边界数量 %s 的单张和合并合同缓存、公式及大写均为 2.01', (quantity, first, second) => {
    const cents = [first, second].reduce((sum, amount) => sum + Math.round(roundPurchaseContractAmount(amount) * 100), 0)
    const total = roundPurchaseContractAmount(cents / 100)
    expect(total).toBe(2.01)
    const ws = XLSX.utils.aoa_to_sheet([
      ['SYNTHETIC-PO'], ['', '', '', '', '', '', ''], ['', '', '', '', '', '', ''],
      ['', '', '', '', '合计', '', total], ['', '', '', '', '大写', '人民币', numToChinese(total)],
    ])
    setPurchaseContractLineAmounts(ws, 2, quantity, first, 2)
    setPurchaseContractLineAmounts(ws, 3, quantity, second, 2)
    ws.G4.f = 'ROUND(SUM(G2:G3),2)'
    const single = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(single, ws, '合同')
    const combined = combinePurchaseContracts([{ entity: 'HSY', ws }, { entity: 'HSY', ws }])
    for (const [book, name, offsets] of [[single, '合同', [0]], [combined, '华胜益', [0, 7]]] as const) {
      const sheet = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets[name]
      for (const offset of offsets) {
        expect(sheet[`D${2 + offset}`].v).toBe(quantity)
        expect(sheet[`F${2 + offset}`].v).toBe(1.01 / quantity)
        expect(sheet[`G${2 + offset}`].v).toBe(1.01)
        expect(sheet[`G${3 + offset}`].v).toBe(1)
        expect(sheet[`G${2 + offset}`].f).toBe(`ROUND(D${2 + offset}*F${2 + offset},2)`)
        expect(sheet[`G${4 + offset}`].f).toBe(`ROUND(SUM(G${2 + offset}:G${3 + offset}),2)`)
        expect(sheet[`G${4 + offset}`].v).toBe(total)
        expect(sheet[`G${5 + offset}`].v).toBe('贰元零壹分')
      }
    }
  })

  it.each([
    [0.00808, 20200 * 0.08, 4, 0.0081, 1616 / 0.0081, 1616],
    [0.00202, 20200 * 0.07, 4, 0.002, 707000, 1414],
    [0.505, 151.5, 2, 0.51, 151.5 / 0.51, 151.5],
    [20200, 1616, 2, 20200, 0.08, 1616],
    [0, 0, 4, 0, 0, 0],
  ])('数量 %s 按原精度保留，调整单价保持金额不变', (quantity, amount, digits, roundedQuantity, price, expected) => {
    const ws = XLSX.utils.aoa_to_sheet([['合同'], ['', '', '', '', '', '', '']])
    setPurchaseContractLineAmounts(ws, 2, quantity, amount, digits)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '合同')
    const restored = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true }).Sheets['合同']
    expect(restored.D2.v).toBe(roundedQuantity)
    expect(restored.D2.z).toBe(`0.${'#'.repeat(digits)}`)
    expect(Number(restored.F2.v)).toBeCloseTo(price, 6)
    expect(restored.F2.z).toBe('0.0000')
    expect(XLSX.utils.format_cell(restored.F2)).toBe(price.toFixed(4))
    expect(restored.G2.f).toBe('ROUND(D2*F2,2)')
    expect(Number((Number(restored.D2.v) * Number(restored.F2.v)).toFixed(2))).toBe(expected)
    expect(restored.G2.v).toBe(expected)
  })

  it.each([
    ['KGM', 87, 168, '87.00', '1.9310'],
    ['KG', 10.8, 25.5, '10.80', '2.3611'],
    [' kg ', 13.5, 102, '13.50', '7.5556'],
    ['千克', 32.5, 292, '32.50', '8.9846'],
    ['公斤', 0, 0, '0.00', '0.0000'],
  ])('%s 数量在单张和合并导出中固定两位，单价四位但不改变金额', (unit, quantity, amount, quantityText, priceText) => {
    const ws = XLSX.utils.aoa_to_sheet([['合同'], ['', '', '', '', unit, '', '']])
    setPurchaseContractLineAmounts(ws, 2, quantity, amount, 2, unit)
    const single = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(single, ws, '合同')
    const combined = combinePurchaseContracts([{ entity: 'HSY', ws }, { entity: 'HSY', ws }])
    for (const [book, name, offsets] of [[single, '合同', [0]], [combined, '华胜益', [0, 4]]] as const) {
      const sheet = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true }).Sheets[name]
      for (const offset of offsets) {
        const row = 2 + offset
        expect(XLSX.utils.format_cell(sheet[`D${row}`])).toBe(quantityText)
        expect(XLSX.utils.format_cell(sheet[`F${row}`])).toBe(priceText)
        expect(sheet[`D${row}`].t).toBe('n')
        expect(sheet[`D${row}`].v).toBe(quantity)
        expect(sheet[`F${row}`].v).toBe(quantity ? amount / quantity : 0)
        expect(sheet[`G${row}`].v).toBe(amount)
        expect(sheet[`G${row}`].f).toBe(`ROUND(D${row}*F${row},2)`)
        expect(roundPurchaseContractAmount(Number(sheet[`D${row}`].v) * Number(sheet[`F${row}`].v))).toBe(amount)
      }
    }
  })

  it('数量舍入为零时保留原金额且留空无法计算的单价', () => {
    const ws = XLSX.utils.aoa_to_sheet([['', '', '', '', '', '', '']])
    setPurchaseContractLineAmounts(ws, 1, 0.000001, 0.25, 4)
    expect(ws.D1.v).toBe(0)
    expect(ws.F1.v).toBe('')
    expect(ws.G1.v).toBe(0.25)
    expect(ws.G1.f).toBeUndefined()
  })

  it('两行金额、合计、大写在单张和合并导出后均为 3030', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['2026900171'], ['', '', '', '', '', '', ''], ['', '', '', '', '', '', ''],
      ['', '', '', '', '合计', '', 3030], ['', '', '', '', '大写', '人民币', numToChinese(3030)],
    ])
    setPurchaseContractLineAmounts(ws, 2, 0.00808, 20200 * 0.08, 4)
    setPurchaseContractLineAmounts(ws, 3, 0.00202, 20200 * 0.07, 4)
    ws.G4.f = 'ROUND(SUM(G2:G3),2)'
    const wb = combinePurchaseContracts([{ entity: 'HSY', ws }, { entity: 'HSY', ws }])
    const exported = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true }).Sheets['华胜益']
    for (const offset of [0, 7]) {
      expect(exported[`D${2 + offset}`].v).toBe(0.0081)
      expect(exported[`D${3 + offset}`].v).toBe(0.002)
      expect(XLSX.utils.format_cell(exported[`F${2 + offset}`])).toBe('199506.1728')
      expect(XLSX.utils.format_cell(exported[`F${3 + offset}`])).toBe('707000.0000')
      const amounts = [2, 3].map(row => {
        const r = row + offset
        expect(exported[`G${r}`].f).toBe(`ROUND(D${r}*F${r},2)`)
        return Number((Number(exported[`D${r}`].v) * Number(exported[`F${r}`].v)).toFixed(2))
      })
      expect(amounts).toEqual([1616, 1414])
      expect(exported[`G${4 + offset}`].f).toBe(`ROUND(SUM(G${2 + offset}:G${3 + offset}),2)`)
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(exported[`G${4 + offset}`].v)
      expect(exported[`G${5 + offset}`].v).toBe(numToChinese(3030))
    }
  })
})

it('公司抬头 22 号、购销合同 18 号，其余 12 号加粗，合并后保持相同格式', () => {
  const ws = XLSX.utils.aoa_to_sheet([['标题', '明细', '合同条款', '英文名称', '物料编码'], [153], [], ['购销合同']])
  ws.A1.s = { font: { name: '宋体', sz: 22 }, alignment: { horizontal: 'center' } }
  ws.A2.s = { font: { sz: 11, bold: false }, border: { bottom: { style: 'thin' } } }
  ws.A2.f = 'SUM(B2:C2)'
  ws.A2.z = '0.00'
  formatPurchaseContractFonts(ws)
  const combined = combinePurchaseContracts([{ entity: 'HSY', ws }, { entity: 'HSY', ws }]).Sheets['华胜益']
  for (const sheet of [ws, combined]) {
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue
      const isCompanyTitle = address === 'A1' || (sheet === combined && address === 'A7')
      const isContractTitle = address === 'A4' || (sheet === combined && address === 'A10')
      expect(cell.s.font.sz).toBe(isCompanyTitle ? 22 : isContractTitle ? 18 : 12)
      expect(cell.s.font.bold).toBe(true)
    }
  }
  expect(combined.A7.v).toBe('标题')
  expect(combined.A7.s.font.sz).toBe(22)
  expect(combined.A10.v).toBe('购销合同')
  expect(combined.A10.s.font.sz).toBe(18)
  expect(ws.A1.s.font.name).toBe('宋体')
  expect(ws.A1.s.alignment.horizontal).toBe('center')
  expect(ws.A2.s.border.bottom.style).toBe('thin')
  expect(ws.A2.v).toBe(153)
  expect(ws.A2.f).toBe('SUM(B2:C2)')
  expect(ws.A2.z).toBe('0.00')
})

describe('采购合同合计与大写布局', () => {
  it.each(['人民币', '美金'])('按样表对齐%s金额且保留计算公式', currency => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['', '', '', 1636.2, '', 3.04938272, 4989.4],
      ['', '', '', '', '合计', '', 4989.4, ''],
      ['', '', '', '', '大写', currency, '肆仟玖佰捌拾玖元肆角', ''],
    ])
    ws.G2.f = 'ROUND(SUM(G1:G1),2)'
    ws.G2.z = currency === '人民币' ? '"¥"#,##0.00' : '"US$"#,##0.00'
    ws['!cols'] = Array.from({ length: 8 }, (_, index) => ({ wch: index === 7 ? 18 : 13 }))
    ws.G3.s = { font: { sz: 11 }, border: { bottom: { style: 'thin' } } }
    formatPurchaseContractTotals(ws, 1)
    expect(ws['!merges']).toEqual([
      { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
      { s: { r: 1, c: 6 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 6 }, e: { r: 2, c: 7 } },
    ])
    expect(ws.E3.v).toBe('大写')
    expect(ws.F3.v).toBe(currency)
    expect(ws.G3.s.alignment).toEqual({ horizontal: 'left', vertical: 'center', wrapText: true })
    expect(ws.G3.s.font.sz).toBe(11)
    expect(ws.G3.s.border.bottom.style).toBe('thin')
    expect(ws['!rows']?.[2]?.hpt).toBeGreaterThanOrEqual(24)
    const wb = combinePurchaseContracts([{ entity: 'HD_GLOBAL', ws }, { entity: 'HD_GLOBAL', ws }])
    const restored = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellStyles: true })
    const combined = restored.Sheets['华登全球']
    expect(combined.E8.v).toBe('大写')
    expect(combined.F8.v).toBe(currency)
    expect(combined.G8.v).toBe('肆仟玖佰捌拾玖元肆角')
    expect(combined.G7.f).toBe('ROUND(SUM(G6:G6),2)')
    expect(combined.G7.v).toBe(4989.4)
    expect(combined['!merges']).toContainEqual({ s: { r: 7, c: 6 }, e: { r: 7, c: 7 } })
  })

  it('长大写金额增加行高，不挤进备注的单个窄格', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['', '', '', '', '合计', '', 123456789.99, ''],
      ['', '', '', '', '大写', '人民币', '壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元玖角玖分', ''],
    ])
    formatPurchaseContractTotals(ws, 0)
    expect(ws['!rows']?.[1]?.hpt).toBeGreaterThan(24)
    expect(ws.G2.v).toBe('壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元玖角玖分')
  })
})

function contract(no: string) {
  const ws = XLSX.utils.aoa_to_sheet([[no], ['', '', '', 2, '', 3, 6], ['', '', '', '', '', '', 6]])
  ws.G2.f = 'ROUND(D2*F2,2)'
  ws.G3.f = 'ROUND(SUM(G2:G2),2)'
  ws.A1.s = { font: { bold: true, sz: 22 } }
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]
  ws['!cols'] = [{ wch: 12 }]
  ws['!rows'] = [{ hpt: 30 }]
  return ws
}

describe('按采购主体合并合同', () => {
  it('每个主体一张表，同主体多张合同保留编号、样式和独立公式', () => {
    const first = contract('IRRIHS0402')
    const second = contract('IRRIHS0403')
    const wb = combinePurchaseContracts([
      { entity: 'HSY', ws: contract('2026900171') },
      { entity: 'HD_INDUSTRY', ws: first },
      { entity: 'HD_GLOBAL', ws: contract('IRRMHS0060') },
      { entity: 'HD_INDUSTRY', ws: second },
    ])
    expect(wb.SheetNames).toEqual(['华登实业', '华登全球', '华胜益'])
    const ws = wb.Sheets['华登实业']
    expect(ws.A1.v).toBe('IRRIHS0402')
    expect(ws.A6.v).toBe('IRRIHS0403')
    expect(ws.G7.f).toBe('ROUND(D7*F7,2)')
    expect(ws.G8.f).toBe('ROUND(SUM(G7:G7),2)')
    expect(ws.G8.v).toBe(6)
    expect(ws.A6.s).toEqual(first.A1.s)
    expect(ws['!rows']?.[5]).toEqual({ hpt: 30 })
    expect(ws['!cols']).toEqual(first['!cols'])
    expect(ws['!merges']?.[1]).toEqual({ s: { r: 5, c: 0 }, e: { r: 5, c: 6 } })
    expect(second.G2.f).toBe('ROUND(D2*F2,2)')
    const restored = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(restored.Sheets['华登实业'].G8.f).toBe('ROUND(SUM(G7:G7),2)')
    expect(restored.Sheets['华胜益'].A1.v).toBe('2026900171')
  })

  it('没有订单的主体不产生空表', () => {
    const wb = combinePurchaseContracts([{ entity: 'HD_GLOBAL', ws: contract('IRRMHS0060') }])
    expect(wb.SheetNames).toEqual(['华登全球'])
  })
})
