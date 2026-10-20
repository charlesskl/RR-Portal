// Additive migration: existing visits, dates, permissions and photos are retained.
migrate(app => {
  const c = app.findCollectionByNameOrId('quality_patrols')
  for (const name of ['responsibility_scope', 'responsible_supervisor', 'processing_fee_period', 'completion_details']) {
    c.fields.add(new TextField({ name, max: 10000 }))
  }
  c.fields.add(new JSONField({ name: 'processing_fee', maxSize: 100 }))
  app.save(c)
}, app => {
  const c = app.findCollectionByNameOrId('quality_patrols')
  for (const name of ['responsibility_scope', 'responsible_supervisor', 'processing_fee_period', 'completion_details', 'processing_fee']) c.fields.removeByName(name)
  app.save(c)
})
