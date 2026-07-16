// pb_migrations/1700000002_create_factories.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const c = new Collection({
    type: 'base',
    name: 'factories',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new TextField({ name: 'name', required: true }))
  c.fields.add(new SelectField({ name: 'craft', required: true, maxSelect: 1,
    values: ['injection', 'painting', 'assembly', 'sewing'] }))
  c.fields.add(new TextField({ name: 'contact_person' }))
  c.fields.add(new TextField({ name: 'contact_phone' }))
  c.fields.add(new TextField({ name: 'address' }))
  c.fields.add(new NumberField({ name: 'workshop_area' }))
  c.fields.add(new JSONField({ name: 'equipment_list', maxSize: 200000 }))
  c.fields.add(new FileField({ name: 'qualification_files', maxSelect: 20, maxSize: 10485760 }))
  c.fields.add(new DateField({ name: 'qualification_expiry' }))
  c.fields.add(new SelectField({ name: 'status', required: true, maxSelect: 1,
    values: ['active', 'limited', 'suspended', 'eliminated'] }))
  c.fields.add(new SelectField({ name: 'status_pending', maxSelect: 1,
    values: ['active', 'limited', 'suspended', 'eliminated'] }))
  c.fields.add(new RelationField({ name: 'status_updated_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new DateField({ name: 'status_updated_at' }))
  c.fields.add(new RelationField({ name: 'created_by', maxSelect: 1, collectionId: usersId }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('factories'))
})
