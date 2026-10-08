# 加工领料进度表(⑩发外加工占位落地) · 2026-06-30

## 做了什么
⑩ 发外加工「加工领料进度表」只读报表——**= 采购加工明细表口径,实际源从 塑胶入仓明细单 换成 白件领料明细单**(发外加工的领料=白件领料·之前自建)。订购 `塑胶加工采购单明细` LEFT JOIN(`白件领料明细单 JOIN 白件领料单` 审核1·按 生产单号+物料编号+颜色 聚合)。**零新表**。
- **后端**(扩 `PlasticProcessPurchaseOrderService`):`IssueProgressAsync(加工厂,起,止,keyword,完成情况)`——rk 子查询 `SUM(数量)=领料数量·MAX(单号)=领料单号·MAX(h.日期)=领料日期`(白件领料**无价→无领料金额**);未完成数量=订购−领料、**未完成金额=未完成数量×订购单价**(派生)、完成情况 CASE;完成情况过滤 done=-1/0/1。新 `PlasticProcessIssueProgressController`(`api/plastic-process-issue-progress`·Menu 加工领料进度表·**无单价权限置 单价/订购金额/未完成金额=null**)。新 DTO `PlasticProcessIssueProgressRow`(22列)。MenuCatalog 加项 + admin 9 位权限种子(两库)。DI 复用。
- **前端**(克隆 `PlasticProcessPurchaseDetailPage`·入仓列→领料列·去入仓金额):`api/plasticProcessIssueProgress.ts` + `PlasticProcessIssueProgressPage`(领料日期/领料单号/领料数量/审核情况[派生 领料数量>0→已审核]/未完成/完成情况·金额脱敏 单价/订购金额/未完成金额 columns+exportCols 同步·完成情况 Select·上月/本月/下月+RangePicker+加工厂+keyword+导出/打印)+ App 路由 + menuTree line120 三参。

## 决策(AskUserQuestion)
领料源=白件领料单(无单价/金额);领料金额省略·未完成金额=未完成数量×订购单价;明细表式(领料日期/领料单号/完成情况·镜像采购加工明细表)。

## 执行(subagent-driven)
spec→plan→子代理 Task1 后端(`9f43aaa`)/Task2 测试(`9963563`·399绿)/Task3 前端(`4dc0235`·tsc0+vitest54)/Task4 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:领料子查询先聚合不放大/未完成金额=未完成数×订购单价[非订购金额−领料金额因领料无价]/完成情况三态过滤/金额脱敏columns+exportCols同步[审核情况用领料数量派生]/菜单权限齐/DTO↔SQL↔前端22列一致/全参数化·**未动 ProgressAsync/PurchaseDetailAsync/LedgerUnion**)。

## 测试 / 验证
- 后端 `PlasticProcessIssueProgressServiceDbTests`(种 订购8单价3 + 白件领料5 审核1 同生产单号+物料+颜色 → 领料5/未完成3/未完成金额9[=3×3]/领料单号BJL-IP-1/领料日期非空/完成情况未完成 + 完成情况过滤 + 加工厂/keyword)。全量 **后端 399**(397+2)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购8/领料5/未完成3/未完成金额9/领料单号BJL-IP-SMK/完成情况未完成 + 完成情况过滤。

## 合并
分支 `feat-plastic-process-issue-progress`(4 提交)→ `--no-ff` 合并 master `5d471d1`,分支已删。12 文件 +860/−1。

## 教训/记录
- **进度/明细报表"实际源"可换**:采购加工进度/明细=订购 vs 入仓(塑胶入仓);加工领料进度=订购 vs 领料(白件领料)。同一订购源(塑胶加工采购单明细)+ 同口径聚合(生产单号+物料编号+颜色),换 rk 子查询源表即可。
- 源单无价(白件领料)→ 实际金额列省略,未完成金额改用 数量差×订购单价 派生。

## 下一步
⑩发外加工余下(物料发外欠数表/生产加工缺料表);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
