// pb_migrations/1700000026_add_order_progress.js
// 订单增加：当前在生产产品(current_product)、生产完成进度(progress, 百分比)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new TextField({ name: 'current_product' }))
  c.fields.add(new NumberField({ name: 'progress' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const n of ['current_product', 'progress']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
