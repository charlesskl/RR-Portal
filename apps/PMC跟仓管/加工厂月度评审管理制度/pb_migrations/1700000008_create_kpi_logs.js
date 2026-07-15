// pb_migrations/1700000008_create_kpi_logs.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const c = new Collection({
    type: 'base',
    name: 'kpi_logs',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new RelationField({ name: 'user', required: true, maxSelect: 1, collectionId: usersId }))
  c.fields.add(new SelectField({ name: 'action_type', required: true, maxSelect: 1,
    values: ['output_entered', 'output_reviewed', 'score_submitted', 'summary_done', 'correction_closed'] }))
  c.fields.add(new TextField({ name: 'target_month', required: true }))
  c.fields.add(new DateField({ name: 'deadline' }))
  c.fields.add(new DateField({ name: 'completed_at' }))
  c.fields.add(new BoolField({ name: 'is_on_time' }))
  c.fields.add(new TextField({ name: 'notes' }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('kpi_logs'))
})
