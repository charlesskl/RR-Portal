# P5a 成品仓储核心（入仓 → 库存 → 出仓 → 盘点）设计

> 阶段：P5 仓储 M8 的第一个切片。M8 是大子系统（6 成品单据族 + 3 半成品 + 月结快照），本设计只覆盖 **成品入仓 + 成品出仓 + 成品库存 + 成品盘点**；调拨/退货/退仓/半成品/月结快照/加权出库成本延后。

## 1. 目标与业务闭环

让**成品库存「动起来」**，与 P3「物料库存动起来」同构：

1. **成品入仓**：把生产完成的成品按 款×颜色×尺码 入成品仓（关联生产单号）。
2. **成品库存**：实时汇总（款号×色号×颜色×尺码×仓库），复用已存在的 `InventorySummaryService.FinishedGoodsAsync`。
3. **成品出仓**：出库（发货/调出），减少库存。
4. **成品盘点**：核对实盘，算法7 盈亏（盘点数量 − 系统数量），审核后盈亏计入库存。

可演示命题：入仓 100（K001 黑M）→ 库存 100 → 出仓 30 → 库存 70 → 盘点实盘 68 → 盈亏 −2 → 审核 → 库存 68。

## 2. 关键设计决策（brainstorming 已定）

1. **范围**：成品入仓 + 出仓 + 库存 + 盘点。延后：成品调拨、成品退货、成品退仓、半成品（入仓/领料/盘点）、月结快照（算法1 快照层，`IInventorySnapshotProvider` 已留插槽）、加权出库成本、三层「总单」矩阵层。
2. **盘点机制（算法7）**：盘点盈亏作为**库存 UNION 的一个符号项**。盘点单创建时从 `FinishedGoodsAsync` 快照系统数量，录盘点数量，算盈亏=盘点−系统；审核后 `成品盘点明细单.盈亏数量(+)` 进入库存汇总 → 库存=系统+盈亏=实盘。契合「不写余额、汇总只认审核'1'」哲学。
3. **两层单据**：成品单据本有 单+明细单+总单 三层，本期只做 **头(单) + 明细(明细单)** 两层（与 M7 一致），跳过「总单」矩阵层。
4. **成本保密**：入仓 单价/金额、出仓 售价/金额/成本单价/成本金额、盘点 金额 在无「单价」权限时后端置 null。
5. **延后加权出库成本**：成本单价手工录入或留空，不算移动加权（与 P3 一致）。

## 3. 涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- **成品入仓单**（入仓·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `日期`, `供应商编号/名称`(可空,外发成品入仓用), `仓库`, `数量 decimal`, `金额 decimal`, `操作员`, `审核 nvarchar`, `备注`。**无 审核人/审核日期（06 脚本补）**。
- **成品入仓明细单**（入仓·明细）：`ID int`, `单号 nvarchar(20)`, `日期`, `仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `数量 decimal`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品入仓单(主从, FK_64)**、款号→款号总表、生产单号→生产制单（建库关系，测试按序种父行）。
- **成品出仓单**（出仓·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `订单单号`, `日期`, `客户编号/名称`, `仓库`, `数量 decimal`, `金额 decimal`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（06 补）**。
- **成品出仓明细单**（出仓·明细）：`ID int`, `单号 nvarchar(20)`, `日期`, `仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `数量 decimal`, `成本单价 decimal`, `成本金额 decimal`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品出仓单(主从, FK_71)**、款号→款号总表、生产单号→生产制单。
- **成品盘点单**（盘点·单头）：`ID int`, `单号 nvarchar(20) UNIQUE`, `日期`, `仓库`, `金额 decimal`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（06 补）**。
- **成品盘点明细单**（盘点·明细）：`ID int`, `单号 nvarchar(20)`, `日期`, `仓库`, `生产单号`, `款号`, `款式`, `床号`, `色号`, `颜色`, `尺码`, `系统数量 decimal`, `盘点数量 decimal`, `盈亏数量 decimal`, `成本单价 decimal`, `成本金额 decimal`, `单价 decimal`, `金额 decimal`, `审核`, `备注`。FK：**单号→成品盘点单(主从, FK_89)**、款号→款号总表、生产单号→生产制单。

**已确认的横切现状**：
- `PostableDocuments` 白名单**已含** `成品入仓单`/`成品出仓单`/`成品盘点单`（单号列=`单号`）——**无需改白名单**。
- `InventorySummaryService.FinishedGoodsAsync(仓库)` 已存在（P0/P3），现 UNION：成品入仓明细单(+)/成品退货明细单(+)/成品出仓明细单(−)/成品退仓明细单(−)，按 款号×色号×颜色×尺码 group，审核='1'。本期**加一段 成品盘点明细单.盈亏数量(+)**。退货/退仓明细表本期为空，无害。

## 4. 架构与组件

| 单元 | 表 | 模式 | 菜单 |
|---|---|---|---|
| 库存引擎扩展 | （改 `InventorySummaryService`） | UNION 加 成品盘点明细单.盈亏数量(+) WHERE 审核='1' | — |
| 成品入仓 | `成品入仓单`+`成品入仓明细单` | Dapper 事务两层，前缀 **CR**，从生产单带款，审核走引擎② | 成品仓储「成品入仓」 |
| 成品出仓 | `成品出仓单`+`成品出仓明细单` | Dapper 事务两层，前缀 **CC**，审核减库存 | 成品仓储「成品出仓」 |
| 成品盘点 | `成品盘点单`+`成品盘点明细单` | Dapper 事务两层，前缀 **CP**，BasisAsync 快照系统数量、算盈亏 | 成品仓储「成品盘点」 |
| 成品库存 | （无落地表） | 复用 `FinishedGoodsAsync`，新控制器端点 | 成品仓储「成品库存」 |

**横切复用**：单号①（CR/CC/CP 前缀）、审核②（三单走引擎，白名单已含，仅需 06 补留痕列）、库存汇总③（FinishedGoodsAsync 扩展）、权限审计④（所有端点）、成本保密（入仓/出仓/盘点 价格列脱敏）。

## 5. 数据流与算法

**成品入仓创建**（`成品入仓单` 头 + N 条 `成品入仓明细单`）：
- 选生产单带出款号/款式；录 色号/颜色/尺码/数量（+可选 单价=成本）；金额=数量×单价。
- 单头 数量=Σ、金额=Σ、审核='0'；单号 = `CR+yyyyMMdd+3位`。事务：插单头→明细；删反序（仅未审核，UPDLOCK/HOLDLOCK 消竞态）。

**成品出仓创建**：同构，前缀 `CC`。录 数量（+可选 单价=售价）；审核后库存减少（FinishedGoodsAsync 出仓项为 −数量）。

**成品库存查询**：`FinishedGoodsAsync(仓库)` → 款×色码×库存（审核'1' 实时聚合）。新端点 `GET api/finished-inventory?仓库=`，独立「成品库存」菜单控权。

**成品盘点**：
- `BasisAsync(仓库)`：从 `FinishedGoodsAsync(仓库)` 取当前库存作为每 (款,色号,颜色,尺码) 的系统数量。
- 创建：用户录盘点数量；盈亏数量=盘点数量−系统数量；写 成品盘点明细单（系统数量/盘点数量/盈亏数量）。单号 `CP+...`。
- 审核后：`成品盘点明细单.盈亏数量` 进入 FinishedGoodsAsync 的 UNION（已扩展）→ 库存=系统+盈亏=实盘。

## 6. 成本保密
入仓明细 单价/金额；出仓明细 单价/金额/成本单价/成本金额；盘点明细 单价/金额/成本单价/成本金额 在无「单价」权限时后端置 null。成品库存查询本期不含金额（仅数量），无需脱敏。

## 7. DB 06 脚本（幂等）
`db/06_p5_additions.sql`：给 `成品入仓单`、`成品出仓单`、`成品盘点单` 补 `审核人 nvarchar(20) NULL` / `审核日期 datetime2(0) NULL`（供审核引擎②写留痕）。单号列已 `nvarchar(20)`，无需扩宽。`db/run-db.ps1` 追加加载 06。开发库+测试库各执行一次。

## 8. 测试策略
- **后端**：`DbFixture`（`SkippableFact`）。新种子 `P5TestData`（复用客户/款号/生产单 + 成品仓 仓库名）。
  - `FinishedReceiptServiceDbTests`：入仓取款/金额、删除仅未审核、List/Get。
  - `FinishedIssueServiceDbTests`：出仓录入、删除。
  - `FinishedStocktakeServiceDbTests`：BasisAsync 快照系统数量、盈亏计算、审核后库存=实盘。
  - `InventorySummaryDbTests`（或扩展现有）：入仓100→库存100→出仓30→库存70→盘点盈亏−2→库存68（证 UNION 扩展）。
  - `P5ApiIntegrationTests`：三单 权限/审核/脱敏 + 成品库存端点。
  - `PostingEngineDbTests` 追加：成品入仓单/出仓单/盘点单 审核用例（证 06 补的留痕列）。
- **前端**：vitest 纯函数（明细合计/盈亏）+ `npm run build` 0 错误。
- **E2E**：API 全链路（入仓→库存→出仓→盘点）+ puppeteer 截图。

## 9. 路由 ASCII / 菜单中文
- 入仓 `api/finished-receipts`；出仓 `api/finished-issues`；盘点 `api/finished-stocktakes`（+ `/basis`）；库存 `api/finished-inventory`。
- 前端「成品仓储」菜单组：成品入仓 `/finished-receipts`、成品出仓 `/finished-issues`、成品盘点 `/finished-stocktakes`、成品库存 `/finished-inventory`。

## 10. 明确延后（已记录）
1. 成品调拨（跨仓，需 UNION 双腿）、成品退货、成品退仓（明细表已在 FinishedGoodsAsync UNION 中，本期不建单据，表空）。
2. 半成品 入仓/领料/盘点。
3. 月结快照（算法1 快照层）——`IInventorySnapshotProvider`/`NullSnapshotProvider` 已留插槽。
4. 加权出库成本（成本单价手工/留空）。
5. 三层「总单」矩阵层。

## 11. 文件结构（预估）
```
src/ErpApi/
├─ Engines/Inventory/InventorySummaryService.cs   改:FinishedGoodsAsync 加盘点盈亏项
├─ Features/Warehouse/Finished/                    新
│  ├─ FinishedDtos.cs
│  ├─ FinishedReceiptService.cs / FinishedReceiptController.cs   入仓
│  ├─ FinishedIssueService.cs / FinishedIssueController.cs       出仓
│  ├─ FinishedStocktakeService.cs / FinishedStocktakeController.cs 盘点(+BasisAsync)
│  └─ FinishedInventoryController.cs               库存查询(复用FinishedGoodsAsync)
└─ Program.cs                                      改:注册三服务
db/06_p5_additions.sql / db/run-db.ps1 / db/seed_p5_perms.sql
web/src/api/finished.ts ; web/src/utils/finishedLines.ts
web/src/pages/warehouse/{FinishedReceipt,FinishedIssue,FinishedStocktake,FinishedInventory}*.tsx
web/src/pages/MainLayout.tsx / App.tsx             改:成品仓储菜单组+路由
tests/ErpApi.Tests/P5TestData.cs + 各 *DbTests + P5ApiIntegrationTests.cs
web/src/__tests__/finished.test.ts
```
（精确文件清单与逐任务步骤在实现计划中给出。）
