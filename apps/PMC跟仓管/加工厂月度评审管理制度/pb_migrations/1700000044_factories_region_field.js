// pb_migrations/1700000044_factories_region_field.js
// 给 factories 增加 region(厂区) 字段：东莞/湖南/河源。
// 旧数据不写库，前端按「无 region = 东莞」处理。幂等：已存在则跳过。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  if (!c.fields.find((x) => x.name === 'region')) {
    c.fields.add(new SelectField({
      name: 'region',
      required: false,
      maxSelect: 1,
      values: ['dongguan', 'hunan', 'heyuan'],
    }))
    app.save(c)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'region')
  if (f) { c.fields.removeById(f.id); app.save(c) }
})
