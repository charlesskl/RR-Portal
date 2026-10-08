# 塑胶报废查询(塑胶各单据查询 4 张之③)· 2026-06-27

## 做了什么
塑胶报废单 只读两 Tab 查询(**汇总按物料编号** + 明细)+ 双击只读抽屉。**②塑胶退料查询的克隆**,换数据源到 塑胶报废单/明细。
- **后端**(扩 `PlasticScrapService`):`ApprovalFilter` + `ScrapQueryDetail/SummaryAsync`,克隆退料查询,差异:表 塑胶报废明细单/塑胶报废单、头 报废部门/报废人、**汇总 GROUP BY 物料编号+颜色(非生产单号)·Summary Row 去 生产单号/款号**(明细仍保留)。塑胶货号=d.[塑胶货号]·共用货号=cm.塑胶货号·共用物料=cm.共用原料编号。新 `PlasticScrapQueryController`(`api/plastic-scrap-query`·菜单 塑胶报废查询·脱敏)。
- **前端**:`PlasticScrapQueryPage`+`PlasticScrapDetailDrawer`+`api/plasticScrapQuery.ts`,克隆退料查询换报废(头 报废部门/报废人·汇总列去 生产单号/款号)。

## 执行
plan(克隆②·汇总改物料编号)→ 子代理 Task1 后端(373)/Task2 前端(54·tsc 干净)/Task3 冒烟+合并。**opus 终审子代理中途 API 断连**,改 lead 直审关键 delta:Summary SQL GROUP BY 物料编号+颜色·非分组列全 MAX/SUM(数量 SUM·单价 MAX·金额 SUM)·DTO 无生产单号/款号·SQL 合法;与冒烟(单行·数量8)+ 已 opus 终审的②模板一致 → 判定 READY 合并。

## 测试 / 验证
- 后端 `PlasticScrapQueryServiceDbTests`(种 共用物料表/物料资料/报废单/明细 → Detail 报废部门/人/共用货号/共用物料/塑胶货号 + Summary 单行数量8 + 审核/物料类别/keyword/区间)。全量 **后端 373**(372+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:detail 共用货号 H-BS/共用物料 CR-BS/报废部门 D-BS/报废人 P-BS;summary **单行(按物料编号)** 数量 8;未审核空。

## 合并
分支 `feat-plastic-scrap-query`(2 提交)→ `--no-ff` 合并 master `45b5663`,分支已删。11 文件 +403/−1。

## 下一步
④塑胶盘点查询(最后一张·塑胶盘点单·**系统数量/盘点数量/盈亏数量**+单价+金额·汇总按物料编号·镜像物料侧盘点查询带专用抽屉)。
