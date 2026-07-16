// pb_migrations/1700000040_quality_buyer_readonly.js
// 品质数据(5S检查、检验明细)采购只读:create/update 要求 craft 为空(采购账号 craft 非空,被挡)。
// 删除仍仅 admin。
migrate((app) => {
  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const c = app.findCollectionByNameOrId(name)
    c.createRule = '@request.auth.id != "" && @request.auth.craft = ""'
    c.updateRule = '@request.auth.id != "" && @request.auth.craft = ""'
    app.save(c)
  }
}, (app) => {
  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const c = app.findCollectionByNameOrId(name)
    c.createRule = '@request.auth.id != ""'
    c.updateRule = '@request.auth.id != ""'
    app.save(c)
  }
})
