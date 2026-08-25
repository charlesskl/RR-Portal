// 2026-08-24 首批现场品质及 5S Excel 导入时，日期经 UTC 转换后统一少一天。
// 仅修正该文件中的 6 家工厂，不影响其他历史检查记录。
migrate((app) => {
  const corrections = {
    '邵阳市宏高玩具制造有限公司': ['2026-06-30', '2026-07-01'],
    '邵阳市轩淇塑胶制品有限责任公司': ['2026-07-01', '2026-07-02'],
    '邵阳县鑫睿玩具厂': ['2026-07-02', '2026-07-03'],
    '新宁县回龙寺镇瀛海玩具制造厂': ['2026-07-02', '2026-07-03'],
    '冷水江市宇强玩具制造厂': ['2026-07-02', '2026-07-03'],
    '邵阳快立充电子科技有限公司': ['2026-07-03', '2026-07-04'],
  }
  const records = app.findRecordsByFilter('quality_5s_checks', 'customer = "ZURU" || customer = "SKY"', '', 0, 0)
  for (const record of records) {
    let factoryName = ''
    try { factoryName = app.findRecordById('factories', record.getString('factory')).getString('name') } catch { continue }
    const correction = corrections[factoryName]
    if (!correction || !record.getString('check_date').startsWith(correction[0])) continue
    record.set('check_date', correction[1] + ' 00:00:00.000Z')
    app.save(record)
  }
}, (app) => {
  const corrections = {
    '邵阳市宏高玩具制造有限公司': ['2026-06-30', '2026-07-01'],
    '邵阳市轩淇塑胶制品有限责任公司': ['2026-07-01', '2026-07-02'],
    '邵阳县鑫睿玩具厂': ['2026-07-02', '2026-07-03'],
    '新宁县回龙寺镇瀛海玩具制造厂': ['2026-07-02', '2026-07-03'],
    '冷水江市宇强玩具制造厂': ['2026-07-02', '2026-07-03'],
    '邵阳快立充电子科技有限公司': ['2026-07-03', '2026-07-04'],
  }
  const records = app.findRecordsByFilter('quality_5s_checks', 'customer = "ZURU" || customer = "SKY"', '', 0, 0)
  for (const record of records) {
    let factoryName = ''
    try { factoryName = app.findRecordById('factories', record.getString('factory')).getString('name') } catch { continue }
    const correction = corrections[factoryName]
    if (!correction || !record.getString('check_date').startsWith(correction[1])) continue
    record.set('check_date', correction[0] + ' 00:00:00.000Z')
    app.save(record)
  }
})
