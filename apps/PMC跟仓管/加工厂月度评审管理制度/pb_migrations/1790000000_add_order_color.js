// Optional text preserves full color names/codes, including multiline supplier values.
migrate((app) => {
  const collection = app.findCollectionByNameOrId('orders')
  collection.fields.add(new TextField({ name: 'color', max: 2000 }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('orders')
  collection.fields.removeByName('color')
  app.save(collection)
})
