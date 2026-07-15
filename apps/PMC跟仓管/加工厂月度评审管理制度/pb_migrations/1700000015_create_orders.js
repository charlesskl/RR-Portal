// pb_migrations/1700000015_create_orders.js
// 下单明细：给加工厂下的订单。沿用部门隔离（采购只见本部门工厂的订单）。
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'orders',
    // 部门隔离：非采购(craft 空)看全部，采购只看本部门工厂的订单
    listRule: '@request.auth.id != "" && (@request.auth.craft = "" || factory.craft = @request.auth.craft)',
    viewRule: '@request.auth.id != "" && (@request.auth.craft = "" || factory.craft = @request.auth.craft)',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: factoriesId }))
  c.fields.add(new TextField({ name: 'product', required: true }))
  c.fields.add(new NumberField({ name: 'quantity' })) // 不设 required，避免 0 陷阱
  c.fields.add(new DateField({ name: 'order_date' }))
  c.fields.add(new DateField({ name: 'delivery_date' }))
  c.fields.add(new SelectField({ name: 'status', maxSelect: 1, values: ['placed', 'producing', 'delivered'] }))
  c.fields.add(new TextField({ name: 'notes' }))
  c.fields.add(new RelationField({ name: 'created_by', maxSelect: 1, collectionId: usersId }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('orders'))
})
