migrate((app) => {
  const collection = app.findCollectionByNameOrId('orders')
  collection.fields.add(new NumberField({ name: 'unit_price_cny_tax' }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('orders')
  const field = collection.fields.find((item) => item.name === 'unit_price_cny_tax')
  if (field) collection.fields.removeById(field.id)
  app.save(collection)
})
