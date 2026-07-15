// pb_migrations/1700000034_add_site_mgmt_rate.js
// 汇总表「现场管理达标率」:工厂新增数值字段 site_mgmt_rate（百分比，手填）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new NumberField({ name: 'site_mgmt_rate' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'site_mgmt_rate')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
