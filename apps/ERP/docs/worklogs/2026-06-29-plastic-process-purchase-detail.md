# 采购加工明细表(⑩发外加工占位落地) · 2026-06-29

## 做了什么
⑩ 发外加工「采购加工明细表」只读报表——**= 采购加工进度表口径 + 入仓单据列(入仓日期/入仓单号/审核情况)+ 未完成(=订购−入仓)+ 完成情况(可过滤)**。同口径:订购 `塑胶加工采购单明细` LEFT JOIN(`塑胶入仓明细单` 审核1·按 生产单号+物料编号+颜色 聚合·**新加 MAX(单号)=入仓单号、MAX(h.日期)=入仓日期**)。**零新表**。
- **后端**(扩 `PlasticProcessPurchaseOrderService`):`PurchaseDetailAsync(加工厂,起,止,keyword,完成情况)`——在 ProgressAsync 的 rk 子查询基础上加 MAX(单号)/MAX(日期);未完成数量=订购−入仓、未完成金额=订购金额−入仓金额、完成情况=`CASE 未完成<=0→已完成 ELSE 未完成`;完成情况过滤 `done=-1/0/1`(全部/未完成/已完成)。新 `PlasticProcessPurchaseDetailController`(`api/plastic-process-purchase-detail`·Menu 采购加工明细表·**无单价权限置 单价/订购金额/入仓金额/未完成金额=null**)。新 DTO `PlasticProcessPurchaseDetailRow`(23列)。MenuCatalog 加项 + admin 9 位权限种子(两库)。DI 复用已注册 service。
- **前端**(克隆 `PlasticProcessPurchaseProgressPage`):`api/plasticProcessPurchaseDetail.ts` + `PlasticProcessPurchaseDetailPage`(加 入仓日期/入仓单号/审核情况[派生:入仓数量>0→已审核]列·剩余→未完成·**完成情况 Select 全部/已完成/未完成**·金额脱敏 columns+exportCols 同步·上月/本月/下月+RangePicker+加工厂+keyword+导出/打印)+ App 路由 `plastic-process-purchase-detail` + menuTree line119 三参。

## 决策(AskUserQuestion)
粒度=订购行 1:1·入仓聚合(入仓单号取 MAX·入仓日期取 MAX(h.日期));v1=明细平铺+订购/入仓/未完成(数量+金额)+完成情况过滤+日期工具栏+加工厂+导出打印(省一对多展开/双击抽屉/汇总Tab)。

## 执行(subagent-driven)
spec→plan→子代理 Task1 后端(`c3c39eb`)/Task2 测试(`df49e52`·397绿)/Task3 前端(`1a2e352`·tsc0+vitest54)/Task4 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:入仓子查询先聚合不放大[加MAX两列同层合法]/未完成+完成情况计算/完成情况三态过滤/金额脱敏columns+exportCols同步[审核情况用入仓数量派生不泄露]/菜单权限齐/DTO↔SQL↔前端23列一致/全参数化·**未动 ProgressAsync 与 LedgerUnion**)。

## 测试 / 验证
- 后端 `PlasticProcessPurchaseDetailServiceDbTests`(种 订购8 + 入仓5 同生产单号+物料+颜色 → 入仓5/未完成3/未完成金额9/入仓单号SR-PD-1/入仓日期非空/完成情况未完成 + 完成情况已完成排除·未完成含 + 加工厂/keyword)。全量 **后端 397**(395+2)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购8/入仓5/未完成3/入仓单号SR-PD-SMK/完成情况未完成 + 完成情况过滤(已完成过滤掉·未完成含)。

## 合并
分支 `feat-plastic-process-purchase-detail`(4 提交)→ `--no-ff` 合并 master `c335721`,分支已删。12 文件 +887/−1。

## 教训/记录
- **采购加工进度表 vs 明细表**:同一入仓聚合口径,明细表多 入仓日期/入仓单号(MAX)/审核情况(派生)/完成情况(可过滤)。两者并存(原系统两个菜单)。
- 审核情况列前端用 入仓数量>0 派生「已审核」,免后端多带列、也不泄露金额。

## 下一步
⑩发外加工余下(加工领料进度表/物料发外欠数表/生产加工缺料表);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
