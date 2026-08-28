import { describe, expect, it } from 'vitest'
import { buildDeliveryReport, deliveryHeaders, formatHkdOutPrice, parseDeliveryImport, splitSewingContractItemNo } from '../src/utils/deliveryStats'
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
  it('formats HKD outsource prices with exactly three decimal places', () => {
    expect(formatHkdOutPrice(0.5289)).toBe('0.529')
    expect(formatHkdOutPrice(1.36)).toBe('1.360')
  })

  it('counts the same order number as one order across multiple material rows', () => {
    const rows = buildDeliveryReport([
      order({
        id: 'row-1',
        order_no: 'FDYA-260140-2',
        product: '战斗猎犬头/鼻子',
        quantity: 3800,
        pmc: '陈梦楚',
        unit_price_cny_tax: 1.2,
        is_delayed: true,
        delay_days: 17,
      }),
      order({
        id: 'row-2',
        order_no: 'FDYA-260140-2',
        product: '战斗猎犬手掌/围裙',
        quantity: 3800,
        pmc: '陈梦楚',
        unit_price_cny_tax: 1.3,
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
      outPriceCnyTax: 1.2,
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
      outPriceCnyTax: 2.5,
    })
  })

  it('uses CNY tax-inclusive price divided by tax point for RMB pricing', () => {
    const source = [order({
      id: 'sewing-row',
      unit_price: 2.2722,
      unit_price_cny_tax: 2.85,
      exchange_rate: 1.11,
    })]
    const regularRows = buildDeliveryReport(source, '装配部', () => '工厂')
    const sewingRows = buildDeliveryReport(source, '车缝部', () => '工厂', true)

    expect(regularRows[0]).toMatchObject({ kind: 'detail', outPrice: 2.2722 })
    expect(sewingRows[0]).toMatchObject({ kind: 'detail', outPrice: 2.5676 })
    expect(sewingRows[1]).toMatchObject({ kind: 'subtotal', outPrice: 2.57 })
  })

  it('uses factory tax point as well as FX rate for Dongguan HKD pricing', () => {
    const rows = buildDeliveryReport([order({
      id: 'hkd-tax-row', unit_price_cny_tax: 6, exchange_rate: 0.87,
    })], '东莞厂区 · 注塑部', () => '工厂', 'hkd-tax', () => 1.11)

    expect(rows[0]).toMatchObject({ kind: 'detail', outPrice: 6.2131, exchangeRate: 0.87, taxPoint: 1.11 })
    expect(rows[1]).toMatchObject({ kind: 'subtotal', outPrice: 6.213 })
  })
})

describe('splitSewingContractItemNo', () => {
  it('splits a sewing contract and item number at the last slash', () => {
    expect(splitSewingContractItemNo('MA-RR-2345/92125')).toEqual({
      contractNo: 'MA-RR-2345',
      itemNo: '92125',
    })
  })

  it('keeps legacy values without a slash as the item number', () => {
    expect(splitSewingContractItemNo('92125')).toEqual({
      contractNo: '',
      itemNo: '92125',
    })
  })
})

describe('deliveryHeaders', () => {
  it('uses RMB untaxed pricing labels and tax point only for sewing', () => {
    const sewing = deliveryHeaders(false, true)
    expect(sewing).toContain('核价工价(不含税RMB)')
    expect(sewing).toContain('外发工价(不含税RMB)')
    expect(sewing).toContain('税点')
    expect(sewing).not.toContain('换算汇率')

    const assembly = deliveryHeaders(false, false)
    expect(assembly).toContain('核价工价(港币不含税$)')
    expect(assembly).toContain('外发工价(港币不含税$)')
    expect(assembly).toContain('换算汇率')

    const dongguanTax = deliveryHeaders(true, false, 'hkd-tax')
    expect(dongguanTax).toContain('换算汇率')
    expect(dongguanTax).toContain('税点')
  })
})

describe('parseDeliveryImport', () => {
  it('imports Hunan injection purchase orders with the tax-inclusive outsource unit price', () => {
    const aoa = [
      ['采购单（啤机）'],
      ['加工商：', '越翔', '', '', '', 'PMC单编号：', 'BB2026135-BB124'],
      ['', '', '', '', '', '日期：', '2026/7/6'],
      ['货号', '模号', '名称', '颜色编号', '加工类别', '用料', '啤重', '数量', '啤数', '用料量', '外发单价（啤）', '金额', '完成交货期'],
      ['77772', 'MNVN-11M-01', '耳罩模', '黑色7726', '注塑', 'PVC', 12.5, '1836736', '225952', '2869.90', '0.28', '64285.76', '2026/9/7'],
      ['', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['采购签核：', '车浪宇'],
    ]
    const result = parseDeliveryImport(aoa, { 越翔: 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1', order_no: 'BB2026135-BB124', item_no: '77772', mold_no: 'MNVN-11M-01',
      product: '耳罩模', process_category: '注塑', quantity: 1836736, unit_price_cny_tax: 0.28,
      order_date: '2026-07-06', delivery_date: '2026-09-07', pmc: '车浪宇',
    })
  })

  it('imports Hunan sewing purchase orders and takes the final delivery date from a date range', () => {
    const aoa = [
      ['采购单'],
      ['供应商：', '光明', '', '', '', '订单编号：', 'HHGM20260002'],
      ['货号', '货品名称', '数量', '单位', '单价', '加工项目', 'MA号', '备注'],
      ['125160', '杏色毛冷怪', '15000', 'PCS', '¥ 1.42', '车缝', '011', ''],
      ['交货期：2026年7月29日至2026年8月22日，货送园区3栋处'],
      ['采购签核：', '易鸳姣'],
      ['时间：2026年07月09日'],
    ]
    const result = parseDeliveryImport(aoa, { 光明: 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1', order_no: 'HHGM20260002', item_no: '125160', product: '杏色毛冷怪',
      process_category: '车缝', quantity: 15000, unit_price_cny_tax: 1.42,
      delivery_date: '2026-08-22', order_date: '2026-07-09', pmc: '易鸳姣',
    })
  })

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

  it('imports assembly processing contract templates', () => {
    const aoa = [
      ['东莞华登塑胶制品有限公司', '', '', '', '', '', '', '', ''],
      ['', '加工厂：', '邵阳华登塑胶制品有限公司', '', '', '', '', '订单编号：', 'SY20260042'],
      ['', '', '', '', '', '', '', '下单日期', '2026-07-03'],
      ['', '', '', '', '', '', '', '联络人：', '严新荟'],
      ['序号', '产品货号', '生产单号', '产品装配名称', '装配方式', '加工数量', '单价（¥）', '金额（¥）：', '备注'],
      [1, 'SR1023', '', '手链', '包装(已装箱)', 69480, 1.28, 88934.4, ''],
      [2, 'SR1023CDU-16', '', '手链', '包装(已装箱)', 25440, 1.33, 33835.2, ''],
      ['1、', '2026年08月01日前交货货送 A栋三楼处，收货人：', '', '', '', '', '', '', ''],
      ['', '', '', '采购签核：', '严新荟', '', '', '', ''],
    ]

    const result = parseDeliveryImport(aoa, { '邵阳华登塑胶制品有限公司': 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1',
      pmc: '严新荟',
      item_no: 'SR1023',
      order_no: 'SY20260042',
      product: '手链',
      process_category: '包装(已装箱)',
      quantity: 69480,
      order_date: '2026-07-03',
      delivery_date: '2026-08-01',
      unit_price_cny_tax: 1.28,
      amount: 88934.4,
      status: 'placed',
      is_delayed: false,
    })
  })

  it('imports every order section in painting purchase order templates', () => {
    const aoa = [
      ['邵阳市华登塑胶制品有限公司', '', '', '', '', '', '', '', ''],
      ['供应商：', '新宁县安山乡创达玩具厂', '', '', '', '', '订单编号：', 'DP26052-PC076', ''],
      ['', '', '', '', '', '', '', '联络人：', '韦文帅', ''],
      ['货 号', '货 物 名 称', '加工类别', '数量', '单位', '单价', '金额', '备 注'],
      [92106, '幻彩紫考拉', '印喷', 5000, 'PCS', 0.159, 795, ''],
      [92106, '幻彩白考拉', '印喷', 5000, 'PCS', 0.159, 795, ''],
      ['', '', '', '', '', '', '合计', 1590],
      ['1. 2026年 7 月 13 日前交货 8 月 8 日 前交完，货送24栋处', '', '', '', '', '', '', ''],
      ['采购签核：陈玉叶', '', '', '', '时间：2026年7月3日', '', '', ''],
      ['供应商：', '新宁县安山乡创达玩具厂', '', '', '', '', '订单编号：', 'DP26053-PC077', ''],
      ['货 号', '货 物 名 称', '加工类别', '数量', '单位', '单价', '金额', '备 注'],
      ['47722A', '小鸡1#', '印喷', 2500, 'PCS', 0.25, 625, ''],
      ['1. 2026年 7 月 28 日前交货 8 月 5 日 前交完，货送24栋处', '', '', '', '', '', '', ''],
      ['采购签核：陈玉叶', '', '', '', '时间：2026年7月3日', '', '', ''],
    ]

    const result = parseDeliveryImport(aoa, { '新宁县安山乡创达玩具厂': 'factory-1' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(3)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1', pmc: '陈玉叶', item_no: '92106', order_no: 'DP26052-PC076',
      product: '幻彩紫考拉', process_category: '印喷', quantity: 5000,
      order_date: '2026-07-03', delivery_date: '2026-07-13', unit_price_cny_tax: 0.159, amount: 795,
    })
    expect(result.payloads[2]).toMatchObject({
      order_no: 'DP26053-PC077', item_no: '47722A', product: '小鸡1#', delivery_date: '2026-07-28',
    })
  })

  it('imports Hunan painting purchase orders using 货品名称 and 外发单价 headers', () => {
    const aoa = [
      ['邵阳市华登塑胶制品有限公司'],
      ['', '', '', '采购单'],
      [],
      ['供应商：', '邵阳县盛钜塑胶制品有限公司', '', '', '', '订单编号：', 'AP26088-PQ012'],
      ['联络人：', '吴小锋', '', '', '', '联络人：', '韦文帅'],
      [], [],
      ['货 号', '货 品 名 称', '加工类别', '数量', '单位', '外发单价', '金额', '备 注'],
      [77555, '圆台灯面罩', '印喷', 40200, 'PCS', 0.032, 1286.4, ''],
      [77555, 'A咖啡机上包装盒', '印喷', 25400, 'PCS', 0.119, 3022.6, ''],
      [77555, 'A咖啡机研磨柄', '印喷', 25400, 'PCS', 0.044, 1117.6, ''],
      [77555, 'A咖啡机座', '印喷', 25400, 'PCS', 0.142, 3606.8, ''],
      [77555, 'A咖啡机上盖', '印喷', 25400, 'PCS', 0.151, 3835.4, ''],
      [77555, 'A咖啡机身', '印喷', 25400, 'PCS', 0.135, 3429, ''],
      [77555, '烫衣架面板', '印喷', 40200, 'PCS', 0.02, 804, ''],
      [77555, '台灯罩', '印喷', 40200, 'PCS', 0.047, 1889.4, ''],
      ['', '', '', '附送1%备品', '', '合计', 18991.2, ''],
      ['1. 2026年 8 月 5 日前交货、 8 月 24 日前交完，货送 21 栋 处，收货人： 李力'],
      [],
      ['供应商确认：', '吴小锋', '采购签核： 陈玉叶', '', '主管：韦文帅', '', '经理：王浩帅'],
      ['时间： 2026 年 7 月 13 日', '', '', '', '时间： 2026 年 7 月 13 日'],
    ]

    const result = parseDeliveryImport(aoa, { 盛钜: 'factory-shengju' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(8)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-shengju', pmc: '陈玉叶', item_no: '77555', order_no: 'AP26088-PQ012',
      product: '圆台灯面罩', process_category: '印喷', quantity: 40200,
      unit_price_cny_tax: 0.032, amount: 1286.4,
      order_date: '2026-07-13', delivery_date: '2026-08-05',
    })
    expect(result.payloads[7]).toMatchObject({
      product: '台灯罩', quantity: 40200, unit_price_cny_tax: 0.047, amount: 1889.4,
    })
  })

  it('imports row delivery times and the following order time from Hunan assembly purchase orders', () => {
    const aoa = [
      ['邵阳市华登塑胶制品有限公司'],
      ['', '', '采购单'],
      [],
      ['供应商：', '华宏', '', '', '订单编号：', '', '', 'HH20260701-1'],
      ['联络人：', '伍贤用', '', '', '联络人：', '', '', '余小兵'],
      [], [],
      ['货号', '货 品 名 称', '数量', '单位', '商品名称', '订单PO', '交货时间', '单价', '备注'],
      ['9565GQ1-S001', '松鼠', 968, 'pcs', '成品', '4500203225-140', new Date('2026-07-06T00:00:00Z'), 1.02, ''],
      ['9565GQ5-SLB-S002', '松鼠', 2720, 'pcs', '成品', '4500209323-40', '2026/7/6周一', 1.02, ''],
      ['', '合计', 3688],
      ['供应商确认：', '', '采购签核：', '伍计红', '主管：', '', '经理：'],
      ['交货时间：', '', '', '', '', '', '下单时间：2026年7月1日'],
      ['物料名称', '规格', '用量', '需求数', '领料数', '领料数', '领料数', '交货日期', '交货数'],
      ['浅绿色松鼠半成品', '', 1, 8265],
      ['邵阳市华登塑胶制品有限公司'],
      ['供应商：', '华宏', '', '', '订单编号：', '', '', 'HH20260706-1'],
      ['货号', '货 品 名 称', '数量', '单位', '商品名称', '订单PO', '交货时间', '单价', '备注'],
      ['9565GQ1-S002', '松鼠', 2112, 'pcs', '成品', '4500210826-90', '2026/7/10', 1.02, ''],
      ['', '合计', 2112],
      ['下单时间：2026年7月6日'],
    ]

    const result = parseDeliveryImport(aoa, { 华宏: 'factory-huahong' })

    expect(result.failed).toBe(0)
    // 连续两张采购单分段解析：各自取自己的单号与下单/交货日期
    expect(result.payloads).toHaveLength(3)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-huahong', pmc: '伍计红', order_no: 'HH20260701-1',
      item_no: '9565GQ1-S001', product: '松鼠', process_category: '成品',
      order_date: '2026-07-01', delivery_date: '2026-07-06',
    })
    expect(result.payloads[1]).toMatchObject({
      item_no: '9565GQ5-SLB-S002', order_date: '2026-07-01', delivery_date: '2026-07-06',
    })
    expect(result.payloads[2]).toMatchObject({
      factory: 'factory-huahong', order_no: 'HH20260706-1',
      item_no: '9565GQ1-S002', order_date: '2026-07-06', delivery_date: '2026-07-10',
    })
  })

  it('imports consecutive assembly orders in one visible sheet with per-order dates', () => {
    const aoa = [
      ['邵阳市华登塑胶制品有限公司'],
      ['供应商：', '大罗', '', '', '订单编号：', '', '', 'DL20260701-1'],
      ['货号', '货 品 名 称', '数量', '单位', '商品名称', '订单PO', '交货日期', '单价', '备注'],
      ['77782GQ1-S001-INT', '冰箱迷你球(客版）', 400, '个', '成品包装', '4500203233-60', new Date('2026-07-19T15:59:17Z'), 0.391, ''],
      ['', '合计', 400],
      ['供应商确认：', '', '采购签核：', '伍计红'],
      ['交货时间：已实际交货日期为准', '', '', '', '', '', '下单日期：2026年7月1日'],
      ['邵阳市华登塑胶制品有限公司'],
      ['供应商：', '大罗', '', '', '订单编号：', '', '', 'DL20260727-1'],
      ['货号', '货 品 名 称', '数量', '单位', '商品名称', '订单PO', '交货日期', '单价', '备注'],
      ['77711GQ2-S001-NA', '冰箱迷你球', 5000, 'PCS', '成品包装', 'MPO11007-20', '2026/8/12', 0.391, ''],
      ['', '合计', 5000],
      ['下单日期：2026年7月27日'],
    ]

    const result = parseDeliveryImport(aoa, { 大罗: 'factory-daluo' })

    expect(result.failed).toBe(0)
    // 两张采购单分别导入，各自取自己段内的下单日期与交货日期
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-daluo', order_no: 'DL20260701-1', order_date: '2026-07-01',
      delivery_date: '2026-07-20', item_no: '77782GQ1-S001-INT',
    })
    expect(result.payloads[1]).toMatchObject({
      factory: 'factory-daluo', order_no: 'DL20260727-1', order_date: '2026-07-27',
      delivery_date: '2026-08-12', item_no: '77711GQ2-S001-NA',
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
      mold_no: 'MNVN-05M-01-2',
      order_no: 'WXH2600140',
      product: '唱片模',
      process_category: '啤机',
      quantity: 100000,
      order_date: '2026-07-15',
      delivery_date: '2026-08-29',
      unit_price_cny_tax: 0.24,
      amount: 24000,
      status: 'placed',
      is_delayed: false,
    })
    expect(result.payloads[0].unit_price).toBeUndefined()
  })

  it('imports Dongguan electronics processing contracts including the process column', () => {
    const aoa = [
      ['东莞市登信电子有限公司'],
      ['', '', '', '委托加工合同'],
      [],
      ['厂  商：', '彰源', '', '', '', '', '订单编号：', 'FDI00040262'],
      ['联络人：', '刘先生', '', '', '', '', '联络人：', '张焕丽'],
      [], [], [],
      ['货 号', '货 品 名 称', '工序', '数量', '单位', '单 价', '金 额', '单重（G)', '重量（KG)', '商品名称', '备 注'],
      ['1026157-城市套装游戏机-PCBA\n（法国-FR）\nFlash:AMSFX128DHS-P07MCUAM32A070A-052', '电子料', '贴片', 2040, 'PCS', 0.38, 775.2, '', '', '', 'BBD-40132354-01'],
      ['1226157-西班牙城市套装游戏机\n-ES-PCBA Flash:\nAMSFX128DHS-P08MCU:\nAM32A070A-051', '电子料', '贴片', 5100, 'PCS', 0.38, 1938, '', '', '', 'BBD-40132354-01'],
      ['1026157-城市套装游戏机-PCBA\n（法国-FR）\nFlash:AMSFX128DHS-P07MCUAM32A070A-052', 'IC', '邦定', 2040, 'PCS', 0.5, 1020, '', '', '', 'BBD-40132354-01'],
      ['1226157-西班牙城市套装游戏机\n-ES-PCBA Flash:\nAMSFX128DHS-P08MCU:\nAM32A070A-051', 'IC', '邦定', 5100, 'PCS', 0.5, 2550, '', '', '', 'BBD-40132354-01'],
      ['', '', '', '', '', '合计', 6283.2],
      ['1. 2026 年8月25日前交货、货送 D栋二楼货仓 处，收货人：符小姐'],
      [],
      ['供应商确认：', '', '', '采购签核：胡爱莲', '', '', '主管：', '', '经理：'],
      ['时间：    年    月   日', '', '', '', '时间：  2026  年7月 31 日'],
    ]

    const result = parseDeliveryImport(aoa, { 彰源: 'factory-electronics' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(4)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-electronics',
      pmc: '胡爱莲',
      item_no: '1026157-城市套装游戏机-PCBA\n（法国-FR）\nFlash:AMSFX128DHS-P07MCUAM32A070A-052',
      order_no: 'FDI00040262',
      product: '电子料',
      process: '贴片',
      process_category: '贴片',
      quantity: 2040,
      unit_price_cny_tax: 0.38,
      amount: 775.2,
      order_date: '2026-07-31',
      delivery_date: '2026-08-25',
      notes: 'BBD-40132354-01',
    })
    expect(result.payloads[2]).toMatchObject({
      product: 'IC', process: '邦定', process_category: '邦定', quantity: 2040, unit_price_cny_tax: 0.5, amount: 1020,
    })
  })

  it('imports electronics contracts without a product category and expands two-digit signing years', () => {
    const aoa = [
      ['东莞市登信电子有限公司'],
      ['', '', '', '委外加工合同'],
      [],
      ['供应商：', '邵阳市华登塑胶制品有限公司', '', '', '', '', '订单编号：', 'Dz 20260000022'],
      [], [], [], [],
      ['货 号', '货 品 名 称', '工序', '数量', '单位', '单 价', '金 额', '单重（G)', '重量（KG)', '货期', '备注'],
      ['7149绿', '焊线', '后焊', '10000', 'PCS', 0.098, 980, '', '', '', 'BBA2502462-01'],
      ['', '', '', '', '', '合计', 980],
      [],
      ['供应商确认：', '', '', '采购签核：胡爱莲'],
      ['时间： 26 年7月10日', '', '', '', '时间：      年    月     日'],
    ]

    const result = parseDeliveryImport(aoa, { '邵阳市华登塑胶制品有限公司': 'factory-electronics' })

    expect(result.failed).toBe(0)
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-electronics',
      pmc: '胡爱莲',
      item_no: '7149绿',
      order_no: 'Dz 20260000022',
      product: '焊线',
      process: '后焊',
      process_category: '后焊',
      quantity: 10000,
      unit_price_cny_tax: 0.098,
      amount: 980,
      order_date: '2026-07-10',
      notes: 'BBA2502462-01',
    })
  })
})
