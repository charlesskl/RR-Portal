# 外发数据种子（2026-07-22 最新表）

来源：《2026年啤机外发模具表.2026-7-22最新更新.xlsx》

内容（只替换四张外发表，不影响排产等其它数据）：

- outsource_orders：1,387 条外发订单
- outsource_suppliers：11 家加工厂
- outsource_pc_orders：4 条 PC 料计划
- outsource_mold_mappings：249 条模具→供应商映射

用法（服务器上执行，无需重启服务）：

```bash
# 1. 备份
cp /app/data/paiji.db /app/data/paiji.db.bak

# 2. 导入（Docker 部署先 docker cp 进容器）
sqlite3 /app/data/paiji.db < outsource-2026-07-22.sql

# 3. 验证，应返回 1387
sqlite3 /app/data/paiji.db "SELECT COUNT(*) FROM outsource_orders;"
```
