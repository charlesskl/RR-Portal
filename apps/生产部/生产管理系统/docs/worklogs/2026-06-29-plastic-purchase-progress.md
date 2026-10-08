# 塑胶进度表(塑胶采购进度·⑦塑胶采购占位落地)· 2026-06-29

## 做了什么
⑦ 塑胶采购「塑胶进度表」落地——只读单表平铺报表:塑胶采购订单(刚建)的采购进度·一行一订单明细 + 已审核塑胶入仓数量 + 欠数(订购−入仓)。镜像物料侧 `PurchaseOrderService.ProgressAsync`。
- **后端**(扩 `PlasticPurchaseOrderService`):`ProgressAsync(供应商?,起?,止?,keyword?,onlyOwed)`。`塑胶采购订单明细 d JOIN 塑胶采购订单 o`(供应商/日期/审核)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(单位)`LEFT JOIN (已审核塑胶入仓明细 GROUP BY 生产单号+物料编号+ISNULL(颜色,'')·审核='1') rk`(入仓数量=SUM)。**入仓关联键=生产单号+物料编号+颜色·只计审核='1'·欠数=订购−入仓**(可负)。过滤 供应商(o.供应商编号/名称)+日期半开(o.日期)+keyword+onlyOwed(欠数>0)。新 `PlasticPurchaseProgressController`(`api/plastic-purchase-progress`·菜单 塑胶进度表·无脱敏)。
- **前端**:`PlasticPurchaseProgressPage`(单 Tab 平铺·克隆 PlasticOrderMakePage·加供应商 Input + 只看欠数 Checkbox)——上月/本月/下月+RangePicker+供应商+关键词+只看欠数+导出/打印+"共 N 条";列 订购日期/交货日期/采购单号/生产单号/款号/物料编号/物料名称/模具编号/颜色/单位/订购数量/入仓数量/欠数/供应商名称/审核。无价格。

## 决策(AskUserQuestion)
入仓关联键=生产单号+物料编号+颜色(能算真实入仓·非镜像物料侧的采购单号恒零);v1 只做塑胶进度表(进度明细表后续);过滤=供应商+日期区间+关键词+只看欠数。

## 执行(subagent-driven·部分 lead 直做)
brainstorming(读物料 ProgressAsync 模板·确认关联键)→ spec(自审发现 ProgressAsync 不 JOIN 生产制单→测试免款号总表父行)→ plan → **Task1 子代理被服务端限流(rate limited)中途死·零持久化 → lead 直接完成后端**(DTO/ProgressAsync/Controller/菜单/种子/测试·381)/Task2 子代理前端(54·tsc 干净)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8项·已审核入仓聚合[未审核99不计]·3键 JOIN 对称 ISNULL(颜色,'')·欠数·无放大·header 日期过滤合理[采购订单明细无日期列]·untouched)。

## 测试 / 验证
- 后端 `PlasticPurchaseProgressServiceDbTests`(免款号总表父行·种 采购订单+明细[数量10]+物料资料[kg]+已审核入仓[4]+未审核入仓[99] → ProgressAsync 验 订购10/**入仓4(未审核99不计)**/欠6/单位kg/采购单号/供应商·onlyOwed/供应商/keyword/区间过滤)。全量 **后端 381**(380+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购10/入仓4(未审核99不计)/欠6·只看欠数 1 行。

## 合并
分支 `feat-plastic-purchase-progress`(2 提交)→ `--no-ff` 合并 master `4adc632`,分支已删。10 文件 +264/−1。

## 教训/记录
- 子代理可能被服务端**限流(非用量上限)**中途死·零持久化 → lead 核 git state 后直接接管完成(后端纯规约任务适合)。
- 进度表关联键选 生产单号+物料+颜色(非订单单号)能算真实入仓·已记录为有意选择。

## 下一步
⑦塑胶采购余下占位(塑胶物料设置/塑胶进度明细表/塑胶物料进出汇总);塑胶库存月报表;⑧工模表/塑胶标签单。
