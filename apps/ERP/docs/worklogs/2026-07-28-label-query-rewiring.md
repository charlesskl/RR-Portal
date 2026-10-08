# 来料/塑胶标签查询切换到新标签单（label-query rewiring，2026-07-28）

菜单里的"来料标签查询"和"塑胶标签查询"两个查询页原查的是旧口径（采购入仓明细单 / 塑胶物料明细单流程），与今天新建的来料标签单（`[来料标签单]`+`[来料标签明细]`，api/material-label-orders）、塑胶标签单（`[塑胶标签单]`+`[塑胶标签明细]`，api/plastic-label-orders）数据不通。本次把两个查询页对接到新标签单。旧口径已由"采购入仓查询"（与来料标签查询共用汇总口径）和"塑胶订购单查询"等相邻查询覆盖，切换不造成查询能力丢失。

未碰共享文件：`web/src/App.tsx`、`web/src/nav/menuTree.tsx`、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`、`src/ErpApi/Engines/Posting/PostableDocuments.cs`、`src/ErpApi/Features/MasterData/Controllers.cs`。

## 后端：新查询端点（挂在两套标签单 controller 上）

- `GET api/material-label-orders/label-query/detail|summary`（`MaterialLabelOrderController.cs`），权限菜单 **来料标签查询**（独立 `QueryMenu` 常量，与单据自身"来料标签单"权限分开）。
- `GET api/plastic-label-orders/label-query/detail|summary`（`PlasticLabelOrderController.cs`），权限菜单 **塑胶标签查询**（MenuCatalog 已有）。
- 参数与旧端点一致：`起/止/keyword/审核情况/物料类别`（旧塑胶端点 起/止 必填，新端点统一放宽为可空，前端始终会传）。
- 明细口径：每行一条标签明细，含单头 日期/电脑单号/审核 + 明细 物料编号/名称/规格/颜色/单位/数量/标签数/备注；物料类别 取主档（来料取 `物料资料`、塑胶取 `塑胶物料资料`，按物料编号 GROUP BY 取 MAX，与旧塑胶查询同一写法）；无价格列。
- 汇总口径：按 物料编号+规格+颜色 合并，`SUM(数量)`、`SUM(标签数)`（汇总新增 标签数 列，旧口径没有）。
- 过滤语义与旧端点逐项对齐：止日期含端点（+1 天开区间）；keyword 命中 电脑单号/物料编号/物料名称/规格；审核情况 "已审核"→审核='1'、"未审核"→<>'1'、其它→全部；物料类别 精确等于主档类别。
- 排序：明细按 日期 DESC、电脑单号、行号；汇总按 物料编号、规格、颜色。

## 旧端点处理（最小方案：保留不动）

- `PurchaseReceiptController` 的 `label-query/detail|summary`（Menu=采购入仓单）保留未改，仅前端不再调用；其汇总口径继续被 `receipt-query/summary`（采购入仓查询）使用。
- `PlasticLabelQueryController`（api/plastic-label-query，Menu=塑胶标签查询）整控制器保留未改，前端不再调用。后续如确认无引用可删。

## 前端

- `web/src/api/materialLabel.ts`：行类型改为 电脑单号/标签数 口径（去掉 款号），端点切到 `/material-label-orders/label-query/*`。
- `web/src/pages/materials/MaterialLabelQueryPage.tsx`：列调整为 日期/电脑单号/物料编号/名称/规格/材料/颜色/单位/数量/标签数/备注/审核（汇总加 标签数）；双击明细行改为 `navigate(/material-label-orders?open=电脑单号)` 打开来料标签单（原 MaterialDocDetailDrawer 采购入仓单抽屉不再适用）；导出EXCEL/打印保留，导出列同步。
- `web/src/api/plasticLabelQuery.ts`：行类型改为 电脑单号/标签数 口径（去掉 款号/工模编号/塑胶货号），端点切到 `/plastic-label-orders/label-query/*`。
- `web/src/pages/plastics/PlasticLabelQueryPage.tsx`：列同步调整（加 材料/规格/标签数）；双击改为 `navigate(/plastic-label-orders?open=电脑单号)`（原 PlasticMaterialDocDrawer 不再适用）；导出EXCEL/打印保留；页内"塑胶标签查询·打开"权限判断不变。
- 两个标签单页本身已支持 `?open=<电脑单号>` 自动开单，无需改动。

## 权限菜单名结论

- **来料标签查询**：MenuCatalog 中**不存在**（已 grep 确认）。新端点按任务要求使用该菜单名。在 MenuCatalog 补登记 + 执行 db/59 之前，该端点对所有人 403，前端页面会报"加载来料标签查询失败"——需要主会话配合完成注册（见下）。
- **塑胶标签查询**：MenuCatalog 已有（`MenuCatalog.cs:60`，组"塑胶报表"），用户已有授权，切换后立即可用。

## 需要主会话加的注册（共享文件，本次未动）

1. `src/ErpApi/Features/Admin/MenuCatalog.cs`：加 `new("物料管理","来料标签查询")`（建议放 line 104 `来料标签单` 旁）。
2. `web/src/nav/menuTree.tsx:84`：`M("来料标签查询", "/material-label-query", "采购入仓单")` 第三参权限菜单改为 `"来料标签查询"`。
3. DB：执行本次新增 `db/59_material_label_query_perms.sql`，为现有全部权限主体增量补授 来料标签查询（打开/打印；幂等 MERGE，不改写已有设置）。

## 测试

- `tests/ErpApi.Tests/MaterialLabelOrderServiceDbTests.cs` / `PlasticLabelOrderServiceDbTests.cs` 各新增 `LabelQuery_detail_and_summary_filter_and_aggregate`：明细行口径（电脑单号/标签数/单头审核/日期倒序）、审核情况/物料类别/keyword/日期区间过滤、汇总按 物料编号+规格+颜色 合并 数量与标签数。ERP_TEST_DB 未设时自动跳过（正常）。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet test tests/ErpApi.Tests`（全量）：205 通过 / 507 跳过 / 0 失败（跳过的均为 ERP_TEST_DB 未设的 DB 集成测试，含本次新增 2 个）。
- `cd web && npx tsc -b`：通过。
- `cd web && npx vitest run`：58 文件 259 测试全部通过。
- eslint 两查询页各有 1 个 `react-hooks/set-state-in-effect` 报错——改动前原文件即有同样报错（存量问题），未引入新违规。

## 改动文件

- `src/ErpApi/Features/Materials/LabelOrders/MaterialLabelOrderDtos.cs`（+查询行 DTO）
- `src/ErpApi/Features/Materials/LabelOrders/MaterialLabelOrderService.cs`（+LabelQueryDetail/SummaryAsync）
- `src/ErpApi/Features/Materials/LabelOrders/MaterialLabelOrderController.cs`（+label-query 端点，QueryMenu=来料标签查询）
- `src/ErpApi/Features/Plastics/LabelOrders/PlasticLabelOrderDtos.cs`（+查询行 DTO）
- `src/ErpApi/Features/Plastics/LabelOrders/PlasticLabelOrderService.cs`（+LabelQueryDetail/SummaryAsync）
- `src/ErpApi/Features/Plastics/LabelOrders/PlasticLabelOrderController.cs`（+label-query 端点，QueryMenu=塑胶标签查询）
- `web/src/api/materialLabel.ts`、`web/src/api/plasticLabelQuery.ts`（行类型+端点切换）
- `web/src/pages/materials/MaterialLabelQueryPage.tsx`、`web/src/pages/plastics/PlasticLabelQueryPage.tsx`（列/双击跳转/导出列）
- `tests/ErpApi.Tests/MaterialLabelOrderServiceDbTests.cs`、`tests/ErpApi.Tests/PlasticLabelOrderServiceDbTests.cs`（各 +1 测试）
- `db/59_material_label_query_perms.sql`（新增：来料标签查询权限种子）
