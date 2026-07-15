// pb_migrations/1700000019_add_order_defect_rate.js
// 订单增加「次品率」(defect_rate, 百分比数值)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'defect_rate' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'defect_rate')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
