// pb_migrations/1700000018_order_status_returned.js
// 订单状态再增加「退货」。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'status')
  if (f) f.values = ['placed', 'producing', 'delivered', 'cancelled', 'returned']
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  const f = c.fields.find((x) => x.name === 'status')
  if (f) f.values = ['placed', 'producing', 'delivered', 'cancelled']
  app.save(c)
})
