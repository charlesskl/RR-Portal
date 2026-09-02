// 对车缝核价对比系统只读集成 API 所需字段：
// - orders: unit / price_effective_at / tax_point / is_deleted / deleted_at，status 追加 voided
// - factories: is_deleted / deleted_at
// - orders 和 factories 创建时未带 autodate 字段，补齐 created / updated（接口的增量游标依赖 updated）
// 幂等：字段或选项已存在则跳过；不改动任何现有字段和数据。
// 注意 orders.tax_point 是 1.13 这类税点系数，与 factories.tax_point（0~1 税率）语义不同，不加 min/max。
migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders')

  if (!orders.fields.find((field) => field.name === 'created')) {
    orders.fields.add(new AutodateField({ name: 'created', onCreate: true, onUpdate: false }))
  }
  if (!orders.fields.find((field) => field.name === 'updated')) {
    orders.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }))
  }
  if (!orders.fields.find((field) => field.name === 'unit')) {
    orders.fields.add(new TextField({ name: 'unit', required: false }))
  }
  if (!orders.fields.find((field) => field.name === 'price_effective_at')) {
    orders.fields.add(new DateField({ name: 'price_effective_at', required: false }))
  }
  if (!orders.fields.find((field) => field.name === 'tax_point')) {
    orders.fields.add(new NumberField({ name: 'tax_point', required: false }))
  }
  if (!orders.fields.find((field) => field.name === 'is_deleted')) {
    orders.fields.add(new BoolField({ name: 'is_deleted', required: false }))
  }
  if (!orders.fields.find((field) => field.name === 'deleted_at')) {
    orders.fields.add(new DateField({ name: 'deleted_at', required: false }))
  }

  const statusField = orders.fields.find((field) => field.name === 'status')
  if (statusField && statusField.values.indexOf('voided') === -1) {
    statusField.values.push('voided')
  }

  app.save(orders)

  const factories = app.findCollectionByNameOrId('factories')

  if (!factories.fields.find((field) => field.name === 'created')) {
    factories.fields.add(new AutodateField({ name: 'created', onCreate: true, onUpdate: false }))
  }
  if (!factories.fields.find((field) => field.name === 'updated')) {
    factories.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }))
  }
  for (const name of ['is_deleted', 'deleted_at']) {
    if (!factories.fields.find((field) => field.name === name)) {
      if (name === 'is_deleted') {
        factories.fields.add(new BoolField({ name: 'is_deleted', required: false }))
      } else {
        factories.fields.add(new DateField({ name: 'deleted_at', required: false }))
      }
    }
  }

  app.save(factories)

  // 存量行回填 created/updated：新增 autodate 字段后存量行值为空，
  // 而接口增量游标依赖 updated，故统一回填为迁移执行时间（幂等，只动空值）。
  const now = new Date().toISOString().replace('T', ' ')
  for (const table of ['orders', 'factories']) {
    app.db().newQuery('UPDATE ' + table + " SET created = {:now} WHERE created IS NULL OR created = ''").bind({ now: now }).execute()
    app.db().newQuery('UPDATE ' + table + " SET updated = {:now} WHERE updated IS NULL OR updated = ''").bind({ now: now }).execute()
  }
}, (app) => {
  const removeField = (collectionName, fieldName) => {
    const collection = app.findCollectionByNameOrId(collectionName)
    const field = collection.fields.find((item) => item.name === fieldName)
    if (field) {
      collection.fields.removeById(field.id)
      app.save(collection)
    }
  }

  const orders = app.findCollectionByNameOrId('orders')
  const statusField = orders.fields.find((field) => field.name === 'status')
  if (statusField) {
    statusField.values = statusField.values.filter((value) => value !== 'voided')
    app.save(orders)
  }

  for (const name of ['created', 'updated', 'unit', 'price_effective_at', 'tax_point', 'is_deleted', 'deleted_at']) {
    removeField('orders', name)
  }
  for (const name of ['created', 'updated', 'is_deleted', 'deleted_at']) {
    removeField('factories', name)
  }
})
