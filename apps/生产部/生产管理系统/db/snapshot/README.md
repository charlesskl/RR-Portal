# 数据快照（全量，幂等）

- `full_data_snapshot.sql.gz`：当前 erp 库全部 226 张表、88,710 行数据的快照（2026-09-29 重新生成），压缩前约 186MB。
- 内容：基础主档（部门/人事/供应商/物料/客户等）+ 全部业务单据，一次导出。
- 演示种子数据（60_demo_virtual_data.sql 的 DEMO% 单）已从 dev 库清理，快照中不含；仅存的 `DEMO` 字样为真实业务数据（ZURU 排期品名 "WITH DEMO"、模具编号 DEMO-06M-01、操作审计历史等）。

## 恢复用法

```bash
# 1. 解压
gunzip -k db/snapshot/full_data_snapshot.sql.gz
# 2. 目标库已建好表结构（先跑 db/ 下的建表与迁移脚本，再恢复数据）
sqlcmd -S <host> -U <user> -P <password> -d erp -i full_data_snapshot.sql
```

- 脚本幂等：先禁用全部外键 → 清空所有表 → 重插全部数据（含 IDENTITY_INSERT）→ 恢复外键，可重复执行。

## 重新生成快照

```bash
export ERP_DB='Server=主机,1433;Database=erp;User Id=账号;Password=密码;TrustServerCertificate=True'
dotnet run --project tools/DbExport        # 生成 db/snapshot/full_data_snapshot.sql
```
