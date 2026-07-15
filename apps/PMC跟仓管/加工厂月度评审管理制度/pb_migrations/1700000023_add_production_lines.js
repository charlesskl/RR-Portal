// pb_migrations/1700000023_add_production_lines.js
// 新增「帮我们生产的设备/生产线」字段。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new TextField({ name: 'production_lines' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'production_lines')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
