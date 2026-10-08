# 塑胶领料查询(塑胶各单据查询 4 张之①)· 2026-06-27

## 做了什么
塑胶领料单 只读两 Tab 查询(汇总按生产单号 + 明细)+ 明细双击只读抽屉。**带价脱敏**。确立 4 张塑胶单据查询(领料/退料/报废/盘点)模板。
- **后端**(扩 `PlasticIssueService`):`ApprovalFilter` + `IssueQueryDetailAsync`/`IssueQuerySummaryAsync`。`塑胶领料明细单 d JOIN 塑胶领料单 h`(日期/领料部门/领料人/审核)`LEFT JOIN (塑胶共用物料表 GROUP BY 物料编号) cm`(**共用货号=cm.塑胶货号·共用物料=cm.共用原料编号·塑胶货号列也取 cm.塑胶货号**)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(物料类别);两子查询 1:1 不放大。汇总 GROUP BY 生产单号+款号+物料编号+颜色(MAX/SUM)。新 `PlasticIssueQueryController`(`api/plastic-issue-query`·菜单 塑胶领料查询)·单价/金额脱敏(明细+汇总)。
- **前端**:两 Tab 页(镜像 PlasticOrderQueryPage·明细 18 列含 领料部门/领料人/装配采购/共用物料/共用货号·汇总 12 列)+ 新只读抽屉 `PlasticIssueDetailDrawer`(GET `plasticDocApi("plastic-issues")`·头领料部门/领料人/审核+明细·单价金额 hidePrice)。

## 决策(AskUserQuestion·跨 4 张)
共用货号=塑胶货号·共用物料=共用原料编号(LEFT JOIN 共用物料表);每单新建只读抽屉(镜像物料侧);省略 物料查询切换/精确/高级查询/表格设置。

## 执行(subagent-driven)
spec → plan(全码·SQL 入 spec)→ 子代理 Task1 后端(371·factory/ctor 确认·列全在含装配采购)/Task2 前端(54·tsc 干净·抽屉 plasticDocApi 返 {单头,明细} 确认)/Task3 冒烟+终审+合并。**opus 终审 READY**(9 项·重点 JOIN 1:1·共用映射别名对·汇总 GROUP 合法·脱敏两 Tab+抽屉无泄露·模板可复用)。

## 测试 / 验证
- 后端 `PlasticIssueQueryServiceDbTests`(种 共用物料表/物料资料/领料单/明细 → Detail 验共用货号/共用物料/领料部门人 + Summary 数量8 + 审核情况/物料类别/keyword/区间·免款号总表父行)。全量 **后端 371**(370+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:detail 2 行 共用货号 H-IS/共用物料 CR-IS/领料部门 D-IS/领料人 P-IS;summary 数量 8;未审核过滤空。Release 重建(锁先 Stop-Process)+ `--contentRoot 输出目录`。

## 合并
分支 `feat-plastic-issue-query`(2 提交)→ `--no-ff` 合并 master `a3b40c4`,分支已删。11 文件 +410/−1。

## 下一步
**②塑胶退料查询 ③塑胶报废查询 ④塑胶盘点查询** 照此模板克隆换数据源:退料(塑胶退料单·头退料部门/退料人·汇总退料数量)、报废(塑胶报废单·头报废部门/报废人)、盘点(塑胶盘点单·系统数量/盘点数量/盈亏数量·汇总聚合不同)。模板(JOIN 共用物料表/物料资料 + ApprovalFilter + 脱敏 + 只读抽屉)已立。
