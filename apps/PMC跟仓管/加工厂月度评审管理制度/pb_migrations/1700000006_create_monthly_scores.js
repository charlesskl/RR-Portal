// pb_migrations/1700000006_create_monthly_scores.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'monthly_scores',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: factoriesId }))
  c.fields.add(new TextField({ name: 'year_month', required: true }))
  // [{ template_id, score, notes }]
  c.fields.add(new JSONField({ name: 'score_items', maxSize: 200000 }))
  c.fields.add(new NumberField({ name: 'total_score' }))
  c.fields.add(new SelectField({ name: 'grade', maxSelect: 1, values: ['A', 'B', 'C', 'D'] }))
  c.fields.add(new SelectField({ name: 'flag', maxSelect: 1, values: ['none', 'yellow', 'red'] }))
  c.fields.add(new EditorField({ name: 'flag_reason' }))
  c.fields.add(new RelationField({ name: 'flag_issued_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new RelationField({ name: 'flag_approved_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new EditorField({ name: 'correction_plan' }))
  c.fields.add(new DateField({ name: 'correction_due' }))
  c.fields.add(new BoolField({ name: 'correction_closed' }))
  c.fields.add(new SelectField({ name: 'status', required: true, maxSelect: 1,
    values: ['draft', 'submitted', 'approved'] }))
  c.fields.add(new RelationField({ name: 'submitted_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new RelationField({ name: 'approved_by', maxSelect: 1, collectionId: usersId }))
  c.indexes = ['CREATE UNIQUE INDEX idx_score_factory_month ON monthly_scores (factory, year_month)']
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('monthly_scores'))
})
