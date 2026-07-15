// pb_migrations/1700000005_create_score_templates.js
migrate((app) => {
  const c = new Collection({
    type: 'base',
    name: 'score_templates',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new TextField({ name: 'name', required: true }))
  c.fields.add(new SelectField({ name: 'module', required: true, maxSelect: 1,
    values: ['qualification', 'delivery', 'cooperation', 'defect_rate', 'process', '5s', 'craft_specific'] }))
  c.fields.add(new NumberField({ name: 'max_score', required: true }))
  c.fields.add(new SelectField({ name: 'scoring_role', required: true, maxSelect: 1,
    values: ['buyer', 'quality_qc'] }))
  c.fields.add(new SelectField({ name: 'craft_filter', maxSelect: 1,
    values: ['injection', 'painting', 'assembly', 'sewing'] })) // 空=通用
  c.fields.add(new BoolField({ name: 'is_active' }))
  c.fields.add(new NumberField({ name: 'sort_order' }))
  c.fields.add(new EditorField({ name: 'description' }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('score_templates'))
})
