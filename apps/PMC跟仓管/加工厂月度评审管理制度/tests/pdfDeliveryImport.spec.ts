import { describe, expect, it } from 'vitest'
import { pdfTextRowsToAoa, purchaseOrderPdfItemsToAoa } from '../src/utils/pdfTableRows'

describe('pdfTextRowsToAoa', () => {
  it('rebuilds delivery table rows from positioned PDF text', () => {
    const items = [
      { text: '货号', x: 10, y: 100, width: 20 },
      { text: '订单号', x: 70, y: 100, width: 30 },
      { text: '物料名称', x: 130, y: 100, width: 45 },
      { text: '数量', x: 210, y: 100, width: 20 },
      { text: '77711', x: 10, y: 80, width: 25 },
      { text: '000001', x: 70, y: 80, width: 36 },
      { text: '迷你食物', x: 130, y: 80, width: 45 },
      { text: '10000', x: 210, y: 80, width: 25 },
    ]

    expect(pdfTextRowsToAoa(items)).toEqual([
      ['货号', '订单号', '物料名称', '数量'],
      ['77711', '000001', '迷你食物', '10000'],
    ])
  })
})

describe('purchaseOrderPdfItemsToAoa', () => {
  it('recognizes Xingxin outsourced purchase order fields', () => {
    const items = [
      { text: '委托加工合同', x: 221, y: 736, width: 132 },
      { text: '供應商：', x: 41, y: 724, width: 40 },
      { text: '东莞市清溪俊豪塑胶厂', x: 84, y: 724, width: 100 },
      { text: '採購單編號：', x: 396, y: 724, width: 60 },
      { text: 'CMC260436', x: 458, y: 723, width: 67 },
      { text: '日', x: 396, y: 706, width: 10 },
      { text: '期： 2026年07月09日', x: 436, y: 706, width: 92 },
      { text: '陈梦楚', x: 458, y: 687, width: 30 },
      { text: '貨號', x: 41, y: 628, width: 20 },
      { text: '貨物名稱', x: 89, y: 628, width: 40 },
      { text: '數量', x: 397, y: 628, width: 20 },
      { text: '單價(￥)', x: 449, y: 628, width: 34 },
      { text: '15783总MA', x: 30, y: 613, width: 41 },
      { text: '（新）', x: 30, y: 603, width: 27 },
      { text: '眼睛扣模', x: 77, y: 608, width: 36 },
      { text: '10000', x: 397, y: 608, width: 23 },
      { text: '0.3300', x: 453, y: 608, width: 26 },
      { text: 'E-11-04/35MM', x: 527, y: 609, width: 42 },
    ]

    expect(purchaseOrderPdfItemsToAoa(items, '15783-东莞市清溪俊豪塑胶厂CMC260436.pdf')).toEqual([
      ['加工厂', '下单PMC', '货号', '订单号', '物料名称', '数量', '下单时间', '外发工价', '备注'],
      ['东莞市清溪俊豪塑胶厂', '陈梦楚', '15783', 'CMC260436', '眼睛扣模', '10000', '2026-07-09', '0.3300', 'E-11-04/35MM'],
    ])
  })

  it('uses quantity and unit price rows as anchors for multiline item numbers', () => {
    const items = [
      { text: '委托加工合同', x: 221, y: 736, width: 132 },
      { text: '供應商：', x: 41, y: 724, width: 40 },
      { text: '东莞市清溪鸿深电子厂', x: 84, y: 724, width: 100 },
      { text: 'LLQ2023664', x: 458, y: 723, width: 71 },
      { text: '期： 2026年07月10日', x: 436, y: 706, width: 92 },
      { text: '周伟中', x: 458, y: 687, width: 30 },
      { text: '貨號', x: 41, y: 628, width: 20 },
      { text: '貨物名稱', x: 89, y: 628, width: 40 },
      { text: '數量', x: 397, y: 628, width: 20 },
      { text: '單價(￥)', x: 449, y: 628, width: 34 },
      { text: '77711-总M', x: 30, y: 613, width: 41 },
      { text: 'A（北美新', x: 30, y: 603, width: 41 },
      { text: '配比）', x: 30, y: 531, width: 27 },
      { text: '汉堡模具', x: 77, y: 572, width: 36 },
      { text: '334544', x: 394, y: 572, width: 26 },
      { text: '0.3500', x: 453, y: 572, width: 26 },
      { text: '77711-总M', x: 30, y: 519, width: 41 },
      { text: 'A（北美新', x: 30, y: 508, width: 41 },
      { text: '芝士面盒子模具', x: 77, y: 462, width: 63 },
      { text: '269697', x: 394, y: 462, width: 26 },
      { text: '0.2800', x: 453, y: 462, width: 26 },
    ]

    expect(purchaseOrderPdfItemsToAoa(items).slice(1)).toEqual([
      ['东莞市清溪鸿深电子厂', '周伟中', '77711', 'LLQ2023664', '汉堡模具', '334544', '2026-07-10', '0.3500', ''],
      ['东莞市清溪鸿深电子厂', '周伟中', '77711', 'LLQ2023664', '芝士面盒子模具', '269697', '2026-07-10', '0.2800', ''],
    ])
  })
})
