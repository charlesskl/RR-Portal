migrate((app) => {
  const collection = app.findCollectionByNameOrId('orders')
  collection.fields.add(new TextField({ name: 'mold_no' }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('orders')
  const field = collection.fields.find((item) => item.name === 'mold_no')
  if (field) collection.fields.removeById(field.id)
  app.save(collection)
})
