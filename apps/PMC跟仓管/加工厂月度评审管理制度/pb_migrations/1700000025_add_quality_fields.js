// pb_migrations/1700000025_add_quality_fields.js
// 品质管理：订单增加来料抽检单数/不良单数/是否已解决/外发品质巡查问题点。
// 合格率前端自动计算 =(抽检-不良)/抽检。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'inspect_count' }))   // 来料抽检单数
  c.fields.add(new NumberField({ name: 'defect_count' }))    // 不良单数
  c.fields.add(new BoolField({ name: 'is_resolved' }))       // 是否已解决
  c.fields.add(new TextField({ name: 'quality_issues' }))    // 外发/品质巡查问题点
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const n of ['inspect_count', 'defect_count', 'is_resolved', 'quality_issues']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
