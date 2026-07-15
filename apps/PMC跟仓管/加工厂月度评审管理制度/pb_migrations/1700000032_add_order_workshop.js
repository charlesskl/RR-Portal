// pb_migrations/1700000032_add_order_workshop.js
// 下单明细新增「车间」字段（该订单所在车间，文本）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new TextField({ name: 'workshop' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'workshop')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
