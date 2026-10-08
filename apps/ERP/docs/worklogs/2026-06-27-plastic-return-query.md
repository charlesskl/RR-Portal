# 塑胶退料查询(塑胶各单据查询 4 张之②)· 2026-06-27

## 做了什么
塑胶退料单 只读两 Tab 查询(汇总按生产单号 + 明细)+ 双击只读抽屉。**①塑胶领料查询的克隆**,换数据源到 塑胶退料单/明细。
- **后端**(扩 `PlasticReturnService`):`ApprovalFilter` + `ReturnQueryDetail/SummaryAsync`,克隆领料查询 SQL,差异:表 塑胶退料明细单/塑胶退料单、头 退料部门/退料人、**塑胶货号=d.[塑胶货号]**(退料明细自带·MAX(d.[塑胶货号]) 汇总)、**无 装配采购**(退料明细无此列)、共用货号=cm.塑胶货号/共用物料=cm.共用原料编号(LEFT JOIN 共用物料表 1:1)。新 `PlasticReturnQueryController`(`api/plastic-return-query`·菜单 塑胶退料查询·脱敏)。
- **前端**:`PlasticReturnQueryPage`+`PlasticReturnDetailDrawer`+`api/plasticReturnQuery.ts`,克隆领料查询换退料(头 退料部门/退料人·明细删 装配采购列)。

## 执行
spec/口径继承①·plan(克隆清单)→ 子代理 Task1 后端(372·factory/ctor 确认·退料明细列核对无装配采购自带塑胶货号)/Task2 前端(54·tsc 干净)/Task3 冒烟+终审+合并。**opus 终审 READY**(9 项·退料 delta 正确·Issue 模板未动·库存未动)。

## 测试 / 验证
- 后端 `PlasticReturnQueryServiceDbTests`(克隆领料查询测试换退料·种 共用物料表/物料资料/退料单/明细 → Detail 退料部门/人/共用货号/共用物料/塑胶货号 + Summary 数量8 + 审核/物料类别/keyword/区间)。全量 **后端 372**(371+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:detail 共用货号 H-RS/共用物料 CR-RS/退料部门 D-RS/退料人 P-RS;summary 数量 8;未审核空。

## 合并
分支 `feat-plastic-return-query`(2 提交)→ `--no-ff` 合并 master `7657ca1`,分支已删。11 文件 +408/−1。

## 下一步
③塑胶报废查询(塑胶报废单·头报废部门/报废人·**汇总按物料编号非生产单号**)④塑胶盘点查询(系统数量/盘点数量/盈亏数量·汇总聚合不同)。
