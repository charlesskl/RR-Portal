// pb_migrations/1700000038_create_quality_inspections.js
// 加工厂品质检验明细。
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'quality_inspections',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new DateField({ name: 'inspect_date' }))            // 送货日期
  c.fields.add(new RelationField({ name: 'factory', maxSelect: 1, collectionId: factoriesId })) // 加工厂名称
  c.fields.add(new TextField({ name: 'process_type' }))           // 加工类型
  c.fields.add(new TextField({ name: 'customer' }))               // 客户
  c.fields.add(new TextField({ name: 'delivery_no' }))            // 送货单号
  c.fields.add(new TextField({ name: 'item_no' }))               // 货号
  c.fields.add(new TextField({ name: 'product' }))               // 产品名称
  c.fields.add(new NumberField({ name: 'quantity' }))            // 数量
  c.fields.add(new TextField({ name: 'internal_result' }))       // 内部-检验结果
  c.fields.add(new TextField({ name: 'internal_defect' }))       // 内部-不良描述
  c.fields.add(new TextField({ name: 'internal_inspector' }))    // 内部-检验人员
  c.fields.add(new TextField({ name: 'cust_inspect_date' }))     // 客户-检验日期
  c.fields.add(new TextField({ name: 'cust_result' }))           // 客户-检验结果
  c.fields.add(new TextField({ name: 'cust_defect' }))           // 客户-不良描述
  c.fields.add(new TextField({ name: 'notes' }))
  c.fields.add(new RelationField({ name: 'created_by', maxSelect: 1, collectionId: usersId }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('quality_inspections'))
})
