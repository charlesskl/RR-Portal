// pb_migrations/1700000037_add_delivery_fields.js
// 交货延期统计表所需:orders 新增 下单PMC、订单号、实际交货时间、客退货单数。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new TextField({ name: 'pmc' }))                   // 下单PMC
  c.fields.add(new TextField({ name: 'order_no' }))             // 订单号
  c.fields.add(new DateField({ name: 'actual_delivery_date' })) // 实际交货时间
  c.fields.add(new NumberField({ name: 'return_count' }))       // 客退货单数
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const name of ['pmc', 'order_no', 'actual_delivery_date', 'return_count']) {
    const f = c.fields.find((x) => x.name === name)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
