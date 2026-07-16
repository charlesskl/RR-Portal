// pb_migrations/1700000003_create_monthly_output.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'monthly_output',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: factoriesId }))
  c.fields.add(new TextField({ name: 'year_month', required: true })) // "2026-05"
  // 金额不设 required，避免 0 陷阱；缺省由前端校验
  c.fields.add(new NumberField({ name: 'monthly_amount' }))
  c.fields.add(new NumberField({ name: 'ytd_amount' }))
  c.fields.add(new TextField({ name: 'source_doc' }))
  c.fields.add(new RelationField({ name: 'entered_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new RelationField({ name: 'reviewed_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new DateField({ name: 'entered_at' }))
  c.fields.add(new DateField({ name: 'reviewed_at' }))
  c.indexes = ['CREATE UNIQUE INDEX idx_output_factory_month ON monthly_output (factory, year_month)']
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('monthly_output'))
})
