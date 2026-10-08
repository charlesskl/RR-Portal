# 订购单查询（采购订单查询）设计文档

> 日期：2026-06-24　主题：复刻原系统「订购单查询」——对 `采购订单/采购明细单` 的只读查询报表页，含「汇总查询」「明细查询」两 Tab，明细行双击打开整单（复用现有抽屉）。

## 目标

把菜单占位项「订购单查询」（`menuTree.tsx` 仅有 `M("订购单查询")` 无路由）落地为一个**只读查询页**，对齐原系统：

- **汇总查询**：按 `物料编号 + 规格 + 颜色` 合并行，列 = 物料编号 / 物料名称 / 材料(物料类别) / 规格 / 颜色 / 单位 / 订购数量(SUM)。
- **明细查询**：每行一条 `采购明细单`，列 = 日期 / 单号 / 供应商 / 生产单号 / 款号 / 物料编号 / 物料名称 / 规格 / 材料 / 颜色 / 单位 / 数量 / 单价 / 金额 / 审核 / 备注；**双击行打开整单（图3）**。
- 顶部查询条件：日期范围、供应商、物料关键词；左侧物料分类树（按物料类别过滤）。

零新表、零迁移、零新前端基础组件（复用 `PurchaseOrderDrawer` / 分类树）。

## 背景与现状

- **底层表**（已核实 `PurchaseOrderService.ProgressAsync`）：`采购订单`(单头：单号/日期/交货日期/供应商编号/供应商名称/仓库/数量/金额/操作员/审核/备注/生产单号) JOIN `采购明细单`(明细：单号/生产单号/日期/款号/物料类别/物料编号/物料名称/规格/颜色/单位/数量/单价/金额…) ON `o.单号 = d.单号`。明细表**直接含** `物料类别 / 款号 / 生产单号`。
- **已有可复用件**：
  - 后端 `PurchaseOrderService` + `PurchaseOrderController`（`Route("api/purchase-orders")`），已有 `ProgressAsync`（`采购明细单 d JOIN 采购订单 o`，含 供应商/日期/类别 过滤的成熟 SQL 范本）、`GetAsync(单号)`（取整单详情）。
  - 前端 `web/src/pages/production/PurchaseOrderListPage.tsx` + `PurchaseOrderDrawer.tsx`（整单详情抽屉＝图3）、`web/src/api/purchaseOrders.ts`。
  - 物料分类树：`materialMasterApi.categories()`（`GET /material-master/categories`）+ `MaterialInventoryPage.tsx` / `MaterialMasterPage.tsx` 的 `treeData`/`onSelect`/选中类别筛选模式。
  - 成本保密：`hidePrice`/`can` 前端权限；后端按 `单价`/`金额` 权限剥离价格（沿用项目惯例）。
- **区别于既有页**：本页 ≠ `订单进度表(progress)`/`进度明细表(progress-detail)`（那两者带入仓/欠数联动）；本页是纯订购侧查询，无入仓 LEFT JOIN，更轻。

## 分层设计

### 1. 后端

在 `PurchaseOrderService` + `PurchaseOrderController` 内扩 2 个只读端点（不新建文件/控制器），DTO 加在 `PurchaseOrderDtos.cs`。

**共用查询参**（两端点同签名）：
```
string? 供应商   // 供应商编号 OR 供应商名称 LIKE
DateTime? 起     // 采购明细日期 >=
DateTime? 止     // 采购明细日期 <=（含当日，用 < 止.AddDays(1)）
string? keyword  // 物料编号 OR 物料名称 OR 规格 LIKE
string? 物料类别  // = 过滤（分类树节点）
```

**`GET /api/purchase-orders/order-query/detail`** → `IReadOnlyList<PurchaseOrderQueryDetailRow>`
```sql
SELECT d.[日期], d.[单号], o.[供应商名称], d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量], d.[单价], d.[金额], o.[审核], d.[备注]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat)
ORDER BY d.[日期] DESC, d.[单号], d.[物料编号]
```
DTO `PurchaseOrderQueryDetailRow`：上述列一一对应（含 `单号` 供双击）。

**`GET /api/purchase-orders/order-query/summary`** → `IReadOnlyList<PurchaseOrderQuerySummaryRow>`
```sql
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(d.[物料类别]) AS 物料类别,
       d.[规格], d.[颜色], MAX(d.[单位]) AS 单位, SUM(d.[数量]) AS 订购数量
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
WHERE <同上 5 个过滤条件>
GROUP BY d.[物料编号], d.[规格], d.[颜色]
ORDER BY d.[物料编号], d.[规格], d.[颜色]
```
DTO `PurchaseOrderQuerySummaryRow`：物料编号/物料名称/物料类别/规格/颜色/单位/订购数量。汇总无价格列，不涉密。

**成本保密**：`detail` 返回前，若当前用户无 `采购订单` 菜单的 `单价` 权限 → `单价=null`；无 `金额` 权限 → `金额=null`（与 `OrderService`/`ProgressAsync` 同款剥离逻辑）。

### 2. 前端

**API** `web/src/api/purchaseOrders.ts` 增：
```ts
export interface PurchaseOrderQueryDetailRow { 日期; 单号; 供应商名称; 生产单号; 款号;
  物料编号; 物料名称; 物料类别; 规格; 颜色; 单位; 数量; 单价?; 金额?; 审核; 备注 }
export interface PurchaseOrderQuerySummaryRow { 物料编号; 物料名称; 物料类别; 规格; 颜色; 单位; 订购数量 }
export interface OrderQuery { 供应商?; 起?; 止?; keyword?; 物料类别? }
purchaseOrderApi.orderQueryDetail(q) / .orderQuerySummary(q)
```

**新页** `web/src/pages/production/PurchaseOrderQueryPage.tsx`：
- 布局：左侧物料分类树（复用 `categories`，点节点设 `物料类别` 并刷新当前 Tab），右侧上为查询工具栏（日期范围 RangePicker + 供应商 Input + 物料关键词 Input + 查询/重置），下为 `Tabs`：`明细查询` / `汇总查询`，各一张 `Table`。
- 切 Tab / 改条件 → 调对应端点。明细价格列 `单价/金额` 按 `hidePrice` 隐藏。
- **明细行 `onRow.onDoubleClick`** → `setOpenNo(row.单号)`，渲染 `<PurchaseOrderDrawer open 单号={openNo} onClose={…} />`。该抽屉**已内置查看模式**：只传 `单号`（不传 `生产单号`）即走 `loadView(单号)` 拉整单展示（`PurchaseOrderDrawerProps`={open,生产单号?,单号?,onClose,onSaved?}）。无需新增 `readOnly` 形参；查看模式下若仍显示保存/审核按钮，实现计划再按需隐藏。

**路由/菜单**：`App.tsx` 加 `<Route path="purchase-order-query" element={<PurchaseOrderQueryPage/>}/>`；`menuTree.tsx` 把 `M("订购单查询")` → `M("订购单查询","/purchase-order-query","采购订单")`（沿用 `采购订单` 权限菜单，不新增权限项）。

### 3. 测试

**后端** `PurchaseOrderQueryDbTests`（`[Collection("db")]` + `DbFixture`，Skippable）：
- 种子：2 张已审核采购订单，同一物料编号、规格相同、**颜色不同**两行 + 另一物料一行。
- 断言：`detail` 行数 = 3；`summary` 行数 = 3（颜色不同不合并）；同物料编号+规格+颜色多单累加时 `SUM` 正确；日期范围 / 供应商 / `物料类别` 过滤生效；`keyword` 命中物料编号/名称/规格。
- 价格脱敏：无 `单价`/`金额` 权限的 token 调 `detail` → 对应列为 null。

**前端** `PurchaseOrderQueryPage.test.tsx`（vitest，mock api）：查询页渲染、两 Tab 切换拉对应数据、明细双击触发抽屉打开（断言 `单号` 透传）、无价格权限时价格列隐藏。

## 非目标（YAGNI）

- 不做导出 Excel、打印、合并单（图3 顶部的「合并/打印合并表格」属整单内功能，不在查询页）。
- 不做入仓/欠数联动（那是 `订单进度表`）。
- 不新增权限菜单项（挂 `采购订单` 既有权限）。
- 不分页（查询报表一次性返回，与 `progress`/`progress-detail` 现状一致）。

## 验收

后端 `dotnet test` 全绿（新增 `PurchaseOrderQueryDbTests` 通过）、前端 `npm --prefix web run test` + `build` 通过；联调：菜单「订购单查询」打开 → 两 Tab 数据正确 → 双击明细行弹出整单抽屉。截图留档。
