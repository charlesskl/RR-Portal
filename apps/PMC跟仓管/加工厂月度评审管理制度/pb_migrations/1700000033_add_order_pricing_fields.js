// pb_migrations/1700000033_add_order_pricing_fields.js
// 产品单价统计表所需:orders 新增「供应商外发价」「加工类别」。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.fields.add(new NumberField({ name: 'supplier_price' }))   // 供应商外发价￥
  c.fields.add(new TextField({ name: 'process_category' }))   // 加工类别
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  for (const name of ['supplier_price', 'process_category']) {
    const f = c.fields.find((x) => x.name === name)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
