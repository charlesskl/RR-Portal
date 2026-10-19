// 巡查现场：按检查日期和加工厂保存独立巡查记录。
migrate((app) => {
  const view = '@request.auth.id != ""'
  const edit = '@request.auth.id != "" && @request.auth.quality_edit = true'
  const c = new Collection({ name: 'quality_patrols', type: 'base', listRule: view, viewRule: view, createRule: edit, updateRule: edit, deleteRule: edit })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('factories').id }))
  c.fields.add(new DateField({ name: 'check_date', required: true }))
  for (const name of ['previous_date', 'planned_date', 'completed_date']) c.fields.add(new DateField({ name }))
  // JSON preserves blank versus a real zero in optional numeric fields.
  for (const name of ['staff', 'lines', 'area']) c.fields.add(new JSONField({ name }))
  for (const name of ['previous_grade', 'grade']) c.fields.add(new SelectField({ name, maxSelect: 1, values: ['A', 'B', 'C', 'D'] }))
  for (const name of ['previous_evaluation', 'previous_correction', 'previous_type', 'evaluation', 'correction', 'production_type', 'notes']) c.fields.add(new TextField({ name, max: 10000 }))
  for (const name of ['visitor_ready', 'below_standard']) c.fields.add(new BoolField({ name }))
  c.fields.add(new FileField({ name: 'photos', maxSelect: 10, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] }))
  c.indexes = ['CREATE UNIQUE INDEX idx_quality_patrol_factory_date ON quality_patrols (factory, check_date)']
  app.save(c)
}, (app) => { app.delete(app.findCollectionByNameOrId('quality_patrols')) })
