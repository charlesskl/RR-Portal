# 来料标签查询 · 2026-06-24

## 做了什么
复刻原系统「来料标签查询」——对 `采购入仓单/采购入仓明细单`(来料=进仓)的只读查询报表页，菜单占位项落地 `/material-label-query`。订购单查询的同构克隆，换数据源到入仓 + 多一个**审核情况**筛选。

- **汇总查询**：按 `物料编号+规格+颜色` 合并，`SUM(数量)`。
- **明细查询**：每行一条采购入仓明细，列 日期/单号/款号/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核(**无价格列**)；**双击行复用 `MaterialDocDetailDrawer`(cfg=采购入仓单)看整单**。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况(全部/已审核/未审核) + 物料类别下拉 + 关键词 + 查询 + 导出EXCEL + 打印。

## 关于「省略三列」
原系统该页有 每箱数量/预计标签数/实需标签数 三列，但当前重建库 `采购入仓明细单`/`物料资料` 均无对应字段，**无数据源**——经确认省略这三列，只做有数据的列。

## 关键实现
- 后端零新表：`PurchaseReceiptService` 加 `LabelQueryDetailAsync`/`LabelQuerySummaryAsync`(采购入仓明细单 JOIN 采购入仓单·半开日期区间·审核情况片段 `ApprovalFilter`)；`PurchaseReceiptController` 加 `GET label-query/detail|summary`。无价格列故无脱敏。
- 前端零新基础组件：复用 `MaterialDocDetailDrawer`(传 cfg=`MATERIAL_DOC_CONFIGS["purchase-receipts"]` + 单号)、`tableExport`(导出/打印)、物料分类下拉。纯逻辑抽 `utils/materialLabelQuery.ts` `buildLabelQuery`(ALL/全部/空串→undefined)。
- 菜单 `M("来料标签查询","/material-label-query","采购入仓单")`，挂「采购入仓单」既有权限。

## 测试
- 后端 `MaterialLabelQueryDbTests`×4：明细映射、汇总按 编号+规格+颜色 合并累加(跨已/未审核)、审核情况过滤、类别/keyword/日期过滤。
- 前端 `materialLabelQuery.test.ts`×4：参数归一化。
- 全量：后端 311 过、前端 54 过、build ✓。
- E2E(puppeteer `tmp/shot/label-e2e.cjs`)：种 RKDEMO 入仓单 → 明细渲染 → 双击打开采购入仓单整单抽屉。

## 备注
- dev DB 留演示单 `RKDEMO`(2 行收缩膜)供肉眼验证，可删。
