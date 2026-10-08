# 塑胶标签查询(P4 塑胶报表第七张)· 2026-06-27

## 做了什么
塑胶物料单(标签)的**只读两 Tab 查询**:汇总查询(按 款号+工模编号+物料编号+颜色+货号 GROUP·SUM 订购数量·标签按款号/工模口径)+ 明细查询(逐行);按 日期区间 + 审核情况 + 物料类别 + 关键词过滤;明细双击复用 `PlasticMaterialDocDrawer` 按单号开整单。**无价格列 → 无脱敏**(纯数量)。
- **后端**(扩 P2 `PlasticMaterialDocService`):`LabelQueryDetailAsync` + `LabelQuerySummaryAsync`,**复用已存在的 `ApprovalFilter`**(塑胶订购单查询时加的 private static·不重定义)。明细 JOIN 链 `塑胶物料明细单 d JOIN 塑胶物料单 h`(日期/审核)`LEFT JOIN 生产制单 p ON 生产单号`(款号·**UNIQUE 1:1**)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(单位)。明细列 日期/单号/款号/工模编号/物料编号/物料名称/货号 AS 塑胶货号/颜色/单位/订购数量 AS 数量/备注/审核;汇总 GROUP BY 款号+工模编号+物料编号+颜色+货号。新 `PlasticLabelQueryController`(`api/plastic-label-query`·`/detail`+`/summary`·菜单 塑胶标签查询)·**无脱敏**(无价格列)仅 `打开` 守卫。MenuCatalog + 种子。
- **前端**(克隆刚建的 `PlasticOrderQueryPage` 去价格/hidePrice):`PlasticLabelQueryPage`——上月/本月/下月+RangePicker(默认本月)+审核情况下拉(全部/已审核/未审核)+物料类别下拉(`categories()`)+关键词+导出EXCEL/打印(按当前 Tab);两 Tab 明细+汇总;明细 `onDoubleClick` → `PlasticMaterialDocDrawer open 单号` 只读看整单。`api/plasticLabelQuery.ts` typed。

## 决策(AskUserQuestion)
**省略三个标签列 每箱数量/预计标签数/实需标签数**(塑胶物料明细单/塑胶共用物料表/塑胶物料资料 均无数据源·同物料侧 来料标签查询当时处理);v1 省略 物料查询(共用物料)切换(同塑胶订购单查询)。**关键观察:原系统标签查询无价格列**(无加工单价/金额)→ 本张无脱敏,比订购单查询更简单。

## 执行(subagent-driven)
brainstorming(先探数据源:确认 每箱数量/预计/实需 三列无源·确认无价格列)→ spec → writing-plans(3任务·全码·复用 ApprovalFilter)→ 子代理。Task1 后端(顺利·368·确认 ApprovalFilter 已存在并复用·**子代理为重建 Release 杀掉占用 DLL 的 dev 后端**)/Task2 前端(顺利·54·tsc 干净·去 hidePrice·menuTree 占位存在已替换)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(9 项全 PASS·重点 #1 两 LEFT JOIN 1:1·#3 ApprovalFilter 仅调用不重定义无重复成员·#4 无价格列 grep 零命中故无脱敏不泄露·#7 测试含 款号总表 FK 父行顺序)。

## 测试 / 验证
- 后端 `PlasticLabelQueryServiceDbTests`(种 款号总表→塑胶物料资料[单位]→生产制单[款号]→塑胶物料单[审核1]→明细 2 行 → detail 2 行带款号/工模/塑胶货号/单位·summary 数量8 + 审核情况/物料类别/keyword/区间外过滤·反序清理)。全量 **后端 368**(367+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种链(款号总表 K-LQS 父先)→ `GET /api/plastic-label-query/detail?keyword=LQSPM` → 2 行 款号K-LQS/工模GMS/塑胶货号H-LQS/单位kg/备注;`/summary` → 数量8/款号K-LQS/工模GMS;`&审核情况=未审核` 空。**起后端用 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`**(上张教训前置·一次过)。

## 合并
分支 `feat-plastic-label-query`(2 提交)→ `--no-ff` 合并 master `4357e10`,分支已删。10 文件 +319/−1。

## 教训/记录
- `ApprovalFilter` 已成 `PlasticMaterialDocService` 内共用 helper(订购单查询+标签查询共用)。后续塑胶物料单系查询直接复用。
- content root 坑前置成功(`--contentRoot 输出目录`),一次起对。生产制单.款号 FK→款号总表(种父反序清)。

## 下一步
P4 余下塑胶报表(库存月报表/各单据查询 入仓/退仓/领料/退料/报废/盘点 查询等)。**塑胶物料单系两 Tab 查询模式**(后端 Detail/Summary 双方法+复用 ApprovalFilter·前端克隆 PlasticOrderQueryPage·按需去脱敏)已极稳固。
