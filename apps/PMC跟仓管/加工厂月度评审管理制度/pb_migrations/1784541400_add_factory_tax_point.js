// 车缝部加工厂税点：按比例存储，例如 3% = 0.03。
migrate((app) => {
  const collection = app.findCollectionByNameOrId('factories')
  if (!collection.fields.find((field) => field.name === 'tax_point')) {
    collection.fields.add(new NumberField({ name: 'tax_point', min: 0, max: 1 }))
    app.save(collection)
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('factories')
  const field = collection.fields.find((item) => item.name === 'tax_point')
  if (field) collection.fields.removeById(field.id)
  app.save(collection)
})
