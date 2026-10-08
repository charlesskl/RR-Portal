# P5c 半成品仓储（入仓 → 库存 → 领料 → 盘点）设计

> 阶段：P5 仓储 M8 的第三个切片（P5a 成品入出仓/库存/盘点、P5b 成品调拨/退货/退仓 已交付）。本设计覆盖**半成品仓储：半成品入仓 + 半成品领料 + 半成品盘点 + 半成品库存**。月结快照、加权出库成本仍延后。

## 1. 目标与业务闭环

让**半成品库存「动起来」**（物料维度，与 P3 物料库存同构）：

1. **半成品入仓**：裁好的片/半成品入半成品仓（库存 +）。
2. **半成品库存**：实时汇总（物料编号×颜色×仓库）。
3. **半成品领料**：领出到下道工序（库存 −）。
4. **半成品盘点**：核对实盘，算法7 盈亏，审核后入库存。

可演示命题：入仓 物料M1 黑 100 → 库存 100 → 领料 30 → 库存 70 → 盘点实盘 68 → 盈亏 −2 → 审核 → 库存 68。

## 2. 关键设计决策（brainstorming 已定）

1. **范围**：半成品入仓 + 领料 + 盘点 + 库存。延后：月结快照（算法1 快照层）、加权出库成本、按原单带出基准、半成品↔成品转化关联。
2. **库存维度**：**物料编号×颜色×仓库**（半成品明细有 物料编号 + 颜色，无尺码/色号）。新增 `IInventorySummaryService.SemiFinishedAsync(仓库)`，UNION：半成品入仓明细单(+)/半成品领料明细单(−)/半成品盘点明细单 盈亏(±)，group by 物料编号×颜色，审核='1'，`HAVING SUM(库存)<>0`。
3. **领料 = 出库（−）**，与 P3 领料同构。
4. **审核同步明细审核位**：沿用 P5a/P5b——审核引擎②只翻单头 `审核`，而库存按各明细单 `审核` 过滤，故三个控制器 Approve/Unapprove 在 posting 后补 `UPDATE [对应明细单] SET [审核]=...`。
5. **成本保密**：三单 单价/金额 无「单价」权限置 null；单价手工默认 0，不做加权成本。

## 3. 涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- **半成品入仓单**（单头）：`ID`, `单号 nvarchar(20) UNIQUE`, `日期`, `供应商编号`, `供应商名称`, `仓库`, `部门`, `操作员`, `审核`, `备注` 等。**无 审核人/审核日期（08 补）**。
- **半成品入仓明细单**（明细）：`ID bigint`, `单号 nvarchar(20)`, `日期`, `仓库`, `生产单号`, `款号`, `物料类别`, `物料编号`, `物料名称`, `规格`, `颜色`, `单位`, `数量 decimal(18,4)`, `单价 decimal(18,4)`, `金额`, `审核`, `备注` 等。FK：**单号→半成品入仓单(主从, FK_7)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。
- **半成品领料单**（单头）：`单号 nvarchar(20) UNIQUE`, `日期`, `仓库`, `部门`, `领料人`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（08 补）**。
- **半成品领料明细单**（明细）：同入仓明细的物料列（物料编号/物料名称/规格/颜色/单位/数量/单价/金额），加 `生产单号`/`款号`。FK：**单号→半成品领料单(主从, FK_19)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。
- **半成品盘点单**（单头）：`单号 nvarchar(20) UNIQUE`, `日期`, `仓库`, `部门`, `操作员`, `审核`, `备注`。**无 审核人/审核日期（08 补）**。
- **半成品盘点明细单**（明细）：`单号`, `日期`, `仓库`, `生产单号`, `款号`, `物料编号`, `物料名称`, `规格`, `颜色`, `单位`, `系统数量 real`, `盘点数量 real`, `盈亏数量 real`, `单价 money`, `金额 money`, `审核`, `备注`。FK：**单号→半成品盘点单(主从, FK_11)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。

**已确认的横切现状**：
- `PostableDocuments` 白名单**已含** `半成品入仓单`/`半成品领料单`/`半成品盘点单`（单号列=`单号`）——无需改白名单。
- `InventorySummaryService` 现有 `FinishedGoodsAsync`（成品）；本期**加 `SemiFinishedAsync`**（半成品，物料维度）。无既有半成品库存方法。

## 4. 架构与组件

| 单元 | 表 | 模式 | 菜单 |
|---|---|---|---|
| 库存引擎 | `InventorySummaryService` 加 `SemiFinishedAsync` + `SemiFinishedRow` | UNION 入仓(+)/领料(−)/盘点盈亏(±)，物料编号×颜色 group | — |
| 半成品入仓 | `半成品入仓单`+`半成品入仓明细单` | Dapper 两层，前缀 **BR**，审核走引擎②+同步明细审核位 | 半成品仓储「半成品入仓」 |
| 半成品领料 | `半成品领料单`+`半成品领料明细单` | Dapper 两层，前缀 **BL**，审核减库存 | 半成品仓储「半成品领料」 |
| 半成品盘点 | `半成品盘点单`+`半成品盘点明细单` | Dapper 两层，前缀 **BP**，BasisAsync 快照系统数量 | 半成品仓储「半成品盘点」 |
| 半成品库存 | （无落地表） | 复用 `SemiFinishedAsync`，新端点 | 半成品仓储「半成品库存」 |

**横切复用**：单号①（BR/BL/BP）、审核②（三单走引擎，白名单已含，08 补留痕列 + 控制器同步明细审核位）、库存汇总③（新增 SemiFinishedAsync）、权限审计④、成本保密。

## 5. 数据流与算法

**半成品入仓**（`半成品入仓单` 头 + N 条明细）：录 物料编号/物料名称/规格/颜色/数量(+可选单价)；金额=数量×单价(手工默认0)；审核后 库存+。单号 `BR+yyyyMMdd+3位`。事务：插单头→明细；删反序（仅未审核，UPDLOCK/HOLDLOCK）。

**半成品领料**：同构，前缀 `BL`；审核后 库存−（SemiFinishedAsync 领料项为 −数量）。

**半成品盘点**：`BasisAsync(仓库)` 从 `SemiFinishedAsync(仓库)` 取系统数量（物料编号×颜色）；创建录盘点数量，盈亏=盘点−系统；写明细（系统数量/盘点数量/盈亏数量，均 real 列，服务端传 decimal，SQL 隐式转）；审核后盈亏入库存。单号 `BP+...`。

**半成品库存查询**：`SemiFinishedAsync(仓库)` → 物料编号×颜色×库存（审核'1' 实时聚合）。新端点 `GET api/semi-inventory?仓库=`，独立「半成品库存」菜单。

**库存引擎 SQL**（新方法，注意盘点盈亏 real → CAST decimal 以与入仓/领料 decimal 对齐）：
```sql
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, 颜色, SUM(库存) AS 库存
FROM (
    SELECT 物料编号,物料名称,规格,颜色, 数量 AS 库存 FROM [半成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 物料编号,物料名称,规格,颜色, 数量*-1 AS 库存 FROM [半成品领料明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 物料编号,物料名称,规格,颜色, CAST(盈亏数量 AS decimal(18,4)) AS 库存 FROM [半成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
) t
GROUP BY 物料编号, 颜色
HAVING SUM(库存) <> 0;
```

## 6. 成本保密
半成品入仓/领料/盘点 明细的 单价/金额 在无「单价」权限时后端置 null。半成品库存查询仅含数量，无脱敏。

## 7. DB 08 脚本（幂等）
`db/08_p5c_additions.sql`：给 `半成品入仓单`、`半成品领料单`、`半成品盘点单` 补 `审核人 nvarchar(20) NULL` / `审核日期 datetime2(0) NULL`。单号列已 nvarchar(20)。`db/run-db.ps1` 追加加载 08。开发库+测试库各执行。

## 8. 测试策略
- **后端**：`DbFixture`。新种子 `P5cTestData`（客户 P5cC01 / 款号 P5cK01 / 生产单 P5cSC01 / 物料 P5cM1(物料资料) / 仓库 P5c半成品仓）。
  - `SemiReceiptServiceDbTests`：入仓取数/金额、删除仅未审核、List/Get。
  - `SemiIssueServiceDbTests`：领料录入、删除。
  - `SemiStocktakeServiceDbTests`：BasisAsync 快照系统数量、盈亏、审核后库存=实盘。
  - `InventorySummaryDbTests` 追加：SemiFinishedAsync 入100→领料30→盘点盈亏−2→库存68。
  - `P5cApiIntegrationTests`：三单 权限/审核/脱敏 + 半成品库存端点 + 全链路闭环。
  - `PostingEngineDbTests` 追加：半成品入仓单 审核用例（证 08 留痕列）。
- **前端**：vitest 复用 `finishedLines`（无新纯函数）+ `npm run build` 0 错误。
- **E2E**：API 全链路（入仓→库存→领料→盘点）+ puppeteer 截图。

## 9. 路由 ASCII / 菜单中文
- 入仓 `api/semi-receipts`；领料 `api/semi-issues`；盘点 `api/semi-stocktakes`（+`/basis`）；库存 `api/semi-inventory`。
- 前端「半成品仓储」菜单组：半成品入仓 `/semi-receipts`、半成品领料 `/semi-issues`、半成品盘点 `/semi-stocktakes`、半成品库存 `/semi-inventory`。

## 10. 明确延后（已记录）
1. 月结快照（算法1 快照层，`IInventorySnapshotProvider` 已留插槽）。
2. 加权出库成本。
3. 按原单带出基准（领料按入仓/生产单校验）。
4. 半成品↔成品转化关联（半成品 BOM）。

## 11. 文件结构（预估）
```
src/ErpApi/
├─ Engines/Inventory/InventorySummaryService.cs   改:加 SemiFinishedAsync
├─ Engines/Inventory/IInventorySummaryService.cs   改:加 SemiFinishedAsync 签名
├─ Engines/Inventory/SemiFinishedRow.cs            新:物料编号/物料名称/规格/颜色/库存
├─ Features/Warehouse/Semi/                         新目录
│  ├─ SemiDtos.cs
│  ├─ SemiReceiptService.cs / SemiReceiptController.cs        半成品入仓
│  ├─ SemiIssueService.cs / SemiIssueController.cs            半成品领料
│  ├─ SemiStocktakeService.cs / SemiStocktakeController.cs    半成品盘点(+BasisAsync)
│  └─ SemiInventoryController.cs                              半成品库存查询
└─ Program.cs                                       改:注册三服务
db/08_p5c_additions.sql / db/run-db.ps1 / db/seed_p5c_perms.sql
web/src/api/semi.ts
web/src/pages/warehouse/{SemiReceipt,SemiIssue,SemiStocktake,SemiInventory}*.tsx
web/src/pages/MainLayout.tsx / App.tsx              改:半成品仓储菜单组+路由
tests/ErpApi.Tests/P5cTestData.cs + 各 *DbTests + P5cApiIntegrationTests.cs + InventorySummaryDbTests/PostingEngineDbTests 追加
```
（精确文件清单与逐任务步骤在实现计划中给出。）
