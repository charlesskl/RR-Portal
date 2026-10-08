# P5b 成品仓储补全（调拨 + 退货 + 退仓）设计

> 阶段：P5 仓储 M8 的第二个切片（P5a 已交付 入仓/出仓/库存/盘点）。本设计覆盖成品仓储剩余三个单据族：**成品调拨 + 成品退货 + 成品退仓**。半成品、月结快照、加权出库成本仍延后。

## 1. 目标与业务闭环

补齐成品仓储剩余三个单据族，都汇入已有的 `InventorySummaryService.FinishedGoodsAsync` 库存：

1. **成品调拨**：成品在仓库间转移（源仓库 → 目标仓库）。审核后源仓库库存减、目标仓库库存加。
2. **成品退货**：客户退回成品，入指定仓库（库存 +）。
3. **成品退仓**：成品退给供应商，出指定仓库（库存 −）。

可演示命题（接 P5a 演示数据，成品仓 K001 黑M=28）：调拨 10 件 成品仓→半成品仓（成品仓黑M=18、半成品仓黑M=10）→ 退货 5 件入成品仓（成品仓黑M=23）→ 退仓 3 件出成品仓（成品仓黑M=20）。

## 2. 关键设计决策（brainstorming 已定）

1. **范围**：成品调拨 + 退货 + 退仓。延后：半成品（入仓/领料/盘点）、月结快照、加权出库成本、按原单带出基准、三层「总单」矩阵层。
2. **调拨双腿入库存**：`成品调拨明细单` 有 `源仓库`/`目标仓库`（非单一 `仓库`）。`FinishedGoodsAsync` 加两段 UNION：`目标仓库(+数量)`（调入）/ `源仓库(−数量)`（调出），均 审核='1'。退货(+)/退仓(−)的明细表本就在 UNION 中，无需改。
3. **录入方式**：退货/退仓本期**自由录入**（选仓库 + 款×色码×数量 + 可选 出仓单号/入仓单号 引用文本），不做"按原单带出基准"（与 P5a 入仓/出仓一致，延后）。
4. **审核同步明细审核位**：沿用 P5a 的 `SyncLineApprovalAsync`——审核引擎②只翻单头 `审核`，而 `FinishedGoodsAsync` 按各明细单的 `审核` 过滤，故三个新控制器 Approve/Unapprove 在 posting 后须补 `UPDATE [对应明细单] SET [审核]=...`。
5. **成本保密**：三单 单价/金额（及退货/调拨明细的 成本单价/成本金额）按"单价"权限后端置 null；单价手工默认 0，不做加权成本。

## 3. 涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- **成品调拨单**（调拨·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `日期`, `客户编号`, `客户名称`, `操作员`, `审核 nvarchar`, `备注`。**无 审核人/审核日期（07 补）**。（无单一 `仓库` 列；源/目标在明细。）
- **成品调拨明细单**（调拨·明细）：`ID int`, `单号 nvarchar(20)`, `出仓单号`, `日期`, `客户编号`, `客户名称`, `源仓库`, `目标仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `数量 decimal`, `成本单价`, `成本金额`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品调拨单(主从, FK_97)**、款号→款号总表、生产单号→生产制单。
- **成品退货单**（退货·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `日期`, `客户编号`, `客户名称`, `仓库`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（07 补）**。
- **成品退货明细单**（退货·明细）：`ID int`, `单号 nvarchar(20)`, `出仓单号`, `日期`, `客户编号`, `客户名称`, `仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `数量 decimal`, `成本单价`, `成本金额`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品退货单(主从, FK_113)**、款号→款号总表、生产单号→生产制单。
- **成品退仓单**（退仓·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `日期`, `供应商编号`(可空), `供应商名称`, `仓库`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（07 补）**。
- **成品退仓明细单**（退仓·明细）：`ID int`, `单号 nvarchar(20)`, `入仓单号`, `日期`, `供应商编号`, `供应商名称`, `仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `数量 decimal`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品退仓单(主从, FK_106)**、款号→款号总表、生产单号→生产制单。

**已确认的横切现状**：
- `PostableDocuments` 白名单**已含** `成品调拨单`/`成品退货单`/`成品退仓单`（单号列=`单号`）——无需改白名单。
- `FinishedGoodsAsync` 现含 成品入仓明细单(+)/成品退货明细单(+)/成品出仓明细单(−)/成品退仓明细单(−)/成品盘点明细单 盈亏(±)。本期**加 成品调拨明细单 目标仓库(+)/源仓库(−)** 两段。

## 4. 架构与组件

| 单元 | 表 | 模式 | 菜单 |
|---|---|---|---|
| 库存引擎扩展 | 改 `InventorySummaryService` | 加 调拨 目标仓库(+)/源仓库(−) UNION 项 | — |
| 成品调拨 | `成品调拨单`+`成品调拨明细单` | Dapper 两层，前缀 **CD**，源/目标仓库，审核走引擎②+同步明细审核位 | 成品仓储「成品调拨」 |
| 成品退货 | `成品退货单`+`成品退货明细单` | Dapper 两层，前缀 **TH**，入仓库(+) | 成品仓储「成品退货」 |
| 成品退仓 | `成品退仓单`+`成品退仓明细单` | Dapper 两层，前缀 **TC**，出仓库(−) | 成品仓储「成品退仓」 |

**横切复用**：单号①（CD/TH/TC 前缀）、审核②（三单走引擎，白名单已含，07 补留痕列 + 控制器同步明细审核位）、库存汇总③（FinishedGoodsAsync 加调拨双腿）、权限审计④、成本保密。

## 5. 数据流与算法

**成品调拨**（`成品调拨单` 头 + N 条 `成品调拨明细单`）：单头记 客户/操作员/备注（该表无 仓库/数量 列——源/目标仓库与数量都在明细）；明细每行带 源仓库/目标仓库/款×色码/数量，金额=数量×单价(手工默认0)。审核后库存：源仓库 −数量、目标仓库 +数量（由 FinishedGoodsAsync 双腿表达）。单号 `CD+yyyyMMdd+3位`。

**成品退货**：单头 客户/仓库；明细 款×色码/数量；审核后 仓库 +数量。单号 `TH+...`。可选 出仓单号 引用（文本，不校验）。

**成品退仓**：单头 供应商/仓库；明细 款×色码/数量；审核后 仓库 −数量。单号 `TC+...`。可选 入仓单号 引用。

三单共性：两层 Dapper 事务（插单头→明细，删明细→单头，仅未审核可删，UPDLOCK/HOLDLOCK 消竞态）；List/Get/Delete；审核/反审核走 `IPostingEngine` + `SyncLineApprovalAsync` 同步明细审核位。

**库存引擎扩展 SQL**（在 `成品盘点明细单` 段后追加）：
```sql
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品调拨明细单] WHERE 目标仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品调拨明细单] WHERE 源仓库=@仓 AND ISNULL(审核,'0')='1'
```

## 6. 成本保密
调拨明细 单价/金额/成本单价/成本金额；退货明细 单价/金额/成本单价/成本金额；退仓明细 单价/金额 在无"单价"权限时后端置 null。

## 7. DB 07 脚本（幂等）
`db/07_p5b_additions.sql`：给 `成品调拨单`、`成品退货单`、`成品退仓单` 补 `审核人 nvarchar(20) NULL` / `审核日期 datetime2(0) NULL`。单号列已 nvarchar(20)。`db/run-db.ps1` 追加加载 07。开发库+测试库各执行。

## 8. 测试策略
- **后端**：`DbFixture`。复用/扩展 `P5TestData`（加 目标仓库 P5半成品仓 常量；客户 P5C01 已有，调拨/退货明细 FK 款号→P5K01、生产单号→P5SC01 已种）。新种子清理覆盖三张新单据表。
  - `FinishedTransferServiceDbTests`（调拨：双腿库存——源仓 −、目标仓 +）。
  - `FinishedSalesReturnServiceDbTests`（退货：仓库 +）。
  - `FinishedVendorReturnServiceDbTests`（退仓：仓库 −）。
  - `InventorySummaryDbTests` 追加：调拨双腿用例（A仓入100→调拨30到B仓→A仓70、B仓30）。
  - `P5ApiIntegrationTests` 追加：三单 权限/审核/脱敏 + 调拨跨仓库存。
  - `PostingEngineDbTests` 追加：成品调拨单 审核用例（证 07 留痕列）。
- **前端**：vitest 复用 `finishedLines`（无新纯函数）+ `npm run build` 0 错误。
- **E2E**：API 全链路（调拨→退货→退仓，验证跨仓与 ±）+ puppeteer 截图。

## 9. 路由 ASCII / 菜单中文
- 调拨 `api/finished-transfers`；退货 `api/finished-sales-returns`；退仓 `api/finished-vendor-returns`。
- 前端「成品仓储」组追加：成品调拨 `/finished-transfers`、成品退货 `/finished-sales-returns`、成品退仓 `/finished-vendor-returns`。

## 10. 明确延后（已记录）
1. 半成品 入仓/领料/盘点。
2. 月结快照（算法1 快照层）。
3. 加权出库成本。
4. 按原单带出基准（退货按出仓单、退仓按入仓单、调拨按库存校验数量）。
5. 三层「总单」矩阵层。

## 11. 文件结构（预估）
```
src/ErpApi/
├─ Engines/Inventory/InventorySummaryService.cs   改:加调拨双腿 UNION
├─ Features/Warehouse/Finished/
│  ├─ FinishedDtos.cs                              改:追加 调拨/退货/退仓 DTO
│  ├─ FinishedTransferService.cs / FinishedTransferController.cs       成品调拨
│  ├─ FinishedSalesReturnService.cs / FinishedSalesReturnController.cs 成品退货
│  └─ FinishedVendorReturnService.cs / FinishedVendorReturnController.cs 成品退仓
└─ Program.cs                                      改:注册三服务
db/07_p5b_additions.sql / db/run-db.ps1 / db/seed_p5b_perms.sql
web/src/api/finished.ts                            改:追加三单 client
web/src/pages/warehouse/{FinishedTransfer,FinishedSalesReturn,FinishedVendorReturn}*.tsx
web/src/pages/MainLayout.tsx / App.tsx             改:成品仓储组加三项+路由
tests/ErpApi.Tests/{各 *DbTests} + P5ApiIntegrationTests/InventorySummaryDbTests/PostingEngineDbTests 追加
```
（精确文件清单与逐任务步骤在实现计划中给出。）
