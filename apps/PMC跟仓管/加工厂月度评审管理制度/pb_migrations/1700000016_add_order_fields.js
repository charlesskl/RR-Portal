// pb_migrations/1700000016_add_order_fields.js
// 订单增加：工序(process)、货号(item_no)、单价(unit_price)、金额(amount)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new TextField({ name: 'process' }))
  c.fields.add(new TextField({ name: 'item_no' }))
  c.fields.add(new NumberField({ name: 'unit_price' }))
  c.fields.add(new NumberField({ name: 'amount' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const n of ['process', 'item_no', 'unit_price', 'amount']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
