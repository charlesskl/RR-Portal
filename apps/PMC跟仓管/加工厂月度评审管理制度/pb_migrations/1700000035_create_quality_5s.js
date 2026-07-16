// pb_migrations/1700000035_create_quality_5s.js
// 加工厂现场品质及5S检查记录登记表。
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = new Collection({
    type: 'base',
    name: 'quality_5s_checks',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new DateField({ name: 'check_date' }))
  c.fields.add(new RelationField({ name: 'factory', maxSelect: 1, collectionId: factoriesId }))
  c.fields.add(new TextField({ name: 'check_type' }))     // 检查类型
  c.fields.add(new TextField({ name: 'project' }))        // 加工项目
  c.fields.add(new TextField({ name: 'customer' }))       // 客户
  c.fields.add(new TextField({ name: 'inspector' }))      // 检查人员
  // 8 个评分项
  c.fields.add(new NumberField({ name: 's_area' }))        // 现场区域规划
  c.fields.add(new NumberField({ name: 's_material' }))    // 物料摆放及标识
  c.fields.add(new NumberField({ name: 's_hygiene' }))     // 卫生整洁及异物防护
  c.fields.add(new NumberField({ name: 's_sharp' }))       // 利器及断针管理
  c.fields.add(new NumberField({ name: 's_nonconform' }))  // 不合格品隔离及追溯
  c.fields.add(new NumberField({ name: 's_standard' }))    // 检验标准及样板管理
  c.fields.add(new NumberField({ name: 's_qc_staff' }))    // 质检人员配置及过程品质控制
  c.fields.add(new NumberField({ name: 's_correction' }))  // 整改及记录管理
  c.fields.add(new TextField({ name: 'ip_control' }))      // IP控制(如适用)
  c.fields.add(new TextField({ name: 'notes' }))
  c.fields.add(new RelationField({ name: 'created_by', maxSelect: 1, collectionId: usersId }))
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('quality_5s_checks'))
})
