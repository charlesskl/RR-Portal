# 逐页审查修复：调价前端页面 + size 上限放宽 + 查询日期兜底（2026-07-28）

三项审查问题修复。未碰 `web/src/App.tsx`、`web/src/nav/menuTree.tsx`（路由/菜单由主会话统一接线，见文末建议），也未碰 `ProductionDtos.cs`、`BomSetupPage.tsx`（并行任务占用）。

## 1. 调价功能前端页面（新增）

- **后端现状（未改）**：`api/master/price-adjusts`（调价表）与 `api/master/price-adjust-lines`（调价明细表）已注册为 MasterCrud 主从结构（`Features/MasterData/Controllers.cs:131-141`，权限菜单"调价"）。**"应用"端点已存在**：`POST /api/master/pricing/apply/{单号}?报价类别=...`（`Features/MasterData/Pricing/PricingController.cs:21`），事务内把明细 `修改单价` 写成 `报价资料` 新生效价（生效日期=明细日期，缺省当前时间），返回 `生成报价条数`。取价为算法8（`PricingService`：物料编号+报价类别取 生效日期<=asOf 最新一条，NULL 生效日期视为基线价）。
- **新增文件**：
  - `web/src/api/priceAdjusts.ts`：两个 masterApi 包装（`price-adjusts` / `price-adjust-lines`，带类型）+ `applyPriceAdjust(单号, 报价类别)`。
  - `web/src/pages/master/PriceAdjustPage.tsx`：**左调价单列表 / 右明细** 主从页（与 MasterDataPage 同一套 Card/Table/Modal 风格）。左：搜索、分页、新增/编辑/删除调价单（单号手输，编辑时禁改），点行选中；右：按 `单号` 加载明细（`list(1,1000,单号)` 再前端精确过滤 `linesOfDoc`），明细 CRUD 弹窗；工具栏"应用调价"弹窗选/输报价类别（AutoComplete 从 `quote-categories` 预载建议）后调 apply 端点并提示生成条数。权限：`can(调价,打开/保存/删除)` 控门禁与按钮，`hidePrice(调价)` 时隐藏 原单价/修改单价 列与表单项。
  - `web/src/utils/priceAdjust.ts`：纯逻辑（`validatePriceAdjustLine` / `fmtDate` / `linesOfDoc`）。
  - `web/src/__tests__/priceAdjust.test.ts`：6 个 vitest（api 路径与 apply 参数、明细校验、日期格式化、按单号过滤）。
- **建议接线（主会话执行）**：菜单 `M("调价", "/master/调价", "调价")` 放 menuTree ① 基本设置组（报价类别/报价资料附近）；`MasterRouter.tsx` 加 `if (decoded === "调价") return <PriceAdjustPage />;`（页面不走 MASTER_CONFIGS，因为是主从结构）。

## 2. "打开单据"列表 size 上限放宽（200/500 → 1000）

前端 `list(1, 1000)` 被服务端 clamp 静默截断成 20/50 条。统一放宽：上限 1000（保留防御滥用），`size < 1` 默认值不变。

- **if 式** `if (size < 1 || size > 200) size = 20;` → `if (size < 1) size = 20; if (size > 1000) size = 1000;`：56 处（含任务点名的 MaterialIssue/PurchaseReceipt/PurchaseOrder/MaterialStocktake 及 MasterCrudService、Orders、Sales、Payables、Plastics、Warehouse、Production 等全部同类）；`AssemblyPurchaseOrderService` 原为 `size > 500 → 50`，同样改为上限 1000、默认 50 保留。
- **Clamp 式** `Math.Clamp(size|query.Size, 1, 200)` → `Math.Clamp(..., 1, 1000)`：17 处（Semi 仓各 query、Semi/Plastic/Material LabelOrders、SemiFinishedCommonMaterial、FinishedReceipt、Purchase/Plastic MaterialSettings）。
- 改后 `grep "size > (200|500)|Clamp(..., 1, (200|500))"` 全项目 0 命中。

## 3. 查询/报表端点日期缺省兜底（500 → 正常返回）

非可空 `DateTime 起/止` 缺省时模型绑定给 `DateTime.MinValue`，直传 SQL datetime 参数溢出 500。新增共享 helper **`src/ErpApi/Infrastructure/QueryDateDefaults.cs`**：`Normalize(起, 止)` 把 `default` 兜底为 起=1900-01-01、止=2099-12-31。在 27 个 controller 的 45 个 action 首行插入 `(起, 止) = QueryDateDefaults.Normalize(起, 止);`（塑胶各 *-query/order-make/analysis/in-out/monthly 系列、原料 monthly/summary/order-receipt-stats、辅料 monthly/order-receipt-stats、AssemblyPurchaseQuery 的 summary/detail/tracking/required-materials/factory-category-monthly）。可空日期端点（`DateTime? 起 = null`）传 NULL 不溢出，未动。校验：所有含非可空 `DateTime 起/止` 的 controller 均已含 Normalize（脚本比对 0 遗漏）。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet test tests/ErpApi.Tests`：**205 通过 / 507 跳过 / 0 失败**（ERP_TEST_DB 未设，DB 测试自动跳过；此前日志记录的 2 个存量失败本次未复现）。
- `cd web && npx tsc -b`：通过。
- `npx vitest run`（全量）：60 文件 **277 通过**。
- eslint：新页面 `useEffect(() => { loadDocs(); }, [loadDocs])` 触发 `react-hooks/set-state-in-effect`——与存量 MasterDataPage/FactoryMasterPage/WarehouseLocationPage 等同款既有告警，项目未以此规则为门禁，保持与项目惯例一致未特殊处理。

## 遗留 / 建议

- 调价单无自动编号（MasterCrud 通用），单号手输；如需自动单号需另做。
- 明细与单头仅靠 `单号` 字符串关联，删单头不级联删明细（MasterCrud 通用行为），必要时后续加级联。
