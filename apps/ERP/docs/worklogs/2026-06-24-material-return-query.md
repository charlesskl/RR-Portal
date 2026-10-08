# 退料单查询 · 2026-06-24

## 做了什么
复刻原系统「退料单查询」(仓库报表组)——对 `退料单/退料明细单` 的只读查询报表页(无价格)，菜单占位项落地 `/material-return-query`。领料单查询的同构克隆，换数据源到退料。

- **明细列**：生产单号/款号/日期/单号/退料部门/退料人/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核。
- **汇总查询**：按 **生产单号+物料编号+规格+颜色** 合并(对齐原系统截图「汇总查询: 按生产单号」勾选态)，列 生产单号/款号/物料编号/物料名称/规格/材料/颜色/单位/**退料数量**。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况 + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击复用 `MaterialDocDetailDrawer`(退料单)看整单**。

## 省略「装配采购」列
原系统明细有「装配采购」(=类型)列，但重建库 `退料明细单` 无 类型 字段(无数据源)——省略，与之前标签列同理。

## 关键实现
- 后端零新表：`MaterialReturnService` 加 `ReturnQueryDetailAsync`/`ReturnQuerySummaryAsync`(退料明细单 JOIN 退料单·半开日期·审核情况ApprovalFilter；汇总 GROUP BY 生产单号+物料编号+规格+颜色)。`MaterialReturnController` 加 `GET return-query/detail|summary`。
- 前端复用 `buildLabelQuery`/`MaterialDocDetailDrawer`/`tableExport`；新 `api/materialReturnQuery.ts` + 页 `MaterialReturnQueryPage.tsx`。双击用 `单号`(=退料单号)。
- 菜单 `M("退料单查询","/material-return-query","退料单")`，挂既有权限。

## 测试
- 后端 `MaterialReturnQueryDbTests`×3：明细+退料部门/退料人映射、汇总按生产单号+物料合并(退料数量·跨已/未审核)、审核情况/日期过滤。
- 前端复用已覆盖的 `buildLabelQuery`，无新增纯逻辑。
- 全量：后端 323 过、前端 54 过、build ✓。E2E `tmp/shot/treturn-e2e.cjs`：明细渲染 + 双击开退料单整单。

## 备注
- dev DB 留演示单 `TLDEMO`(2 行·车缝部/李四)供验证，可删。
