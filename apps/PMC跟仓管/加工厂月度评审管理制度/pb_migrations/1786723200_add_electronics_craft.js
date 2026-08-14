// 为东莞、湖南厂区增加电子部。厂区范围由前端卡片控制，craft 选项供工厂数据落库。
migrate((app) => {
  const factories = app.findCollectionByNameOrId('factories')
  const factoryCraft = factories.fields.find((field) => field.name === 'craft')
  if (factoryCraft && !factoryCraft.values.includes('electronics')) {
    factoryCraft.values.push('electronics')
    app.save(factories)
  }

  const users = app.findCollectionByNameOrId('users')
  for (const name of ['craft', 'crafts']) {
    const field = users.fields.find((item) => item.name === name)
    if (field && !field.values.includes('electronics')) field.values.push('electronics')
    if (name === 'crafts' && field) field.maxSelect = 5
  }
  app.save(users)

  const templates = app.findCollectionByNameOrId('score_templates')
  const templateCraft = templates.fields.find((field) => field.name === 'craft_filter')
  if (templateCraft && !templateCraft.values.includes('electronics')) {
    templateCraft.values.push('electronics')
    app.save(templates)
  }
}, (app) => {
  for (const [collectionName, fieldNames] of [
    ['factories', ['craft']],
    ['users', ['craft', 'crafts']],
    ['score_templates', ['craft_filter']],
  ]) {
    const collection = app.findCollectionByNameOrId(collectionName)
    for (const name of fieldNames) {
      const field = collection.fields.find((item) => item.name === name)
      if (field) field.values = field.values.filter((value) => value !== 'electronics')
      if (name === 'crafts' && field) field.maxSelect = 4
    }
    app.save(collection)
  }
})
