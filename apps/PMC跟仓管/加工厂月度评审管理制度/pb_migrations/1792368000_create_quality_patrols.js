// 巡查现场：按检查日期和加工厂保存独立巡查记录。
migrate((app) => {
  // Permissions use flat dotted JSON keys. A locked SQL view lets PocketBase
  // apply one row policy before pagination, including files and realtime, without
  // adding flags to existing users or changing other collections' permissions.
  const access = new Collection({
    name: 'quality_patrol_access', type: 'view',
    viewQuery: `SELECT (u.id || f.id) AS id, u.id AS user_id, f.id AS factory_id
      FROM users u CROSS JOIN factories f
      WHERE COALESCE(NULLIF(f.region, ''), 'dongguan') IN ('dongguan', 'hunan', 'heyuan')
        AND f.craft IN ('injection', 'painting', 'assembly', 'sewing', 'electronics')
        AND CASE
          WHEN u.permissions IS NULL OR json_type(u.permissions) = 'null' THEN 1
          WHEN json_type(u.permissions) != 'object' THEN 0
          WHEN json_type(u.permissions, '$."quality.view"') IS NULL THEN 1
          WHEN json_type(u.permissions, '$."quality.view"') = 'true' THEN 1
          ELSE 0 END = 1
        AND CASE
          WHEN u.permissions IS NULL OR json_type(u.permissions) = 'null' THEN 1
          WHEN json_type(u.permissions) != 'object' THEN 0
          WHEN json_type(u.permissions, '$."region.' || COALESCE(NULLIF(f.region, ''), 'dongguan') || '"') IS NULL THEN 1
          WHEN json_type(u.permissions, '$."region.' || COALESCE(NULLIF(f.region, ''), 'dongguan') || '"') = 'true' THEN 1
          ELSE 0 END = 1
        AND CASE
          WHEN json_type(u.crafts) = 'array' AND json_array_length(u.crafts) > 0 THEN
            NOT EXISTS (SELECT 1 FROM json_each(u.crafts) c
              WHERE c.type != 'text' OR c.value NOT IN ('injection', 'painting', 'assembly', 'sewing', 'electronics'))
            AND EXISTS (SELECT 1 FROM json_each(u.crafts) c WHERE c.value = f.craft)
          WHEN u.crafts IS NULL OR json_type(u.crafts) = 'null' OR (json_type(u.crafts) = 'array' AND json_array_length(u.crafts) = 0) THEN
            u.craft = '' OR u.craft = f.craft
          ELSE 0 END = 1`,
  })
  app.save(access)
  const view = '@request.auth.id != "" && @request.auth.collectionName = "users" && @collection.quality_patrol_access.user_id ?= @request.auth.id && @collection.quality_patrol_access.factory_id ?= factory'
  const edit = view + ' && @request.auth.quality_edit = true'
  const c = new Collection({ name: 'quality_patrols', type: 'base', listRule: view, viewRule: view, createRule: edit, updateRule: edit, deleteRule: edit })
  c.fields.add(new RelationField({ name: 'factory', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('factories').id }))
  c.fields.add(new DateField({ name: 'check_date', required: true }))
  for (const name of ['previous_date', 'planned_date', 'completed_date']) c.fields.add(new DateField({ name }))
  // JSON preserves blank versus a real zero in optional numeric fields.
  for (const name of ['staff', 'lines', 'area']) c.fields.add(new JSONField({ name }))
  for (const name of ['previous_grade', 'grade']) c.fields.add(new SelectField({ name, maxSelect: 1, values: ['A', 'B', 'C', 'D'] }))
  for (const name of ['previous_evaluation', 'previous_correction', 'previous_type', 'evaluation', 'correction', 'production_type', 'notes']) c.fields.add(new TextField({ name, max: 10000 }))
  for (const name of ['visitor_ready', 'below_standard']) c.fields.add(new BoolField({ name }))
  c.fields.add(new FileField({ name: 'photos', protected: true, maxSelect: 10, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] }))
  c.indexes = ['CREATE UNIQUE INDEX idx_quality_patrol_factory_date ON quality_patrols (factory, substr(check_date, 1, 10))']
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('quality_patrols'))
  app.delete(app.findCollectionByNameOrId('quality_patrol_access'))
})
