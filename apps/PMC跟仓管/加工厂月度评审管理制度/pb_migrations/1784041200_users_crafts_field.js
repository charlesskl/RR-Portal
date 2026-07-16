// 用户可选择多个部门。空数组表示不限制部门；旧 craft 字段保留用于兼容旧版本。
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  if (!users.fields.find((field) => field.name === 'crafts')) {
    users.fields.add(new SelectField({
      name: 'crafts',
      required: false,
      maxSelect: 4,
      values: ['injection', 'painting', 'assembly', 'sewing'],
    }))
    app.save(users)
  }

  const records = app.findAllRecords('users')
  for (const record of records) {
    const craft = record.getString('craft')
    const crafts = record.get('crafts')
    if (craft && (!Array.isArray(crafts) || !crafts.length)) {
      record.set('crafts', [craft])
      app.save(record)
    }
  }
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  const field = users.fields.find((item) => item.name === 'crafts')
  if (field) users.fields.removeById(field.id)
  app.save(users)
})
