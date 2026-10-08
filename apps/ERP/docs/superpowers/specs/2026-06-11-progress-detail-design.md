# 进度明细表（采购管理）设计

**日期**：2026-06-11
**模块**：采购管理 → 进度明细表（菜单已存在 `M("进度明细表")`，当前无路由/无实现）

## 目标

采购管理下的只读**明细级**采购进度查询。**一行 = 一条已审核入仓明细**（订单行 × 该次入仓）；完全未入仓的订单行也列一行（入仓列空）。是订单进度表（聚合）的展开视图：订单进度表把同物料同颜色的多次入仓 SUM 成一行，本表把每次入仓拆开成独立行。点行内任意单元格 → 打开该行所属采购订单（复用 `PurchaseOrderDrawer`）。

与已完成的「订单进度表」(`docs/superpowers/specs/2026-06-11-order-progress-design.md`) 同源，复用其 `采购订单` 表结构、关联口径与前端抽屉。

## 数据来源与口径

涉及表（以 `db/01_rebuild_schema.sql` 为准）：

- `采购订单`（单头）：单号, 日期, 交货日期, 供应商编号/名称, 操作员, 审核 …
- `采购明细单`（订单明细）：单号(→采购订单), 生产单号, 款号, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, **数量(订购数量)**, 日期(订购日期), 交货日期, ID …
- `采购入仓明细单`：**单号(=入仓单号)**, 订单单号, 物料编号, 颜色, **数量(入仓数量)** …
- `采购入仓单`：单号, **日期(=入仓日期)**, 审核

**关联与展开**：`采购明细单 d` JOIN `采购订单 o ON o.单号=d.单号`，**LEFT JOIN 已审核入仓明细（不聚合）**，关联键 `订单单号=d.单号 AND 物料编号 AND ISNULL(颜色,'')`。一条订单行有 N 次已审核入仓 → N 行；0 次 → 1 行（入仓列 NULL）。入仓只认 `ISNULL(采购入仓单.审核,'0')='1'`。入仓日期取表头 `采购入仓单.日期`。

**与订单进度表的口径一致性**：两者用同一关联键（订单单号+物料编号+颜色）与"只认已审核入仓"。订单进度表 `SUM(入仓数量)` 聚合为一行；本表保留每条入仓明细。

**已知约束（不在本模块解决）**：现有「采购入仓单」录入流程未写入 `订单单号`，故当前历史数据多表现为"未入仓"行（入仓列空）。本模块不改入仓流程。

## 后端

加在现有 `src/ErpApi/Features/Materials/PurchaseOrder/`：

- DTO `PurchaseOrderProgressDetailRow`（PurchaseOrderDtos.cs 内新增）：
  订购日期, 交货日期, 采购单号, 生产单号, 款号, 物料编号, 物料名称, 物料类别, 规格, 颜色, 单位, 订购数量, 入仓单号, 入仓数量, 入仓日期, 供应商名称, 操作员, 审核。
- `PurchaseOrderService.ProgressDetailAsync(供应商?, 起?, 止?, keyword?, 状态)` → `IReadOnlyList<PurchaseOrderProgressDetailRow>`。`状态` 取值 `"已入仓"|"未入仓"|其它(全部)`。Dapper 查询：

```sql
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       rk.[入仓单号], rk.[入仓数量], rk.[入仓日期],
       o.[供应商名称], o.[操作员], o.[审核]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           r.[单号] AS 入仓单号, r.[数量] AS 入仓数量, h.[日期] AS 入仓日期
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)   -- @止 = 止.Date.AddDays(1)，半开区间
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyIn = 0 OR rk.[入仓单号] IS NOT NULL)     -- 状态=已入仓
  AND (@onlyOut = 0 OR rk.[入仓单号] IS NULL)        -- 状态=未入仓
ORDER BY d.[单号] DESC, d.[ID], rk.[入仓日期];
```

服务端把 `状态` 翻译为 `@onlyIn`/`@onlyOut`（"已入仓"→onlyIn=1；"未入仓"→onlyOut=1；其它→都 0）。

- 控制器 `PurchaseOrderController` 加 `[HttpGet("progress-detail")]`（放在 `[HttpGet("{单号}")]` 之前）：权限 `PermissionAction.打开`（菜单「采购订单」）；无价格列，不脱敏。

## 前端

- API：`web/src/api/purchaseOrders.ts` 加类型 `PurchaseOrderProgressDetailRow` 与 `ProgressDetailQuery`，方法 `progressDetail(q)` → `GET /purchase-orders/progress-detail`。
- 新页 `web/src/pages/production/ProgressDetailPage.tsx`：
  - 筛选条：供应商关键字、订购日期范围（RangePicker）、关键字（生产单号/款号/物料）、状态下拉（全部/已入仓/未入仓）、查询按钮（显式应用，与订单进度表一致）。
  - 表格：上述返回列；入仓单号为空的行（未入仓）入仓列显示空；审核列用 Tag。
  - 点任意行 → 打开 `PurchaseOrderDrawer`（view 模式，传该行 `采购单号`）。
  - 无「打开」权限时显示无权提示。
- 菜单/路由：`menuTree.tsx` 把 `M("进度明细表")` 改为 `M("进度明细表", "/order-progress-detail", "采购订单")`；`App.tsx` 加 `/order-progress-detail` 路由。

## 测试

- 后端 DbTest `ProgressDetailDbTests`（`[Collection("db")]`）：种 1 张采购订单 + 2 行订单明细（A 物料两次入仓、B 物料零次入仓），断言：A 展开为 2 行（两条入仓单号/数量/日期各异），B 为 1 行（入仓列 NULL）；未审核入仓不计；`状态=已入仓` 只剩 A 的 2 行；`状态=未入仓` 只剩 B；颜色/订单号关联正确。注意 FK：采购订单.供应商编号→供应商资料、采购明细单.物料编号→物料资料，种子需先种父行；反 FK 顺序清理。
- 后端 API 测试 `ProgressDetailApiTests`：无「打开」权限→403；有权限→返回数组且字段正确（入仓单号/入仓数量/入仓日期）。

## 取舍与边界

1. 入仓只认已审核；按 订单单号+物料编号+颜色 关联（与订单进度表同口径）。
2. LEFT JOIN **展开**（非聚合）：订购数量在同订单行的多条入仓行上重复显示（明细报表惯例，不分摊）。
3. 状态下拉过滤 已入仓(入仓单号非空)/未入仓(入仓单号空)/全部。
4. 本模块不改采购入仓流程；当前数据多为"未入仓"行，属预期。
5. 点行复用现有抽屉；只读，无新增/编辑/审核；无价格列、无成本脱敏。
6. 入仓日期取 `采购入仓单.日期`（表头）。
