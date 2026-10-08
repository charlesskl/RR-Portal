# 采购退仓单查询 · 2026-06-24

## 做了什么
复刻原系统「采购退仓单查询」——对 `采购退仓单/采购退仓明细单` 的只读查询报表页(无价格)，菜单占位项落地 `/purchase-return-query`。采购入仓查询的同构克隆，换数据源到退仓，明细列比入仓查询少 入库单号/订单单号。

- **明细列**：日期/单号/供应商编号/供应商名称/生产单号/款号/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核。
- **汇总查询**：按 物料编号+规格+颜色 合并，列名 **退仓数量**(=SUM 数量)。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况 + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击复用 `MaterialDocDetailDrawer`(采购退仓单)看整单**。

## 关键实现
- 后端零新表：`PurchaseReturnService` 加 `ReturnQueryDetailAsync`/`ReturnQuerySummaryAsync`(采购退仓明细单 JOIN 采购退仓单·半开日期·审核情况ApprovalFilter·供应商 COALESCE 明细兜底单头)。`PurchaseReturnController` 加 `GET return-query/detail|summary`。
- 前端复用 `buildLabelQuery`/`MaterialDocDetailDrawer`/`tableExport`；新 `api/purchaseReturnQuery.ts` + 页 `PurchaseReturnQueryPage.tsx`。双击用 `单号`(=退仓单号)。
- 菜单 `M("采购退仓查询","/purchase-return-query","采购退仓单")`，挂既有权限。

## 测试
- 后端 `PurchaseReturnQueryDbTests`×3：明细+供应商映射、汇总退仓数量合并(跨已/未审核)、审核情况/类别/日期过滤。
- 前端复用已覆盖的 `buildLabelQuery`，无新增纯逻辑。
- 全量：后端 317 过、前端 54 过、build ✓。E2E `tmp/shot/return-e2e.cjs`：明细渲染 + 双击开采购退仓单整单。

## 已知未做(原系统有，暂缓)
- 汇总查询的「按供应商」切换(截图 汇总Tab 有此 checkbox)：当前只做按物料汇总。需要可再加。

## 备注
- dev DB 留演示单 `CTDEMO`(2 行收缩膜退货)供验证，可删。
