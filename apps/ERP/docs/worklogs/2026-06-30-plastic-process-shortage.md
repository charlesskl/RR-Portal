# 物料发外欠数表(⑩发外加工占位落地) · 2026-06-30

## 做了什么
⑩ 发外加工「物料发外欠数表」只读**汇总**报表。**欠数 = 加工采购订购 − 加工入仓**(同采购加工进度表口径·物料级汇总)。**零新表**。
- **后端**(扩 `PlasticProcessPurchaseOrderService`):`ShortageAsync(物料类别,审核情况,keyword,onlyOwed)`——`塑胶加工采购单明细 d JOIN 塑胶加工采购单 o` LEFT JOIN 入仓聚合(塑胶入仓明细单·审核1·生产单号+物料编号+颜色)/塑胶物料资料(单位/类别/名)/塑胶共用物料表(共用原料编号 cm)/物料资料按共用原料编号取名(cn=共用物料名)。**GROUP BY 物料编号+模具编号**·欠数=SUM(订购−入仓)·单价=MAX(订购单价)·金额=SUM(行欠数×行单价)·共用物料编号=MAX(cm.共用原料编号)。过滤 物料类别/审核情况(订购 o.审核)/keyword/onlyOwed(HAVING)。**坑:审核情况过滤用内联 switch(别名 o.),不调用写死 h. 的现有 ApprovalFilter**。新 `PlasticProcessShortageController`(`api/plastic-process-shortage`·Menu 物料发外欠数表·**单价/金额脱敏**)。新 DTO(10列)。MenuCatalog 加项 + admin 9 位权限种子(两库)。DI 复用。
- **前端**(新报表页):`api/plasticProcessShortage.ts` + `PlasticProcessShortagePage`(物料类别 Select 复用 `plasticMaterialMasterApi.categories()` + 审核情况 Select 全部/已审核/未审核 + keyword + 只看欠数 Checkbox + 导出/打印·金额脱敏 单价/金额 columns+exportCols 同步)+ App 路由 + menuTree line121 三参。

## 决策(AskUserQuestion)
欠数=加工采购订购−加工入仓(未入仓);按 物料编号+共用物料编号+模具编号 汇总(共用物料编号 1:1→GROUP BY 物料编号+模具编号 等效)+物料类别/审核情况过滤+只看欠数+导出打印;**无日期**(欠数=未结清快照)。

## 执行(subagent-driven)
spec→plan→子代理 Task1 后端(`2823656`)/Task2 测试(`be32f29`·401绿)/Task3 前端(`627bfbb`·tsc0+vitest54)/Task4 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:入仓子查询先聚合不放大[再外层GROUP BY物料+模具]/欠数+金额+单价聚合/**审核情况内联 o. 片段非写死 h. 的ApprovalFilter**/物料类别+keyword+onlyOwed[HAVING]过滤/金额脱敏columns+exportCols同步/菜单权限齐DTO↔SQL↔前端10列一致/全参数化[`{appr}`仅来自固定switch]·未动 ProgressAsync/PurchaseDetailAsync/IssueProgressAsync/LedgerUnion)。

## 测试 / 验证
- 后端 `PlasticProcessShortageServiceDbTests`(种 订购8单价3 + 入仓5 + 物料资料注塑 + 共用物料表CR-SH → 欠数3/单价3/金额9/共用物料编号CR-SH/模具GM-SH/单位个/类别注塑 + 物料类别/审核情况/onlyOwed 过滤)。全量 **后端 401**(399+2)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:欠数3/单价3/金额9/共用物料编号CR-SHSMK + 物料类别命中/不命中 + 审核情况未审核过滤。共用物料=null(CR-SHSMK 非物料资料中的物料编号·符合"无则空"假设)。

## 合并
分支 `feat-plastic-process-shortage`(4 提交)→ `--no-ff` 合并 master `a6260a4`,分支已删。12 文件 +782/−1。

## 教训/记录
- **审核情况过滤别名坑**:现有 `ApprovalFilter` 写死 `h.`(入仓头别名),订购头别名为 `o.` 的查询不能复用,须内联 switch 生成 `o.` 片段。
- 共用物料名称无独立源 → 按 共用原料编号 回查物料资料物料名称(LEFT JOIN·无则空·诚实 flag)。
- **物料级汇总欠数表口径成型**:订购明细 LEFT JOIN(入仓先聚合)→ 外层 GROUP BY 物料+模具 SUM(订购−入仓)=欠数。

## 下一步
⑩发外加工余下(生产加工缺料表·最后一项);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
