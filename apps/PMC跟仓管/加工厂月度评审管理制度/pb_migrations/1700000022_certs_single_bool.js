// pb_migrations/1700000022_certs_single_bool.js
// 环评/消防/安监资质不拆分，改为单个「是/否」布尔字段 has_certs；移除上一版的三个日期字段。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  for (const n of ['env_cert_expiry', 'fire_cert_expiry', 'safety_cert_expiry']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  c.fields.add(new BoolField({ name: 'has_certs' })) // 环评/消防/安监资质 是/否
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'has_certs')
  if (f) c.fields.removeById(f.id)
  c.fields.add(new DateField({ name: 'env_cert_expiry' }))
  c.fields.add(new DateField({ name: 'fire_cert_expiry' }))
  c.fields.add(new DateField({ name: 'safety_cert_expiry' }))
  app.save(c)
})
