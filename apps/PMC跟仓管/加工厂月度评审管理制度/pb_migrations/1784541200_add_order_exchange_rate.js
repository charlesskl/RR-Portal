migrate((app) => {
  const collection = app.findCollectionByNameOrId('orders')
  collection.fields.add(new NumberField({ name: 'exchange_rate', min: 0.0001 }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('orders')
  const field = collection.fields.find((item) => item.name === 'exchange_rate')
  if (field) collection.fields.removeById(field.id)
  app.save(collection)
})
