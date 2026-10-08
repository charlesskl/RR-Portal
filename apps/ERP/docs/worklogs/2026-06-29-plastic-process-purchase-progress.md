# 采购加工进度表(⑩发外加工占位落地) · 2026-06-29

## 做了什么
⑩ 发外加工「采购加工进度表」只读报表——**镜像现有 塑胶进度表**(`PlasticPurchaseOrderService.ProgressAsync`/`PlasticPurchaseProgressPage`),订购源从 塑胶采购订单明细 换成 **塑胶加工采购单明细**(发外加工采购),入仓实际来自 **塑胶入仓明细单**(=加工入仓·审核1·按 生产单号+物料编号+颜色 聚合),算 剩余数量=订购−入仓、剩余金额=订购金额−入仓金额。金额脱敏。**零新表**(源单/入仓表全已建)。
- **后端**(扩 `PlasticProcessPurchaseOrderService`):`ProgressAsync(加工厂,起,止,keyword,onlyOwed)`·JOIN链 `塑胶加工采购单明细 d JOIN 塑胶加工采购单 o LEFT JOIN 塑胶物料资料(单位) LEFT JOIN (塑胶入仓明细单 r JOIN 塑胶入仓单 h·审核1·GROUP BY 生产单号+物料编号+ISNULL(颜色,'')·SUM数量/SUM金额) rk`。新 `PlasticProcessPurchaseProgressController`(`api/plastic-process-purchase-progress`·Menu 采购加工进度表·**无单价权限置 单价/订购金额/入仓金额/剩余金额=null**)。DTO `PlasticProcessPurchaseProgressRow`(21列)。MenuCatalog 加项 + admin 9 位权限种子(两库)。DI 复用已注册 service。
- **前端**(克隆 `PlasticPurchaseProgressPage`):`api/plasticProcessPurchaseProgress.ts` + `PlasticProcessPurchaseProgressPage`(列加 加工内容/单价/订购金额/入仓金额/剩余金额·`hidePrice` 时这四价列从 columns+exportCols 同步隐藏·加工厂Input·上月/本月/下月+RangePicker+只看欠数+keyword+导出EXCEL/打印 tableExport)+ App 路由 `plastic-process-purchase-progress` + menuTree line118 三参。

## 决策(AskUserQuestion)
关联键=生产单号+物料编号+颜色(镜像现有塑胶进度表);v1=明细平铺+订购/入仓/剩余(数量+金额)+只看欠数+日期工具栏+加工厂+导出打印(省汇总Tab/双击进单/表格设置)。订购不滤审核带审核列。

## 执行(subagent-driven)
brainstorm(发现:加工入仓=塑胶入仓·进度=塑胶进度表同构)→spec→plan→子代理 Task1 后端(`f42ee7e`)/Task2 测试(`0c74281`·395绿)/Task3 前端(`de0f471`·tsc0+vitest54)/Task4 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:关联键与现有同口径/入仓子查询先聚合不放大/剩余计算/金额脱敏columns+exportCols同步/过滤齐/DTO↔SQL↔前端21列一致/全参数化)。

## 测试 / 验证
- 后端 `PlasticProcessPurchaseProgressServiceDbTests`(种 加工采购单订购8单价3金额24 + 塑胶入仓同生产单号+物料+颜色数量5金额15 → 入仓5/剩余3/入仓金额15/剩余金额9/单位个/加工内容喷油 + onlyOwed/加工厂命中不命中/keyword)。全量 **后端 395**(393+2)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购8/入仓5/剩余3/入仓金额15/剩余金额9 + onlyOwed含 + 加工厂过滤含。

## 合并
分支 `feat-plastic-process-purchase-progress`(4 提交)→ `--no-ff` 合并 master `dfa28cf`,分支已删。12 文件 +872/−1。

## 教训/记录
- **进度表口径成型**:订购明细 LEFT JOIN (入仓明细先按 生产单号+物料编号+颜色 GROUP BY 聚合) → 1:1 不放大订购行 → 剩余=订购−入仓。塑胶采购进度表/采购加工进度表同构,仅订购源不同(塑胶采购订单明细 vs 塑胶加工采购单明细)。
- 金额脱敏须 columns + exportCols **两处同步**隐藏,否则导出泄露。

## 下一步
⑩发外加工余下(采购加工明细表/加工领料进度表/物料发外欠数表/生产加工缺料表);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
