// pb_migrations/1700000045_factories_cooperation_years.js
// 给 factories 增加「同我们工厂合作年限」字段（数字，单位：年）。幂等：已存在则跳过。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  if (!c.fields.find((x) => x.name === 'cooperation_years')) {
    c.fields.add(new NumberField({ name: 'cooperation_years', required: false, min: 0 }))
    app.save(c)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'cooperation_years')
  if (f) { c.fields.removeById(f.id); app.save(c) }
})
