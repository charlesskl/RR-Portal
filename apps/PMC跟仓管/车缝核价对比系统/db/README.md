# 数据库部署

数据库结构由手写 SQL 维护，EF Core 只做映射，不执行 Migration。

## 全新环境

在 `db` 目录执行：

```powershell
sqlcmd -S "(localdb)\MSSQLLocalDB" -i rebuild_current.sql
```

`rebuild_current.sql` 会重建数据库并依次应用全部增量脚本，现有数据会被清空。

## 已有环境升级

在 `db` 目录执行：

```powershell
sqlcmd -S "(localdb)\MSSQLLocalDB" -d StitchCostPro -i apply_current.sql
```

升级入口保留现有数据。执行前仍建议备份数据库。

## 约定

- 新增结构变更时，创建带日期的幂等增量脚本。
- 同时把增量脚本追加到 `rebuild_current.sql` 和 `apply_current.sql`。
- 新机器或上线前，必须用临时数据库完整执行一次 `rebuild_current.sql` 并运行后端测试。
