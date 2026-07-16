// pb_migrations/1700000024_add_order_delay.js
// 订单增加：是否延期(is_delayed)、延期天数(delay_days)、主要延期原因(delay_reason)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new BoolField({ name: 'is_delayed' }))
  c.fields.add(new NumberField({ name: 'delay_days' }))
  c.fields.add(new TextField({ name: 'delay_reason' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const n of ['is_delayed', 'delay_days', 'delay_reason']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
