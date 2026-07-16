// pb_migrations/1700000041_buyer_no_dept_isolation.js
// 采购不分部门:去掉 factories/orders/monthly_scores/monthly_output/incidents 的 craft 部门隔离,
// 所有登录用户都能看全部门。同时把「品质数据采购只读」的判定从 craft 改为按角色(更稳)。
const NON_BUYER = '@request.auth.id != "" && @request.auth.role != "buyer_injection" && @request.auth.role != "buyer_painting" && @request.auth.role != "buyer_assembly" && @request.auth.role != "buyer_sewing"'
const ISOLATED = ['factories', 'monthly_output', 'incidents', 'monthly_scores', 'orders']

migrate((app) => {
  // 1) 去掉部门隔离
  for (const name of ISOLATED) {
    const c = app.findCollectionByNameOrId(name)
    c.listRule = '@request.auth.id != ""'
    c.viewRule = '@request.auth.id != ""'
    app.save(c)
  }
  // 2) 品质数据:采购(buyer_*)不能新增/修改
  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const c = app.findCollectionByNameOrId(name)
    c.createRule = NON_BUYER
    c.updateRule = NON_BUYER
    app.save(c)
  }
}, (app) => {
  for (const name of ISOLATED) {
    const c = app.findCollectionByNameOrId(name)
    const prefix = name === 'factories' ? 'craft' : 'factory.craft'
    c.listRule = `@request.auth.id != "" && (@request.auth.craft = "" || ${prefix} = @request.auth.craft)`
    c.viewRule = `@request.auth.id != "" && (@request.auth.craft = "" || ${prefix} = @request.auth.craft)`
    app.save(c)
  }
  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const c = app.findCollectionByNameOrId(name)
    c.createRule = '@request.auth.id != "" && @request.auth.craft = ""'
    c.updateRule = '@request.auth.id != "" && @request.auth.craft = ""'
    app.save(c)
  }
})
