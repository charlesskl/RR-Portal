# 采购入仓查询 · 2026-06-24

## 做了什么
复刻原系统「采购入仓查询」——对 `采购入仓单/采购入仓明细单` 的只读查询报表页（全列·无价格），菜单占位项落地 `/purchase-receipt-query`。是来料标签查询的"加列版"，差在明细列更全（含 入库单号/订单单号/供应商/生产单号）。

- **明细列**（按截图）：日期/单号/入库单号/订单单号/供应商编号/供应商名称/生产单号/款号/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核。
- **汇总查询**：与来料标签查询**共用口径**（物料编号+规格+颜色 GROUP BY，SUM 数量）。
- 工具栏与来料标签查询一致：上月/本月/下月(默认本月) + 日期范围 + 审核情况 + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击复用 `MaterialDocDetailDrawer`(采购入仓单)看整单**。

## 字段映射决定
原系统该页有 `单号` 和 `入库单号` 两列，但重建库 `采购入仓明细单` 只有一个 `单号`：
- **入库单号 = `d.单号`**（采购入仓单号，双击键）
- **单号 = `d.条码号`**（来料/条码号）
- 供应商 = `COALESCE(NULLIF(d.供应商编号/名称,''), o.…)`（明细优先、单头兜底）

## 关键实现
- 后端零新表：`PurchaseReceiptService` 加 `ReceiptQueryDetailAsync`(全列·无价格)；汇总**复用** `LabelQuerySummaryAsync`(两页共用)。`PurchaseReceiptController` 加 `GET receipt-query/detail`(→新方法) + `receipt-query/summary`(→共用汇总)。
- 前端复用 `buildLabelQuery`/`MaterialDocDetailDrawer`/`tableExport`；新 `api/purchaseReceiptQuery.ts` + 页 `PurchaseReceiptQueryPage.tsx`。双击用 `入库单号`(=d.单号)。
- 菜单 `M("采购入仓查询","/purchase-receipt-query","采购入仓单")`，挂既有权限。

## 测试
- 后端 `PurchaseReceiptQueryDbTests`×3：入库单号/单号/供应商 映射、审核情况/类别/keyword/日期过滤、共用汇总。
- 前端复用已覆盖的 `buildLabelQuery`，无新增纯逻辑。
- 全量：后端 314 过、前端 54 过、build ✓。E2E `tmp/shot/receipt-e2e.cjs`：明细渲染 + 双击开采购入仓单整单。

## 备注
- 复用 dev DB 的 `RKDEMO` 入仓单验证。
