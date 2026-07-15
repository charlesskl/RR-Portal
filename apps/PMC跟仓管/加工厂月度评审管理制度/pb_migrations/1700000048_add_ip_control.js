// pb_migrations/1700000048_add_ip_control.js
// 新增「IP管控」字段（工厂的 IP/知识产权管控情况，文本描述）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new TextField({ name: 'ip_control' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'ip_control')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
