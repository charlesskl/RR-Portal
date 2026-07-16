// pb_migrations/1700000017_order_status_options.js
// 订单状态增加「已取消」，并让前端可直接下拉切换状态。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'status')
  if (f) f.values = ['placed', 'producing', 'delivered', 'cancelled']
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'status')
  if (f) f.values = ['placed', 'producing', 'delivered']
  app.save(c)
})
