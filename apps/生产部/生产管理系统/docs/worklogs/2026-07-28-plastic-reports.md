# 塑胶报表三占位菜单实现（库存月报表 / 物料进出汇总 / 进度明细表）

日期：2026-07-28

## 背景
menuTree 中三个占位菜单补实现：「塑胶报表」组的 **塑胶库存月报表**，「塑胶采购」组的 **塑胶物料进出汇总** 与 **塑胶进度明细表**（任务书称"塑胶管理"组，实际 menuTree 中两者位于 `g-plastic-pur` 塑胶采购组，无"塑胶管理"组）。共享文件（App.tsx / menuTree.tsx / Program.cs / MenuCatalog.cs / PostableDocuments.cs）未动，注册清单见文末。

## 口径（调查结论先行）
- **塑胶库存月报表**：复用 `PlasticInventoryService` 台账口径（入仓+/领料−/退料+/退仓−/报废−/盘点±，仅审核='1'）。期初=月初前已审核台账净额；本月入/出=当月台账按正负拆分（盘点盈亏按符号计入入/出，同既有 `InOutAsync` 口径）；期末=期初+入−出。与既有「塑胶进出库统计表」（/plastic-in-out）的差别：**按物料编号聚合（不分仓库）**、参数为月份、支持物料类别过滤。
- **塑胶物料进出汇总**：调查确认既有「塑胶进出库统计表」是期初/本期入/本期出/期末口径（按物料×仓库），**并非**单据流水也非按单据类型分列，故本表按任务口径新做：按物料编号一行，区间内 **入仓/退仓/领料/退料/报废** 各列=该单据类型绝对合计，**盘点盈亏**=带符号合计，仅审核='1'。新增带类型标签的台账 union（`LedgerUnionTyped`）。
- **塑胶进度明细表**：调查确认既有「塑胶进度表」（/plastic-purchase-progress, `ProgressAsync`）**已是明细行级**（一行一采购订单明细 + 入仓聚合 + 欠数），并非单头汇总。参照塑胶加工采购「进度表 vs 明细表」两页的关系（`PlasticProcessPurchaseOrderService.ProgressAsync` vs `PurchaseDetailAsync`），本表=进度表明细行 **+ 最近入仓单号/入仓日期 + 完成情况（欠数>0=未完成）+ 完成情况筛选**。入仓聚合口径沿用 生产单号+物料编号+颜色（仅审核入仓），与进度表一致，其"同键多行重复挂量"的既有注意事项同样适用。

## 路由与权限菜单名
| 报表 | API | 菜单权限名 |
|---|---|---|
| 塑胶库存月报表 | GET `api/plastic-monthly-report`（月份, 物料类别?, keyword?） | 塑胶库存月报表 |
| 塑胶物料进出汇总 | GET `api/plastic-in-out-summary`（起, 止, 物料类别?, keyword?） | 塑胶物料进出汇总 |
| 塑胶进度明细表 | GET `api/plastic-purchase-progress-detail`（供应商?, 起?, 止?, keyword?, 完成情况?） | 塑胶进度明细表 |

DI 无需新增注册（两个 service 已在 Program.cs 注册；Controller 自动发现）。

## 变更清单
**后端**
- `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`（修改）— 新增 `PlasticInOutSummaryRow`、`LedgerUnionTyped`、`MonthlyAsync(月份,物料类别,keyword)`、`InOutSummaryAsync(起,止,物料类别,keyword)`。
- `src/ErpApi/Features/Plastics/PlasticMonthlyReport/PlasticMonthlyReportController.cs`（新增）— api/plastic-monthly-report。
- `src/ErpApi/Features/Plastics/PlasticInOutSummary/PlasticInOutSummaryController.cs`（新增）— api/plastic-in-out-summary。
- `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderService.cs`（修改）— 新增 `ProgressDetailAsync`。
- `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderDtos.cs`（修改）— 新增 `PlasticPurchaseProgressDetailRow`。
- `src/ErpApi/Features/Plastics/PlasticPurchaseProgressDetail/PlasticPurchaseProgressDetailController.cs`（新增）— api/plastic-purchase-progress-detail。

**前端**
- `web/src/api/plasticMonthlyReport.ts`、`web/src/api/plasticInOutSummary.ts`、`web/src/api/plasticPurchaseProgressDetail.ts`（新增 client）。
- `web/src/pages/plastics/PlasticMonthlyReportPage.tsx`（月份 picker + 上/本/下月、物料类别、关键字，导出/打印/合计行）。
- `web/src/pages/plastics/PlasticInOutSummaryPage.tsx`（日期区间 + 物料类别 + 关键字，六类分列，导出/打印/合计行）。
- `web/src/pages/plastics/PlasticPurchaseProgressDetailPage.tsx`（镜像 PlasticPurchaseProgressPage + 入仓日期/入仓单号/完成情况列与筛选）。

**测试**
- `tests/ErpApi.Tests/PlasticMonthlyReportDbTests.cs` — 跨月期初/入/出拆分、未审核不计、物料类别过滤。
- `tests/ErpApi.Tests/PlasticInOutSummaryDbTests.cs` — 六类分列、未审核/区间外不计、盘点盈亏带符号。
- `tests/ErpApi.Tests/PlasticPurchaseProgressDetailDbTests.cs` — 欠数/完成情况/入仓单号日期、完成情况筛选、足额入仓后已完成。

## 主会话待加注册（共享文件，本任务未改）
1. `web/src/nav/menuTree.tsx`：
   - `M("塑胶库存月报表", "/plastic-monthly-report", "塑胶库存月报表")`（塑胶报表组，替换现有占位 `M("塑胶库存月报表")`）
   - `M("塑胶物料进出汇总", "/plastic-in-out-summary", "塑胶物料进出汇总")`（塑胶采购组，替换占位）
   - `M("塑胶进度明细表", "/plastic-purchase-progress-detail", "塑胶进度明细表")`（塑胶采购组，替换占位）
2. `web/src/App.tsx`：三个 lazy import + Route：
   - `plastic-monthly-report` → `PlasticMonthlyReportPage`
   - `plastic-in-out-summary` → `PlasticInOutSummaryPage`
   - `plastic-purchase-progress-detail` → `PlasticPurchaseProgressDetailPage`
3. `src/ErpApi/Features/Admin/MenuCatalog.cs`：`("塑胶报表","塑胶库存月报表")`、`("塑胶采购","塑胶物料进出汇总")`、`("塑胶采购","塑胶进度明细表")`。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过，0 warning 0 error。
- `cd web && npx tsc -b`：通过，无输出。
- `dotnet test tests/ErpApi.Tests --filter "…Plastic{MonthlyReport,InOutSummary,PurchaseProgressDetail,InOutService,PurchaseProgressService,InventoryService}…"`：11 个用例全部跳过（ERP_TEST_DB 未设，SkippableFact 自动跳过属正常）；0 失败。有测试库的环境应直接跑绿。

## 待办
- 有 ERP_TEST_DB 的环境跑上述 3 个新测试类确认绿。
- 无 DB 迁移（纯查询报表，全部为既有表既有列）。
