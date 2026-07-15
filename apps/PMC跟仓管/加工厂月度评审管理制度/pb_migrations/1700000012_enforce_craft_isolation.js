// pb_migrations/1700000012_enforce_craft_isolation.js
// 服务端强制采购按工艺隔离：非采购(craft 为空，如经理/财务/品质/文员/管理员)看全部，
// 采购(craft 有值)只能 list/view 自己工艺的工厂及其关联的产值/评分/异常。
// 规则：@request.auth.craft = "" 为真则放行(看全部)，否则要求工艺匹配。
migrate((app) => {
  // factories：直接比 craft 字段
  const fac = app.findCollectionByNameOrId('factories')
  fac.listRule = '@request.auth.id != "" && (@request.auth.craft = "" || craft = @request.auth.craft)'
  fac.viewRule = '@request.auth.id != "" && (@request.auth.craft = "" || craft = @request.auth.craft)'
  app.save(fac)

  // 关联集合：经 factory.craft 传递比对
  for (const name of ['monthly_output', 'monthly_scores', 'incidents']) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = '@request.auth.id != "" && (@request.auth.craft = "" || factory.craft = @request.auth.craft)'
    c.viewRule = '@request.auth.id != "" && (@request.auth.craft = "" || factory.craft = @request.auth.craft)'
    app.save(c)
  }
}, (app) => {
  const back = '@request.auth.id != ""'
  for (const name of ['factories', 'monthly_output', 'monthly_scores', 'incidents']) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = back
    c.viewRule = back
    app.save(c)
  }
})
