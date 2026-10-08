# 盘点单查询 · 2026-06-24

## 做了什么
复刻原系统「盘点单查询」(仓库报表组)——对 `盘点单/盘点明细单`(物料盘点 MaterialStocktake) 的只读查询报表页，菜单占位项 `M("库存盘点查询")` 落地 `/material-stocktake-query`。报废单查询的纵切克隆，换数据源到盘点。

- **明细列**：日期/单号/物料编号/物料名称/规格/材料/颜色/单位/**系统数量/盘点数量/盈亏数量**/单价/金额/备注/审核。
- **汇总查询**：按 **物料编号+规格+颜色** 合并，列 物料.../**系统数(SUM)/盘点数(SUM)/盈亏数(SUM)**/单价/金额。
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况(全部/已审核/未审核) + 物料类别 + 关键词 + 导出EXCEL + 打印。
- **明细双击 `单号` 开专用只读抽屉 `MaterialStocktakeDetailDrawer`**(复用 `GET /material-stocktakes/{单号}`)。

## 与最近 7 个查询页的关键差异 = **带价**
最近的报废/退料/领料等查询页都「无价格」，但原系统盘点单查询**带 单价/金额**两列：
- 盘点明细表本身无价 → **颜色/材料(物料类别)/单价 LEFT JOIN `物料资料` 带出**(同库存统计表 `2b1efa6` 的 JOIN 子查询写法)。
- **金额 = 盈亏数 × 单价**(体现盘盈盘亏的库存调整价值，用户确认口径)。
- 价格按 `PermissionAction.单价` 权限脱敏(无权限则后端把 单价/金额 置 null → 前端显示 `***`)，同采购订单查询 `a0e6380`。

## 为何另建专用抽屉(不复用 MaterialDocDetailDrawer)
通用 `MaterialDocDetailDrawer` 的明细列写死成 数量/单价/金额，不适配盘点的 系统/盘点/盈亏 三列；盘点又是独立单据(非 MATERIAL_DOC_CONFIGS)。故新建 47 行只读 `MaterialStocktakeDetailDrawer`，渲染 单头 + 系统/盘点/盈亏 明细，盘点无价不显示价格列。

## 关键实现
- 后端零新表:`MaterialStocktakeService` 加 `StocktakeQueryDetailAsync`/`StocktakeQuerySummaryAsync`(盘点明细单 JOIN 盘点单 + LEFT JOIN 物料资料子查询·半开日期·`ApprovalFilter`;汇总 GROUP BY 物料编号+规格+颜色+单价)。`MaterialStocktakeController` 加 `GET stocktake-query/detail|summary`,按「单价」权限脱敏。
- 前端复用 `buildLabelQuery`/`tableExport`;新 `api/materialStocktakeQuery.ts` + 页 `MaterialStocktakeQueryPage.tsx`;`materialStocktake.ts` 加 `get(单号)` + `MSDetail/MSLineRow` 类型。
- 菜单 `M("库存盘点查询","/material-stocktake-query","盘点单")`,挂既有「盘点单」权限。

## 测试
- 后端 `MaterialStocktakeServiceDbTests` 新增 ×2:盈亏(-20)+金额(=盈亏×单价=-200) 口径、审核情况过滤(新建未审核 → 「已审核」过滤掉/「未审核」保留)。
- 全量:后端 **328** 全过、前端 **54** 全过、tsc/build ✓。冒烟:登录后 `GET detail|summary` 200(空库 `[]`)、日期/关键词过滤 200。
- lint:新文件仅触发与克隆源 `MaterialScrapQueryPage`/`MaterialDocDetailDrawer` 完全相同的 `set-state-in-effect` 基线惯例,无新偏差。

## 合并
分支 `feat-material-stocktake-query` → `--no-ff` 合并 master(`eff6973`,特性提交 `5465b06`)。
