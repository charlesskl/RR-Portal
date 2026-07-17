import { describe, expect, it } from 'vitest'
import { buildDeliveryReport, parseDeliveryImport } from '../src/utils/deliveryStats'
import type { Order } from '../src/types/order'

function order(partial: Partial<Order>): Order {
  return {
    id: partial.id ?? 'id',
    factory: partial.factory ?? 'factory-id',
    product: partial.product ?? '产品',
    ...partial,
  }
}

describe('buildDeliveryReport', () => {
  it('counts the same order number as one order across multiple material rows', () => {
    const rows = buildDeliveryReport([
      order({
        id: 'row-1',
        order_no: 'FDYA-260140-2',
        product: '战斗猎犬头/鼻子',
        quantity: 3800,
        pmc: '陈梦楚',
        is_delayed: true,
        delay_days: 17,
      }),
      order({
        id: 'row-2',
        order_no: 'FDYA-260140-2',
        product: '战斗猎犬手掌/围裙',
        quantity: 3800,
        pmc: '陈梦楚',
        is_delayed: true,
        delay_days: 20,
      }),
    ], '东莞厂区 · 注塑部', () => '东莞鸿徽塑胶制品有限公司')

    expect(rows[0]).toMatchObject({
      kind: 'detail',
      orderCount: 1,
      delayedCount: 1,
      delayRatio: '100%',
      delayAvg: '20',
    })
    expect(rows[1]).toMatchObject({
      kind: 'detail',
      orderCount: 0,
      delayedCount: 0,
      delayRatio: '-',
      delayAvg: '-',
    })
    expect(rows[2]).toMatchObject({
      kind: 'subtotal',
      orderCount: 1,
      delayedCount: 1,
      delayRatio: '100%',
      delayAvg: '20',
    })
  })
})

describe('parseDeliveryImport', () => {
  it('imports plastic outsource purchase order templates', () => {
    const aoa = [
      ['塑胶发外加工采购单', '', '', '', '', '', '', '', '', '', '', ''],
      ['加工厂：东莞市清溪益正玩具厂', '', '', '日期：2026-07-02    交货日期：2026-07-23    ', '', '', '备注：77858-MA-RR-2400', '', '', '', '单号：CMC2600097', ''],
      ['序号', '款号', '模具编号', '物料编号', '物料名称', '用料名称', '颜色', '加工内容', '数量', '单价', '金额', '备注'],
      ['1', '77858-MA', 'MCKP-18M-01', '57002733A', '杯子 (印喷件)', 'ABS KF-740', '蓝色/644C', '印喷', '160,000', '0.2320', '37,120.0', ''],
      ['', '', '操作员： 陈梦楚', '', '', '', '', '', '', '', '', ''],
    ]

    const result = parseDeliveryImport(aoa, { '益正': 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1',
      pmc: '陈梦楚',
      item_no: '77858-MA',
      order_no: 'CMC2600097',
      product: '杯子 (印喷件)',
      process_category: '印喷',
      quantity: 160000,
      order_date: '2026-07-02',
      delivery_date: '2026-07-23',
      unit_price: 0.232,
      amount: 37120,
      notes: '77858-MA-RR-2400',
      status: 'placed',
      is_delayed: false,
    })
  })

  it('imports sewing purchase order templates', () => {
    const aoa = [
      ['东莞华登塑胶制品有限公司', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '车缝采购单', '', '', '', '', '', ''],
      ['供应商：', '东安县年达玩具厂', '', '', '', '', '订单编号：', 'NBFM26070401', '', ''],
      ['联络人：', '刘玉春', '', '', '', '', '联络人：', '陈文旋', '', ''],
      ['合同号/货号', '', '货 品 名 称', '单位', '数量', '单价   （含税价）', '金 额（¥）', '单重（G)', '重量（KG)', '备 注'],
      ['MA-RR-2345/92125', '', '橘猫', 'PCS', '10000', '2.853 ', '28530.00 ', '', '', ''],
      ['', '', '', '合计', '10000', '', '28,530.00', '', '', ''],
      ['1. 2026 年 8 月 15 日 前交货、货送东莞市清溪镇上元管理区银松路1号华登厂处', '', '', '', '', '', '', '', '', ''],
      ['时间： 2026 年 07 月 04 日', '', '', '', '', '', '', '', '', ''],
    ]

    const result = parseDeliveryImport(aoa, { '东安年达': 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1',
      pmc: '陈文旋',
      item_no: 'MA-RR-2345/92125',
      order_no: 'NBFM26070401',
      product: '橘猫',
      process_category: '车缝',
      quantity: 10000,
      order_date: '2026-07-04',
      delivery_date: '2026-08-15',
      unit_price: 2.853,
      amount: 28530,
      status: 'placed',
      is_delayed: false,
    })
  })

  it('imports molding contract templates', () => {
    const aoa = [
      ['东莞兴信塑胶制品有限公司', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['委 托 加 工 合 同', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', '供应商: ', '东莞市清溪鸿深公司', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', '编号: ', '', '公司名称: ZURU', '', '', '', '交货地点: B车间塑胶A仓', '', '', '', '交货日期: 2026-08-29', '', '', '单号:', 'WXH2600140', '', '', '', ''],
      ['', '款号', '模具编号', '工模名称', '数量', '总套数', '啤数', '加工单价', '加工金额', '颜色', '色粉号', '用料名称', '整啤毛重', '整啤净重', '啤机复期', '总毛重', '总净重', '水口比例', '交货日期', '备注'],
      ['', '77794-唱片机MA', 'MNVN-05M-01-2', '唱片模', '800000', '800000', '100000', '0.24', '24000', '梅红/806C', '63371', 'ABS GP22', '0', '12.9', '', '', '1290', '0.34', '2026/8/29', ''],
      ['', '备  注', '77794', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '特别注明：凡是移印、喷油、电镀、车衣部加工配件都需要先安排啤货，谢谢。', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', '下单日期:2026-07-15', '', '', '操作员:温雪花', '', '', '下单人:温雪花', '', '', '接单人:戴雅紗', '', '', '', '接单日期:2026-07-15', '', '', '', ''],
    ]

    const result = parseDeliveryImport(aoa, { '东莞市清溪鸿深电子厂': 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1',
      pmc: '温雪花',
      item_no: '77794-唱片机MA',
      order_no: 'WXH2600140',
      product: '唱片模',
      process_category: '啤机',
      quantity: 100000,
      order_date: '2026-07-15',
      delivery_date: '2026-08-29',
      unit_price: 0.24,
      amount: 24000,
      status: 'placed',
      is_delayed: false,
    })
  })
})
