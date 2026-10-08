# 订单进度表（采购管理）设计

**日期**：2026-06-11
**模块**：采购管理 → 订单进度表（菜单已存在 `M("订单进度表")`，当前无路由/无实现）

## 目标

采购管理下的**只读进度查询页**。每行 = 一条采购订单明细（`采购明细单` 一行），展示**订购数量 vs 已入仓数量 vs 欠数**的采购进度。点行内任意单元格 → 打开该行所属的采购订单（复用现有 `PurchaseOrderDrawer` 查看态）。

## 数据来源与口径

涉及表（以 `db/01_rebuild_schema.sql` 为准）：

- `采购订单`（单头）：单号, 日期, 交货日期, 供应商编号/名称, 操作员, 审核, 生产单号 …
- `采购明细单`（明细，主从 by 单号）：单号(→采购订单), 生产单号, 款号, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, **数量(=订购数量)**, 日期, 交货日期, 供应商名称 …
- `采购入仓明细单`：**订单单号**(可指向采购订单.单号), 生产单号, 物料编号, 颜色, **数量(=入仓数量)**, 单号(→采购入仓单)
- `采购入仓单`：单号, 审核

**进度口径**：

- 订购数量 = `采购明细单.数量`
- 入仓数量 = 同 `(订单单号=采购订单号, 物料编号, 颜色)` 的**已审核**采购入仓明细数量之和
- 欠数 = 订购数量 − 入仓数量

**关联键**：`采购入仓明细单.订单单号 = 采购明细单.单号` AND `物料编号` AND `颜色`（颜色用 `ISNULL(颜色,'')` 兜空，避免同物料多颜色串算）。入仓只认 `ISNULL(采购入仓单.审核,'0')='1'`。

**已知约束（不在本模块解决）**：现有「采购入仓单」录入流程未写入 `订单单号`，故按订单号关联时当前历史数据入仓数量多为 0，属预期。本模块**不改入仓流程**；待后续让入仓带订单号（调入采购订单）后，进度自动有数。

## 后端

加在现有 `src/ErpApi/Features/Materials/PurchaseOrder/`：

- DTO `PurchaseOrderProgressRow`（PurchaseOrderDtos.cs 内新增）：
  订购日期, 交货日期, 采购单号, 生产单号, 款号, 物料编号, 物料名称, 物料类别, 规格, 颜色, 单位, 订购数量, 入仓数量, 欠数, 供应商名称, 操作员, 审核。
- `PurchaseOrderService.ProgressAsync(供应商?, 起?, 止?, keyword?, onlyOwed)` → `IReadOnlyList<PurchaseOrderProgressRow>`。Dapper 查询：

```sql
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料类别], d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.入仓数量, 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.入仓数量, 0) AS 欠数,
       o.[供应商名称], o.[操作员], o.[审核]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色, SUM(r.[数量]) AS 入仓数量
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色] = ISNULL(d.[颜色],'')
WHERE (@供应商 IS NULL OR o.[供应商编号] LIKE @供应商 OR o.[供应商名称] LIKE @供应商)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)   -- @止 传当天+1，半开区间
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
ORDER BY d.[单号] DESC, d.[ID];
```

`onlyOwed=true` 时在外层加 `欠数 > 0` 过滤（用 `HAVING`/子查询包裹或在服务端用 `(d.数量 - ISNULL(rk.入仓数量,0)) > 0` 直接进 WHERE）。

- 控制器 `PurchaseOrderController` 加 `[HttpGet("progress")]`：权限 `PermissionAction.打开`（菜单「采购订单」）；本页无价格列，**不做成本脱敏**。

## 前端

- API：`web/src/api/purchaseOrders.ts` 加 `progress(filters)` → `GET /purchase-orders/progress`。返回行类型 `PurchaseOrderProgressRow`。
- 新页 `web/src/pages/production/OrderProgressPage.tsx`：
  - 顶部筛选条：供应商关键字、订购日期范围（RangePicker）、关键字（生产单号/款号/物料）、`☑ 只看欠数`，查询按钮。
  - 表格：上述返回列；**欠数>0 标红**；审核列用 Tag。
  - 点任意行 → 打开现有 `PurchaseOrderDrawer`（view 模式，传该行 `采购单号`）。
  - 无「打开」权限时显示无权提示（与现有页一致）。
- 菜单/路由：`menuTree.tsx` 把 `M("订单进度表")` 改为 `M("订单进度表", "/order-progress", "采购订单")`；`App.tsx` 加 `/order-progress` 路由。

## 测试

- 后端 DbTest `OrderProgressDbTests`（`[Collection("db")]`）：种 1 张采购订单+2 行采购明细（含同物料异色）、1 张已审核采购入仓（订单单号=该订单号，部分入仓）、1 张未审核入仓（不计），断言：订购/入仓/欠数三值正确；未审核入仓不计入；颜色区分不串算；`onlyOwed` 过滤。
- 复用既有测试种子模式（供应商/物料/生产单），反 FK 顺序清理。

## 取舍与边界

1. 入仓只认已审核采购入仓单；按 订单单号+物料编号+颜色 汇总。
2. 进度表列出**全部**采购订单（含未审核），审核作为一列，不强制只看已审核。
3. 本模块**不改采购入仓流程**（不补订单号带出）；入仓带订单号留作后续模块。
4. 点行**复用现有抽屉**；待采购订单单据表单页落地后再切换为跳表单页。
5. 只读查询，无新增/编辑/审核操作；无价格列、无成本脱敏。
