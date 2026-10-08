# DEMO 虚拟数据 + 数据链路验证 使用说明

配套脚本：

- `db/60_demo_virtual_data.sql` — 虚拟演示数据（全部编号/单号带 `DEMO` 前缀，幂等可重跑）
- `db/61_demo_verify.sql` — 数据链路只读断言（23 项检查，逐项 PASS/FAIL + 总计）

覆盖 2026-07-28 交付的"数据互通"链路：物料类别树、工模表（编号大写/啤机机型字典）、
塑胶共用物料表（四量、二次加工、多色共模、工模编号引用）、多层级半成品 BOM、
装配物料报价"本厂"行约束、装配加工采购单 BOM 快照、盘点审核回写 `物料资料.库存`
（采购分析扣数口径）、来料/塑胶标签单、采购入仓/领料/生产通知单、采购物料设置损耗率、
塑胶物料设置默认仓库、图片备注。

## 前提

先在 Windows 机器上完成 schema 部署（PowerShell，仓库根目录）：

```powershell
$env:ERP_DB = "Server=.;Database=ERP;User Id=erp;Password=***;TrustServerCertificate=True"
pwsh db/run-db.ps1        # 或 powershell db/run-db.ps1
```

`run-db.ps1` 会依次执行 db/01→56 及全部 seed 权限脚本（admin 的新菜单权限已在 seed 中，
60 脚本不重复造权限数据）。

## 执行顺序

先 60（造数据），后 61（验证）。三种方式任选：

**sqlcmd**（仓库根目录）：

```cmd
sqlcmd -S . -d ERP -U erp -P *** -i db\60_demo_virtual_data.sql -f 65001
sqlcmd -S . -d ERP -U erp -P *** -i db\61_demo_verify.sql -f 65001
```

**DbDeploy**：`tools/DbDeploy` 支持把文件作为参数逐个执行（run-db.ps1 同款调用方式），
把两个文件追加为参数即可。

**SSMS**：直接打开两个 .sql，先 F5 执行 60，再执行 61（确认连接到 ERP 库）。

## 预期输出

- 60 末尾打印：`60_demo_virtual_data: DEMO 演示数据重建完成。`
- 61 输出 23 行 `PASS`，总计行 `FAIL数 = 0`、`总结论 = 全部通过 ✅`。

任何 FAIL：按"序号"对照 61 脚本中该检查项的注释排查（每项注释写明验证的链路与口径）。

## 清理

60 脚本开头会按外键顺序删除全部 `DEMO` 前缀数据再重建——**重跑一次 60 即完成清理/重置**。
（注意：盘点链路在重建时会把 `物料资料.DEMO-MAT-001.库存` 重置为 100 再模拟审核回写为 80，
属预期行为。）"内部厂"供应商类别若为用户自建数据不会被误删（按名称双重限定）。

## 注意（API 层逻辑不在 SQL 断言范围）

以下规则在 service/前端实现，61 只验证数据落库口径，需经界面/API 复核：

- 塑胶共用物料表保存校验：`套数=出模数÷用量`、工模编号存在性（反例应被 API 拒绝）；
- 二次加工 BD/AF/AH 字母推导（电镀=B、印喷=D → BD）；
- 半成品共用物料设置 `库存单价HK` 自动计算（演示数据留 NULL 待算，经 BOM 保存触发）；
- 盘点审核回写：真实环境走 `POST api/material-stocktakes/{单号}/approve`（service 事务），
  60 脚本用与其完全相同的两条 UPDATE 模拟"审核后"状态（含手动回写 `物料资料.库存=80`）。
