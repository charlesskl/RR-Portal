// pb_migrations/1700000004_create_incidents.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'incidents',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: factoriesId }))
  c.fields.add(new DateField({ name: 'incident_date', required: true }))
  c.fields.add(new SelectField({ name: 'incident_type', required: true, maxSelect: 1,
    values: ['batch_defect', 'env_violation', 'shutdown', 'other'] }))
  c.fields.add(new EditorField({ name: 'description' }))
  c.fields.add(new FileField({ name: 'photos', maxSelect: 20, maxSize: 10485760 }))
  c.fields.add(new FileField({ name: 'docs', maxSelect: 20, maxSize: 10485760 }))
  c.fields.add(new RelationField({ name: 'entered_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new RelationField({ name: 'reviewed_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new SelectField({ name: 'status', required: true, maxSelect: 1, values: ['open', 'closed'] }))
  c.fields.add(new DateField({ name: 'close_date' }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('incidents'))
})
