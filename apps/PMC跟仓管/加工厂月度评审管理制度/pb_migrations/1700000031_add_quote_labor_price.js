// pb_migrations/1700000031_add_quote_labor_price.js
// 下单明细新增「核价生产工价」字段（核定的生产工价，数值）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'quote_labor_price' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'quote_labor_price')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
