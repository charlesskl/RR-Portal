# 生产报表三缺口补齐（领料欠领 / 制单用料实际领料 / 采购领料分析表）

日期：2026-07-28

## 背景
对照旧版 ERP「生产报表」说明书，补齐 3 个缺口：

1. **领料超数查询**：旧版「审核后的生产通知单做了采购分析就显示数据（还没领料，则显示负数）」——不能只列超领行，欠领要显示负数。
2. **制单用料查询**：旧版「每张生产单每个物料的实际领料数量（领料单中填了生产单号才统计）」——原来右侧只显示 BOM 计划用量。
3. **采购领料分析表**：旧版「车间领料后，可以查询数据细节」——采购分析与领料的结合明细，原系统没有。

## 变更清单

**后端（src/ErpApi/Features/Production/）**
- `ProductionReportService.cs`
  - `IssueOverAsync`：去掉 `HAVING 已领−需求 > 0.005`，改为返回所有有 BOM 需求的行；差异列改名 `超数`→`差异`（差异=已领−需求，负=欠领、正=超领）。筛选参数不变。
  - 新增 `OrderMaterialUsageAsync(生产单号)`：`生产BOM物料清单` 按物料编号归集计划用量（Σ总数量/Σ金额/MAX预算单价），LEFT JOIN 审核领料单按 (生产单号,物料编号) 汇总的实际领料；差异=实际−计划。
  - 新增 `PurchaseIssueAnalysisAsync(起,止,keyword)`：`生产BOM物料清单` 按 (生产单号,物料编号) 归集，LEFT JOIN 审核采购入仓汇总（写法同 purchase-over）与审核领料汇总（写法同 issue-over）；列含 需求/采购/已领/库存/可用库存/需订/差异（差异=需求−已领，正=欠领）；日期范围按 `制单日期` 过滤（止转次日开区间）。
- `ProductionReportDtos.cs`：`IssueOverRow.超数`→`差异`；新增 `OrderMaterialUsageRow`、`PurchaseIssueAnalysisRow`。
- `ProductionReportController.cs`：`issue-over` 注释更新；新增 `GET /api/production-reports/order-material-usage?生产单号=`（缺参 400）与 `GET /api/production-reports/purchase-issue-analysis?起=&止=&keyword=`。权限均照抄相邻端点：gate 在「生产制单·打开」。

**前端（web/src/）**
- `api/productionReports.ts`：`IssueOverRow.超数`→`差异`；新增 `OrderMaterialUsageRow`、`PurchaseIssueAnalysisRow` 类型与 `orderMaterialUsage`、`purchaseIssueAnalysis` 两个 API。
- `pages/production/IssueOverQueryPage.tsx`：标题改「领料超数/欠领查询」，列「超数」改「差异」，负数=欠领橙色(#fa8c16)、正数=超领红色(#cf1322)（沿用 PurchaseOverQueryPage 的红色风格），卡头 extra 加说明文字。
- `pages/production/MaterialUsageQueryPage.tsx`：右侧数据源由 `GET /api/production/{单号}` 的物料段改为 `order-material-usage`，列为 物料编号/名称/规格/颜色/单位/计划用量/实际领料/差异（+预算单价/金额，hidePrice 时隐藏），差异着色同上（负=欠领橙、正=超领红）。左侧生产单列表与分页不变。
- 新建 `pages/production/PurchaseIssueAnalysisPage.tsx`：仿 `PurchaseAnalysisQueryPage.tsx`，筛选=制单日期 RangePicker + 关键字（生产单号/款号/物料编号/物料名称），客户端分页 50/页，差异列正=欠领橙、负=超领红。
- **未动** `web/src/App.tsx`、`web/src/nav/menuTree.tsx`（路由接线由主会话统一做）。

**测试（tests/ErpApi.Tests/）**
- `P_ProductionReportsApiTests.cs`：forbidden 用例补 2 个新端点；OK 用例补 order-material-usage（缺参 400、带参 200）与 purchase-issue-analysis（无参/带日期+keyword）；新增 `IssueOver_and_PurchaseIssueAnalysis_shape` 校验返回 JSON 数组与关键字段名（生产单号/物料编号/需求数量/已领数量/采购数量/库存数量/差异）。DB 集成测试依赖 ERP_TEST_DB，未设置自动跳过。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过（0 警告 0 错误）。
- `dotnet test tests/ErpApi.Tests --filter P_ProductionReportsApiTests`：编译通过，3 个用例因未设 ERP_TEST_DB 全部跳过（属预期）。
- `cd web && tsc -b`：通过（exit 0）。
- 期间主会话并行改 MaterialStocktake 曾短暂造成构建/测试编译错误，待其修好后复验通过；本任务未触碰那些文件。

## 待办
- 路由/菜单接线（App.tsx、menuTree.tsx）由主会话统一加 `PurchaseIssueAnalysisPage`。
- 未做带库冒烟：建议设 ERP_TEST_DB 跑一次集成测试，并在页面上核对欠领负数行与实际领料对照数。
