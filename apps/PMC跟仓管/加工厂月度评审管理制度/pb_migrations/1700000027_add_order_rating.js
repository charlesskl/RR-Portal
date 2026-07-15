// pb_migrations/1700000027_add_order_rating.js
// 订单增加「经理评分(1-10)」用于综合评价。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'manager_rating' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'manager_rating')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
