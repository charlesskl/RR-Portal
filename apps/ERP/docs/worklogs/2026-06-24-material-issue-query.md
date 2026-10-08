# 领料单查询 · 2026-06-24

## 做了什么
复刻原系统「领料单查询」(仓库报表组)——对 `领料单/领料明细单` 的只读查询报表页(无价格)，菜单占位项落地 `/material-issue-query`。采购退仓单查询的同构克隆，换数据源到领料，明细列换成领料专属(类型/领料部门/领料人，无供应商)。

- **明细列**：类型/日期/单号/生产单号/款号/领料部门/领料人/物料编号/物料名称/规格/材料/颜色/单位/数量/备注/审核。
- **汇总查询**：按 物料编号+规格+颜色 合并，列名 **领用数量**(=SUM 数量)。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况 + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击复用 `MaterialDocDetailDrawer`(领料单)看整单**。

## 关键实现
- 后端零新表：`MaterialIssueService` 加 `IssueQueryDetailAsync`/`IssueQuerySummaryAsync`(领料明细单 JOIN 领料单·半开日期·审核情况ApprovalFilter)。`MaterialIssueController` 加 `GET issue-query/detail|summary`。
- 前端复用 `buildLabelQuery`/`MaterialDocDetailDrawer`/`tableExport`；新 `api/materialIssueQuery.ts` + 页 `MaterialIssueQueryPage.tsx`。双击用 `单号`(=领料单号)。
- 菜单 `M("领料单查询","/material-issue-query","领料单")`，挂既有权限。

## 测试
- 后端 `MaterialIssueQueryDbTests`×3：明细+类型/领料部门/领料人映射、汇总领用数量合并(跨已/未审核)、审核情况/keyword/日期过滤。
- 前端复用已覆盖的 `buildLabelQuery`，无新增纯逻辑。
- 全量：后端 320 过、前端 54 过、build ✓。E2E `tmp/shot/issue-e2e.cjs`：明细渲染 + 双击开领料单整单。

## 备注
- dev DB 留演示单 `LLDEMO`(2 行·车缝部/张三)供验证，可删。
