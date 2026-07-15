// pb_migrations/1700000028_add_cooperative_workshops.js
// 新增「合作车间」字段（工厂下设/合作的车间，文本描述）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new TextField({ name: 'cooperative_workshops' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'cooperative_workshops')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
