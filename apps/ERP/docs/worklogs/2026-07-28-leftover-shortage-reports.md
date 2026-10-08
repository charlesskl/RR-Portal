# 三个报表占位菜单实现（成品余料 / 合同余料 / 生产加工缺料）

日期：2026-07-28

## 背景
menuTree 中 3 个占位菜单落地为真实报表：
- 「生产报表」组：成品余料统计表、合同余料统计表
- 「发外加工」组：生产加工缺料表

模式照抄现有生产报表（`ProductionReportService/Controller`，只读、keyword 模糊、gate 在「生产制单·打开」）。

## 口径说明（调查后确认）

1. **成品余料统计表** `GET /api/production-reports/finished-leftover?keyword=`
   - 按款号归集：**余数 = 成品入仓累计 − 成品出仓累计**，列：款号/客户/名称/入仓数量/出仓数量/余数。
   - 仅审核单：明细行 `审核='1'`（与成品库存算法1 同口径，`InventorySummaryService` 对 成品入仓明细单/成品出仓明细单 都是明细级审核）。
   - 入仓侧键取 `COALESCE(款号, 货号)`：玩具模型入仓（freeselect 流程）只填 货号/客户/名称，服装模型填 款号/款式；出仓明细只有 款号。客户/名称优先入仓侧（客户，名称），缺省回退出仓侧（客户名称，款式）。
   - 两侧 FULL JOIN：只入未出（余数=入仓）、只出未入（余数为负）都会列出。
   - **取舍说明**：任务提到「出货/出仓」，销售出货明细单按 物料编号 记、无款号维度，与款号口径无法对齐，故只取 成品出仓（含其承载的销售出库业务）。关键字匹配 款号/客户/名称。

2. **合同余料统计表** `GET /api/production-reports/contract-leftover?keyword=`
   - 按 (合同号 × 物料)：**余料数量 = 采购入仓累计(审核) − BOM需求(生产BOM物料清单 Σ总数量)**，列：合同号/物料编号/物料名称/规格/颜色/单位/需求数量/采购数量/余料数量。
   - 采购侧直接用 `采购入仓明细单.合同号`（该列存在于基表，无需经生产单号回跳）；需求侧用 `生产BOM物料清单.合同号`。
   - 只统计合同号非空的行；FULL JOIN，采购>需求（余料为正）与需求>采购（余料为负，即欠料）都列出。

3. **生产加工缺料表** `GET /api/production-reports/process-shortage?keyword=`
   - 按 (生产单 × 物料)：**缺料数量 = 需求(Σ总数量) − 库存(Σ可用库存) − 已领(审核领料 Σ数量)**，仅列缺料 > 0.005 的行（阈值同 purchase-over）。
   - 需求/库存取 生产BOM物料清单（算法4 输出），已领取 领料明细单 JOIN 领料单（审核='1'），写法同 issue-over。路由名 `process-shortage` 与现有端点无冲突（现有缺料类端点：issue-over / purchase-issue-analysis / 塑胶塑料发外欠数 api/plastic-process-shortage，口径均不同）。

## 变更清单

**后端（src/ErpApi/Features/Production/）**
- `ProductionReportDtos.cs`：新增 `FinishedLeftoverRow`、`ContractLeftoverRow`、`ProcessShortageRow`。
- `ProductionReportService.cs`：新增 `FinishedLeftoverAsync`、`ContractLeftoverAsync`、`ProcessShortageAsync`（均只读、keyword 模糊 %kw%）。
- `ProductionReportController.cs`：新增 3 个端点（路由见上）。权限照抄相邻端点 gate 在「生产制单·打开」——MenuCatalog 暂无这 3 个独立权限菜单，控制器注释已注明。

**前端（web/src/）**
- `api/productionReports.ts`：新增 3 个 Row 类型与 `finishedLeftover`、`contractLeftover`、`processShortage` API。
- 新建 `pages/production/FinishedLeftoverPage.tsx`、`pages/production/ContractLeftoverPage.tsx`、`pages/assembly/ProcessShortagePage.tsx`（发外加工组同类页面 PlasticProcessShortagePage 在 plastics/、装配类在 assembly/，缺料表取 assembly/）。均为 关键字搜索 + 表格 + 导出EXCEL/打印（downloadCsv/printTable），无价格列故不用 hidePrice，权限 MENU="生产制单"。
- **未动** `web/src/App.tsx`、`web/src/nav/menuTree.tsx`（接线由主会话统一做）。

**测试（tests/ErpApi.Tests/）**
- `P_ProductionReportsApiTests.cs`：forbidden 用例补 3 端点 403；OK 用例补 3 端点（无参/带 keyword）200；新增 `Leftover_and_ProcessShortage_shape` 校验关键字段名（款号/入仓数量/出仓数量/余数；合同号/物料编号/需求数量/采购数量/余料数量；生产单号/物料编号/需求数量/库存数量/已领数量/缺料数量）。DB 集成测试依赖 ERP_TEST_DB，未设置自动跳过。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过（0 警告 0 错误）。
- `dotnet test tests/ErpApi.Tests --filter P_ProductionReportsApiTests`：编译通过，4 个用例因未设 ERP_TEST_DB 全部跳过（属预期）。
- `cd web && npx tsc -b`：通过（0 错误）。
- 期间并行任务的 SystemToolsController.cs / auxiliary 页面曾短暂造成 build/tsc 报错，待其修好后复验全绿；本任务未触碰那些文件（曾临时移开 SystemToolsController.cs 约 2 分钟用于隔离验证，已按 md5 原样恢复）。

## 待办（主会话接线）
- `web/src/nav/menuTree.tsx`：3 个占位叶子补 path+perm，建议
  - `M("成品余料统计表", "/finished-leftover", "生产制单")`
  - `M("合同余料统计表", "/contract-leftover", "生产制单")`
  - `M("生产加工缺料表", "/process-shortage", "生产制单")`
- `web/src/App.tsx`：加 3 条路由（lazy import 上述 3 个页面）。
- 可选：`MenuCatalog.cs` 若要独立授权可加 ("生产报表","成品余料统计表") 等条目，并把控制器 gate 换成对应菜单；当前与相邻生产报表一致共用「生产制单·打开」。
- 未做带库冒烟：建议设 ERP_TEST_DB 跑集成测试，并在页面上抽查一个款号对照成品库存数。
