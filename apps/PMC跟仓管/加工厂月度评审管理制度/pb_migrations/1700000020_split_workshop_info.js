// pb_migrations/1700000020_split_workshop_info.js
// 把「厂房基本信息」拆成 5 个字段：人员/设备类型/设备数量/可加工类型/年生意额。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new NumberField({ name: 'staff_count' }))        // 人员（人数）
  c.fields.add(new TextField({ name: 'equipment_type' }))       // 设备类型
  c.fields.add(new NumberField({ name: 'equipment_qty' }))      // 设备数量
  c.fields.add(new TextField({ name: 'processable_types' }))    // 可加工类型
  c.fields.add(new NumberField({ name: 'annual_revenue' }))     // 年生意额
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  for (const n of ['staff_count', 'equipment_type', 'equipment_qty', 'processable_types', 'annual_revenue']) {
    const f = c.fields.find((x) => x.name === n)
    if (f) c.fields.removeById(f.id)
  }
  app.save(c)
})
