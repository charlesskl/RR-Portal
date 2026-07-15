// pb_migrations/1700000001_create_users_fields.js
// 给内置 users 集合增加 role / craft / display_name 字段
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')

  users.fields.add(new SelectField({
    name: 'role',
    required: true,
    maxSelect: 1,
    values: [
      'admin', 'sc_manager',
      'buyer_injection', 'buyer_painting', 'buyer_assembly', 'buyer_sewing',
      'finance_cost', 'finance_mgr', 'quality_qc', 'sc_clerk',
    ],
  }))

  users.fields.add(new SelectField({
    name: 'craft',
    required: false,
    maxSelect: 1,
    values: ['injection', 'painting', 'assembly', 'sewing'],
  }))

  users.fields.add(new TextField({
    name: 'display_name',
    required: false,
  }))

  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  for (const fieldName of ['role', 'craft', 'display_name']) {
    const f = users.fields.find((x) => x.name === fieldName)
    if (f) users.fields.removeById(f.id)
  }
  app.save(users)
})
