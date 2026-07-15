# 数据快照说明

- 文件：`business-data.json`
- 导出时间：见 JSON 根节点 `exportedAt`
- 数据来源：本地运行中的 `IndoShipping` 数据库
- 账户：仅包含用户名、显示名、角色和权限，不包含密码哈希
- 图片：包含业务图片的 Data URL，便于完整迁移

导入目标库前必须先执行 `db/rebuild_schema.sql` 并做好备份。该快照用于一次性迁移，不应在应用启动时重复导入。
