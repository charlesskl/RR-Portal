// pb_migrations/1700000014_add_workshop_info.js
// 给 factories 增加 厂房基本信息(workshop_info) 与 厂房图片(workshop_photos)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new EditorField({ name: 'workshop_info' }))
  c.fields.add(new FileField({ name: 'workshop_photos', maxSelect: 20, maxSize: 10485760 }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  for (const n of ['workshop_info', 'workshop_photos']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
