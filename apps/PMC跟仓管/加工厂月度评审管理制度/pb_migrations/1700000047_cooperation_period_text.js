// pb_migrations/1700000047_cooperation_period_text.js
// 「合作年限」改为自由文本（可填“4年”/“3个月”等），替换原数字字段 cooperation_years。
// 同时把已录入的 58 家按纸质表原始写法（年/个月）重新写回 cooperation_period。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  // 移除旧的数字字段
  const old = c.fields.find((x) => x.name === 'cooperation_years')
  if (old) c.fields.removeById(old.id)
  // 新增文本字段
  if (!c.fields.find((x) => x.name === 'cooperation_period')) {
    c.fields.add(new TextField({ name: 'cooperation_period', required: false, max: 30 }))
  }
  app.save(c)

  const data = {
    // 注塑/啤机部
    '东莞市华盛源塑料制品有限公司': '10年',
    '东莞市合成电子塑胶有限公司': '3个月',
    '东莞市壹嘉亿塑胶有限公司': '2年',
    '东莞市恒致博模具有限公司': '2年',
    '东莞市旭凯塑胶电子科技有限公司': '4年',
    '东莞市清溪俊豪塑胶厂': '4年',
    '东莞市清溪意鑫隆塑胶厂': '2个月',
    '东莞市清溪鸿深电子厂': '2年',
    '东莞市稳当五金塑胶制品有限公司': '2年',
    '东莞欢享智能科技有限公司': '2个月',
    '东莞鸿徽塑胶制品有限公司': '4年',
    // 喷油部
    '益正': '12年',
    '伟畅': '3个月',
    // 装配部
    '东莞市(锋利宏塑胶加工厂)': '6年',
    '东莞市润展塑料制品有限公司': '17年',
    '东莞市清溪佳泰塑胶加工厂': '3个月',
    '东莞市清溪利鸿塑胶加工厂': '2个月',
    '东莞市清溪千宁五金塑胶加工厂': '3年',
    '东莞市清溪鸿亚塑胶加工厂': '7年',
    '鸿运五金塑胶制品厂': '2个月',
    // 车缝
    '益沣': '13.5年', '焮群荣': '8年', '标誉兴': '8年', '创兴': '0.8年', '大竹东俊': '0.2年',
    '同创': '0.1年', '利鑫': '0.1年', '娅琪': '0.8年', '卓明': '1.5年', '耀琼': '11年',
    '搏乐': '0.6年', '康琳': '1年', '诚贸': '6.5年', '红魏': '0.2年', '舜崇': '0.2年',
    '佳乐': '0.2年', '快一面': '13.5年', '华珍': '5.5年', '运枫': '3年', '欣潮': '1年',
    '运昇': '1年', '友红': '0.8年', '华姐': '0.3年', '启源': '0.6年', '超越': '0.1年',
    '强达': '12.5年', '远邦': '8.5年', '耀胜': '5.5年', '开源': '0.5年', '耀波': '3.5年',
    '鸿源': '0.3年', '丽姐玩具': '0.2年', '东安年达': '0.1年', '康乐': '7.5年', '鑫豪': '4年',
    '汤婉婉': '0.1年', '财旺': '0.1年', '利恒': '0.1年',
  }
  for (const name in data) {
    try {
      const rec = app.findFirstRecordByFilter('factories', 'name = {:n}', { n: name })
      rec.set('cooperation_period', data[name])
      app.save(rec)
    } catch (e) { /* 找不到则跳过 */ }
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'cooperation_period')
  if (f) c.fields.removeById(f.id)
  if (!c.fields.find((x) => x.name === 'cooperation_years')) {
    c.fields.add(new NumberField({ name: 'cooperation_years', required: false, min: 0 }))
  }
  app.save(c)
})
