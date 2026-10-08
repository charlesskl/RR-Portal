import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { combinePurchaseContracts } from './purchaseContractWorkbook'

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
