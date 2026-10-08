# 报废单查询 · 2026-06-24

## 做了什么
复刻原系统「报废单查询」(仓库报表组)——对 `报废单/报废明细单` 的只读查询报表页(无价格)，菜单占位项落地 `/material-scrap-query`。退料单查询的同构克隆，换数据源到物料报废(MaterialScrap)。

- **明细列**：生产单号/款号/日期/单号/报废部门/报废人/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核。
- **汇总查询**：按 **生产单号+物料编号+规格+颜色** 合并(对齐原系统「汇总查询: 按生产单号」勾选态)，列 生产单号/款号/物料.../**报废数量**。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况 + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击复用 `MaterialDocDetailDrawer`(报废单)看整单**。

## 省略「装配采购」列
原系统明细有「装配采购」(=类型)列，但 `报废明细单` 无 类型 字段(无数据源)——省略，与退料单查询同理。

## 关键实现
- 后端零新表：`MaterialScrapService` 加 `ScrapQueryDetailAsync`/`ScrapQuerySummaryAsync`(报废明细单 JOIN 报废单·半开日期·审核情况ApprovalFilter；汇总 GROUP BY 生产单号+物料编号+规格+颜色)。`MaterialScrapController` 加 `GET scrap-query/detail|summary`。
- 前端复用 `buildLabelQuery`/`MaterialDocDetailDrawer`/`tableExport`；新 `api/materialScrapQuery.ts` + 页 `MaterialScrapQueryPage.tsx`。双击用 `单号`(=报废单号)。
- 菜单 `M("报废单查询","/material-scrap-query","报废单")`，挂既有权限。

## 测试
- 后端 `MaterialScrapQueryDbTests`×3：明细+报废部门/报废人映射、汇总按生产单号+物料合并(报废数量·跨已/未审核)、审核情况/日期过滤。
- 前端复用已覆盖的 `buildLabelQuery`，无新增纯逻辑。
- 全量：后端 326 过、前端 54 过、build ✓。E2E `tmp/shot/scrap-e2e.cjs`：明细渲染 + 双击开报废单整单。

## 备注
- dev DB 留演示单 `BFDEMO`(2 行·裁床部/王五)供验证，可删。
