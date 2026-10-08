# 原料仓库占位功能三项 + 加工厂分类明细表

日期：2026-07-28

## 背景
「原料仓库」菜单组 3 个占位项（原料资料 / 原料采购进度表 / 原料出库进度表）与「外发装配」组占位项「加工厂分类明细表」。共享文件（App.tsx / menuTree.tsx / Program.cs / MenuCatalog.cs / PostableDocuments.cs）按约定未动，注册项见文末。

## 原料资料 = 菜单别名（不做新页面）
调查结论：原料域只有一套原料主档 `塑胶原料资料` 表；「基本设置」组已有「塑胶原料资料表」→ `/plastic-raw-material-master`（PlasticRawMaterialMasterPage，左类别树 + 右表 CRUD，复用 `/api/master/plastic-raw-materials`）。「原料仓库」组的「原料资料」与其同一口径，是菜单别名。建议主会话直接 `M("原料资料", "/plastic-raw-material-master", "塑胶原料资料表")`，本任务未做新页面。

## 原料采购进度表
- 口径：每行一条 `原料采购订单明细`；入仓按 **订单单号+原料编号** 关联已审核 `原料入仓单/原料入仓明细单` 汇总（同 `OrderReceiptStatsAsync` 口径）；欠数=订货−入仓；进度=入仓/订货×100%（订货为 0 留空）。未审核入仓不计。
- 筛选：供应商(模糊)、日期类型(订购日期/交货日期，列名白名单防注入)+起止(半开区间)、keyword、onlyOwed(只看欠数)。
- 后端：`PlasticRawMaterialPurchaseOrderService.ProgressAsync` + DTO `PlasticRawMaterialPurchaseProgressRow`（同文件夹）；新控制器 `PlasticRawMaterialPurchaseProgressController`，`GET /api/plastic-raw-material-purchase-progress`，权限照抄相邻端点 gate「原料采购订单·打开」（同辅料采购进度表 gate「采购订单」）。
- 前端：`web/src/pages/plastics/PlasticRawMaterialPurchaseProgressPage.tsx` + `web/src/api/plasticRawMaterialPurchaseProgress.ts`。建议路由 `/plastic-raw-material-purchase-progress`。

## 原料出库进度表
- 口径：每行一条 `原料生产需求明细单`；已出库按 **(领料备注, 啤机生产单号, 原料编号)** 关联已审核 `原料出库单/原料出库明细单` 汇总（同 `OutsourceShortageAsync` 口径）；欠数=需求数量包−已出库；进度=已出库/需求×100%。未审核出库不计；领料备注不匹配不计（测试覆盖）。
- 筛选：到货情况(全部/未到=欠数>0/已到=欠数≤0)、开单日期起止、领料备注(全部/生产领料/样品领料/维修领料)、keyword、onlyOwed。
- 后端：`PlasticRawMaterialStockIssueService.IssueProgressAsync` + DTO `PlasticRawMaterialIssueProgressRow`；新控制器 `PlasticRawMaterialIssueProgressController`，`GET /api/plastic-raw-material-issue-progress`，gate「原料出库表·打开」（同辅料出库进度表 gate「领料单」）。
- 前端：`web/src/pages/plastics/PlasticRawMaterialIssueProgressPage.tsx` + `web/src/api/plasticRawMaterialIssueProgress.ts`。建议路由 `/plastic-raw-material-issue-progress`。

## 加工厂分类明细表
- 口径：按 加工厂类别→加工厂 列加工采购业务明细。数据源 UNION ALL：`塑胶加工采购单`（直接带加工厂编号/名称）+ `装配加工采购单`（供应商编号即加工厂，同 AssemblyPurchaseProgressPage 的 供应商→加工厂 映射口径；交货日期取 开始交货日期）。类别 LEFT JOIN `加工厂资料.加工厂类别`，无主档/空类别归「未分类」。旧版 `发外加工总单` 在新系统无对应功能入口，未纳入。
- 行粒度=单头（单号级），列：类别/加工厂编号/名称/单据类型/单号/日期/交货日期/客户名称/数量/金额/审核；排序 类别→加工厂编号→日期→单号。
- 筛选：类别(下拉，数据源 `/api/factory-master/categories`)、加工厂(模糊)、日期起止、keyword。无「款号资料·单价」权限时金额置 null（照抄 采购加工进度表 的脱敏方式）。
- 后端：新文件 `src/ErpApi/Features/Assembly/FactoryCategoryDetailService.cs`（含 `FactoryCategoryDetailRow`）+ `FactoryCategoryDetailController.cs`，`GET /api/assembly-factory-category-detail`，gate「款号资料」（同 `api/assembly-purchase-query` 各端点）。
- 前端：`web/src/pages/assembly/FactoryCategoryDetailPage.tsx` + `web/src/api/factoryCategoryDetail.ts`。建议路由 `/assembly-factory-category-detail`。

## DB 脚本
50/51 号**未使用**：三个报表均复用既有表，无 schema 变更；权限复用已有菜单（原料采购订单/原料出库表/款号资料），无需新授权种子。

## 测试
- `tests/ErpApi.Tests/PlasticRawMaterialPurchaseProgressDbTests.cs`：建单→入仓(未审核不计)→审核后 4/10=40%→只欠数过滤→补足后欠数 0、进度 100%。
- `tests/ErpApi.Tests/PlasticRawMaterialIssueProgressDbTests.cs`：需求 10 包→出库(未审核不计)→审核后 4/10=40%→到货情况过滤→样品领料不计入生产领料需求。
- `tests/ErpApi.Tests/FactoryCategoryDetailDbTests.cs`：塑胶+装配两源合并、类别解析、无主档归未分类、类别过滤、排序。
- 本机未设 `ERP_TEST_DB`，3 个 DB 测试按既有约定自动 SKIP，需在部署测试库上跑。

## 验证
- `dotnet build src/ErpApi --no-incremental`：0 错 0 警。
- `dotnet test tests/ErpApi.Tests`：169 通过 / 480 跳过 / 2 失败——`PricingServiceDbTests.Picks_latest_effective_price_...`（无 skip 守卫）与 `SemiFinishedShortageControllerTests.Export_returns_bom_csv...`，均为其它任务存量失败（见 assembly-rules 等工作日志），本任务未触及其文件；新增 3 个 DB 测试均正常 SKIP。
- `cd web && npx tsc -b`：通过。
- `npx vitest run`：243 通过 / 16 失败，全部集中在 `semiFinishedLabelOrderPage.test.ts`（useLocation Router 报错，半成品标签单为其它并行任务的在途改动），与本任务无关。
- 本任务对共享既有文件（2 个 Service + 2 个 Dtos）的 diff 为纯新增 148 行、0 删除。

## 需要主会话添加的注册
1. `web/src/App.tsx`：
   - `import PlasticRawMaterialPurchaseProgressPage from "./pages/plastics/PlasticRawMaterialPurchaseProgressPage";` → `<Route path="plastic-raw-material-purchase-progress" .../>`
   - `import PlasticRawMaterialIssueProgressPage from "./pages/plastics/PlasticRawMaterialIssueProgressPage";` → `<Route path="plastic-raw-material-issue-progress" .../>`
   - `import FactoryCategoryDetailPage from "./pages/assembly/FactoryCategoryDetailPage";` → `<Route path="assembly-factory-category-detail" .../>`
2. `web/src/nav/menuTree.tsx`：
   - 原料仓库组：`M("原料资料", "/plastic-raw-material-master", "塑胶原料资料表")`（别名）、`M("原料采购进度表", "/plastic-raw-material-purchase-progress")`、`M("原料出库进度表", "/plastic-raw-material-issue-progress")`
   - 外发装配组：`M("加工厂分类明细表", "/assembly-factory-category-detail", "款号资料")`
3. `src/ErpApi/Program.cs`：`builder.Services.AddScoped<ErpApi.Features.Assembly.FactoryCategoryDetailService>();`（两个原料进度控制器复用已注册 Service，无需新增）。
4. `MenuCatalog.cs` / `PostableDocuments.cs`：无需改动（无新菜单权限、无新单据类型）。
