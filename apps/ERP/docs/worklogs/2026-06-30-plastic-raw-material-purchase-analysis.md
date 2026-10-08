# 原料采购分析表(⑪原料仓库占位落地) · 2026-06-30

## 做了什么
⑪ 原料仓库「原料采购分析表」只读**汇总**报表。按原料编号交叉 **库存**(塑胶原料资料)与 **生产需求**(原料生产需求表·审核1)→ **可购数量 = 生产需求 + 安全库存 − 库存**(采购缺口·红色)。**零新表**。
- **后端**(扩 `PlasticRawMaterialMasterService`):`PurchaseAnalysisAsync(物料类别,keyword,onlyBuy)`——dm 子查询 `原料生产需求明细单 d JOIN 原料生产需求表 h`(审核1)按 原料编号 `SUM(需求数量KG)=生产需求`(先聚合·1:1),LEFT JOIN `塑胶原料资料 m` ON dm.原料编号=m.物料编号,外层 `GROUP BY m.物料编号`,可购数量=`MAX(安全库存)+MAX(生产需求)−MAX(库存)`,HAVING onlyBuy(可购>0)。新 `PlasticRawMaterialPurchaseAnalysisController`(`api/plastic-raw-material-purchase-analysis`·Menu 原料采购分析表·无脱敏[无价])。新 DTO(9列)。MenuCatalog `("原料仓库","原料采购分析表")`;admin 9 位权限种子(新文件名·先确认未撞)。DI 复用 PlasticRawMaterialMasterService。
- **前端**(新报表页·镜像 物料发外欠数表):`api/plasticRawMaterialPurchaseAnalysis.ts` + `PlasticRawMaterialPurchaseAnalysisPage`(物料类别 Select[复用 categories]+keyword+**只看可购 Checkbox**+导出/打印·列 当前库存/安全库存/生产需求(KG)/**可购数量>0 红色**·无脱敏)+ App 路由 + menuTree 三参。

## 决策(AskUserQuestion)
可购数量=生产需求+安全库存−库存(含安全库存·补货点逻辑);按原料编号汇总+物料类别过滤+只看可购+导出打印·无日期(快照)。

## 执行(subagent-driven)
spec→plan→子代理 Task1 后端(`19ea613`)/Task2 测试(`dae7de3`·409绿)/Task3 前端(`16e70f7`·tsc0+vitest54)/Task4 Release冒烟+终审。**终审:opus 子代理因 ECONNRESET 中断(仅 12 工具调用即断)→ lead 直审**:直读 Service SQL(dm 先聚合 GROUP BY 原料编号→LEFT JOIN→外层 GROUP BY 物料编号·可购=安全+需求−库存·HAVING·全参数化)+ Controller(打开门控·无脱敏)+ scope(seed 新文件名无撞·LedgerUnion 未改·additive 12文件)+ 冒烟全绿 → 确认 READY。

## 测试 / 验证
- 后端 `PlasticRawMaterialPurchaseAnalysisServiceDbTests`(种 RA-PA 库存10/安全5+需求8→可购3 · RB-PB 库存100→可购−87被onlyBuy排除 · 类别过滤 · keyword含两者)。全量 **后端 409**(407+2)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:RA 可购3=需求8+安全5−库存10 / RB 可购−87 被 onlyBuy 排除 / 物料类别命中+不命中过滤。

## 合并
分支 `feat-plastic-raw-material-purchase-analysis`(4 提交)→ `--no-ff` 合并 master `be70962`,分支已删。12 文件 +684/−1。

## 教训/记录
- **原料链路成型并互通**:塑胶原料资料(主数据·库存/安全库存)→ 原料生产需求表(需求·审核1)→ 原料采购分析表(可购=需求+安全库存−库存)。三者数据互通,采购分析直接用前两者。
- opus 终审偶发 ECONNRESET 中断:本次因增量是已 opus 通过的 ShortageAsync 模式克隆 + 冒烟精确验证公式(3 / −87),lead 直审 SQL/控制器/范围替代,不再重派 opus。
- 种子文件名先 grep 确认未占用(连续两次执行此检查·上次撞车教训持续生效)。

## 下一步
⑩发外加工 生产加工缺料表(最后一项);⑪原料仓库余下(原料采购订单/进度表/出入库单/盘点等);⑫原料报表;⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
