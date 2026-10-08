# 采购入仓单 · 订单选择器 设计

**日期**：2026-06-11
**模块**：采购管理/仓库管理 → 采购入仓单（按采购订单调入物料入仓）

## 目标

在现有采购入仓单录入行上加"款号/订单选择器"：点录入行的「款号」→ 弹出**仅还有欠数的已审核采购订单明细** → 选一行带回填（订单单号/款号/物料编号/物料名称/规格/颜色/单位，默认数量=欠数）→ 保存时把 `订单单号`（及生产单号/款号）持久化到 `采购入仓明细单`。这样入仓明细带上订单号，订单进度表/进度明细表的"入仓数量"自动对接（此前因入仓不带订单号而恒为 0）。

不做整页单据表单重做——保留现有"列表 + 新建抽屉"，只在录入行加选择器。领料单/退料单共享同一录入组件，本功能通过开关隔离、不受影响。

## 现状与复用

- 现有采购入仓单前端：配置驱动的通用物料单据（`MaterialDocPage` 列表 + `MaterialDocCreateDrawer` 新建抽屉 + `MaterialLineTable` 录入行 + `materialDocConfigs.ts` 配置），与领料/退料共享。`DocLine`（`web/src/utils/materialLines.ts`）= 物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额。
- 现有后端：`PurchaseReceiptService.CreateAsync` 插 `采购入仓明细单`（单号/日期/仓库/物料类别/物料编号/物料名称/规格/颜色/单位/数量/单价/金额/备注），**未写 订单单号/生产单号/款号**。共享 DTO `MaterialDocLineDto`（`src/ErpApi/Features/Materials/MaterialDocLineDto.cs`）= ID/物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额/备注。
- `采购入仓明细单` 表已有列：订单单号, 生产单号, 款号（及物料各列）——只需让 DTO + 插入语句带上。
- **选择器数据源复用**：订单进度表端点 `GET /api/purchase-orders/progress?onlyOwed=true&供应商=&keyword=`（`PurchaseOrderProgressRow`）已返回 采购单号(=订单单号)/生产单号/款号/物料编号/物料名称/物料类别/规格/颜色/单位/订购数量/入仓数量/欠数。`onlyOwed=true` = 欠数>0 的已审核订单行。**无需新增后端查询**。

## 后端

- `MaterialDocLineDto` 增加三个可选字段：`订单单号`、`生产单号`、`款号`（`string?`）。
- `PurchaseReceiptService.CreateAsync` 的明细插入语句把 `订单单号/生产单号/款号` 一并写入 `采购入仓明细单`（取自 DTO，为空则 NULL）。领料/退料服务不动。
- DTO/控制器其它不变；权限/审核/脱敏沿用。
- 口径：入仓数量按 `订单单号+物料编号+颜色` 关联已审核入仓（与 `MaterialInventoryService`/`ProgressAsync` 同口径）——本功能让入仓带订单号后，进度表/库存自动反映。

## 前端

- `materialLines.ts`：`DocLine` 增加可选 `订单单号?`、`生产单号?`、`款号?`（仅采购入仓单会填）。`materialDocApi.create` 的明细体透传这三字段。
- 新组件 `web/src/pages/materials/OrderLinePicker.tsx`（Modal）：
  - props：`open`、`供应商?`（按单头供应商预过滤；空则列全部欠数行）、`onPick(row)`、`onClose`。
  - 内容：调 `purchaseOrderApi.progress({ onlyOwed: true, 供应商, keyword })`，表格列 订单单号/款号/物料编号/物料名称/规格/颜色/单位/订购数量/入仓数量/欠数 + 关键字搜索框；点行（或选中后确定）→ `onPick(row)` 返回该行 → 关闭。
- `MaterialLineTable.tsx`：加可选 prop `enableOrderPicker?: boolean` 与 `供应商?: string`。开启时：
  - 录入表多一列「款号」：单元格显示该行 `款号`，为空时显示「选订单」链接；点击打开 `OrderLinePicker`（带 `供应商`）。
  - 选行回填该行：`物料编号/物料名称/物料类别/规格/颜色/单位`，`数量 = 欠数`（可手工改小），并暗存 `订单单号/生产单号/款号` 到该 `DocLine`。
  - 关闭时（`enableOrderPicker=false`，领料/退料）不显示款号列、行为完全不变。
- `MaterialDocCreateDrawer.tsx`：从 `materialDocConfigs` 读 `orderPicker` flag，连同单头「供应商编号」传给 `MaterialLineTable`；构造 create 明细时带上 `订单单号/生产单号/款号`。
- `materialDocConfigs.ts`：`MaterialDocCfg` 加可选 `orderPicker?: boolean`；`purchase-receipts` 配置设 `orderPicker: true`。

## 测试

- 后端 DbTest（扩 `PurchaseReceiptServiceDbTests` 或新增）：CreateAsync 传带 `订单单号/生产单号/款号` 的明细 → 断言 `采购入仓明细单` 行的这三列被正确写入；不传时为 NULL（向后兼容）。
- 后端联动 DbTest：种 1 张采购订单（含明细，订购100）+ 用 CreateAsync 建一张带该 订单单号 的已审核入仓（入仓30）→ `MaterialInventoryService.StockOfAsync` 或 `ProgressAsync` 反映 入仓30/欠70（证明订单号打通进度）。
- 前端：构建通过；纯函数（明细透传/欠数默认）若有可加 vitest，否则以构建+冒烟为准。

## 取舍与边界

1. 不整页重做；只在录入行加选择器（保留现有列表+抽屉与共享组件）。
2. 选择器只列已审核、有欠数的订单行（`onlyOwed=true`）；选行默认数量=欠数，允许改小。
3. 复用 `progress` 端点当选择器源，不新增后端查询端点。
4. 仅采购入仓单开选择器（`orderPicker` flag）；领料/退料共享组件 flag 默认关、不受影响。
5. 持久化 `订单单号/生产单号/款号` 到 `采购入仓明细单`——打通进度表的关键。本功能不改进度表/库存口径（它们本就按订单号关联，现在有数据了）。
6. 不做"超额入仓"硬校验（允许数量改小，不强制 ≤ 欠数）；不做多选批量带入（一次选一行，可多次点选多行）。
