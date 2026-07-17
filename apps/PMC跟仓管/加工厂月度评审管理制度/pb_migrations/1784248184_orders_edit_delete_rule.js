migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders')
  orders.createRule = '@request.auth.id != ""'
  orders.updateRule = '@request.auth.id != ""'
  orders.deleteRule = '@request.auth.id != ""'
  app.save(orders)
}, (app) => {
  const orders = app.findCollectionByNameOrId('orders')
  orders.createRule = '@request.auth.id != "" && @request.auth.role != "quality_qc"'
  orders.updateRule = '@request.auth.id != "" && @request.auth.role != "quality_qc"'
  orders.deleteRule = '@request.auth.role = "admin"'
  app.save(orders)
})
