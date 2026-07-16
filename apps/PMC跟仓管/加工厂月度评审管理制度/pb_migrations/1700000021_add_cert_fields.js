// pb_migrations/1700000021_add_cert_fields.js
// 「资质有效期」拆为环评/消防/安监三项资质有效期。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new DateField({ name: 'env_cert_expiry' }))     // 环评资质有效期
  c.fields.add(new DateField({ name: 'fire_cert_expiry' }))    // 消防资质有效期
  c.fields.add(new DateField({ name: 'safety_cert_expiry' }))  // 安监资质有效期
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  for (const n of ['env_cert_expiry', 'fire_cert_expiry', 'safety_cert_expiry']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
