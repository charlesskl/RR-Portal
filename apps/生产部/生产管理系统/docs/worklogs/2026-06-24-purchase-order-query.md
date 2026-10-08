# 订购单查询（采购订单查询）· 2026-06-24

## 做了什么
复刻原系统「订购单查询」——对 `采购订单/采购明细单` 的只读查询报表页，菜单占位项落地为 `/purchase-order-query`。

- **汇总查询**：按 `物料编号+规格+颜色` 合并，`SUM(数量)=订购数量`，列 物料编号/物料名称/材料/规格/颜色/单位/订购数量。
- **明细查询**：每行一条 `采购明细单`，列 日期/单号/供应商/生产单号/款号/物料编号/物料名称/规格/材料/颜色/单位/数量/单价/金额/审核/备注；**双击行复用 `PurchaseOrderDrawer` 看整单**。
- 查询条件：日期范围 + 供应商 + 物料关键词 + 左侧物料分类树（按 物料类别 过滤）。

## 关键实现
- 后端零新表/零迁移：`PurchaseOrderService` 加 `OrderQueryDetailAsync`/`OrderQuerySummaryAsync`（照搬 `ProgressAsync` 的 `采购明细单 d JOIN 采购订单 o` + 半开日期区间）；`PurchaseOrderController` 加 `GET order-query/detail|summary`，明细价格按 `单价` 权限后端剥离（同 `MaskDetail` 惯例）。
- 前端零新基础组件：复用 `PurchaseOrderDrawer`（自带查看模式，传 `单号` 即只读）、物料分类树（`materialMasterApi.categories`）、`hidePrice`。纯逻辑抽到 `utils/purchaseOrderQuery.ts`（`buildOrderQuery`，ALL/空串→undefined）。
- 菜单 `M("订购单查询","/purchase-order-query","采购订单")`，挂既有「采购订单」权限，不新增权限项。

## 测试
- 后端 `PurchaseOrderQueryDbTests`（3）：明细每行映射、汇总按 编号+规格+颜色 合并累加、日期/供应商/类别/keyword 过滤。
- 前端 `purchaseOrderQuery.test.ts`（4）：参数归一化。
- 全量：后端 306 过、前端 46 过、`npm run build` ✓。
- E2E（puppeteer `tmp/shot/poq-e2e.cjs`）：种 POQDEMO 整单 → 明细/汇总两 Tab 正确 → 双击明细打开整单抽屉。

## 备注
- dev DB 留了一张演示单 `POQDEMO`（供应商 东莞市恒科电子，2 行收缩膜）供肉眼验证，可随时删。
- 不做：导出/打印/合并单（属整单内功能）、入仓欠数联动（属订单进度表）。
