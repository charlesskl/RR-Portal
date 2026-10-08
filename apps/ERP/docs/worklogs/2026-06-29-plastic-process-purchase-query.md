# 加工采购查询(⑩发外加工占位落地)· 2026-06-29

## 做了什么
⑩ 发外加工「加工采购查询」落地——只读两 Tab(汇总+明细)查询 over **塑胶加工采购单/明细**(刚建)+ 明细双击新建只读抽屉。带价脱敏。镜像塑胶单据查询系列(PlasticReceiptQuery)。
- **后端**(扩 `PlasticProcessPurchaseOrderService`):`ApprovalFilter` + `QueryDetailAsync`/`QuerySummaryAsync`。明细 `塑胶加工采购单明细 d JOIN 塑胶加工采购单 h`(日期/加工厂名称/审核)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(**单位/物料类别·加工采购单明细无单位列故取资料**)。汇总 **GROUP BY 模具编号+物料编号+颜色+加工内容**·`LEFT JOIN (塑胶共用物料表 GROUP BY 物料编号) cm`(共用物料=cm.共用原料编号)·订购数量=SUM(数量)·总金额=SUM(金额)。新 `PlasticProcessPurchaseQueryController`(`api/plastic-process-purchase-query`·菜单 加工采购查询[组 发外加工]·明细脱敏单价/金额·汇总脱敏总金额)。
- **前端**:两 Tab 页(镜像 PlasticReceiptQueryPage)+ 新只读抽屉 `PlasticProcessPurchaseOrderQueryDetailDrawer`(头 单号/日期/加工厂名称/客户名称/审核·`plasticProcessPurchaseOrderApi.get`)。明细列 单据日期/单号/加工厂名称/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/数量/单价/金额/备注/审核;汇总列 模具编号/物料编号/物料名称/颜色/共用物料/加工内容/单位/订购数量/总金额。

## 决策(AskUserQuestion)
汇总按 模具编号+物料编号+颜色+加工内容 聚合(按截图汇总列);双击新建只读抽屉;省略共用物料切换。

## 执行(subagent-driven)
spec(汇总4键·共用物料/单位映射)→ plan(全SQL/DTO)→ 子代理 Task1 后端(390·克隆 PlasticReceiptQuery·单位取物料资料[明细无单位列])/Task2 前端(54·tsc 干净·抽屉 plasticProcessPurchaseOrderApi.get)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8项·JOIN 1:1·4键汇总 GROUP 合法·单位从资料适配正确[非 copy 错]·脱敏无泄露·塑胶加工采购单录入/其它未动)。

## 测试 / 验证
- 后端 `PlasticProcessPurchaseQueryServiceDbTests`(种 共用物料表/物料资料/加工采购单/明细 → Detail 加工厂名称/模具编号/加工内容/单位 + Summary 单行订购8/总金额16/共用物料 CR-GQ + 审核/物料类别/keyword/区间·免款号总表父行)。全量 **后端 390**(389+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:detail 加工厂 甲厂/模具 GM-GQ/加工内容 喷油/单位 kg;summary 单行 订购8/总金额16/共用物料 CR-GQ;未审核空。

## 合并
分支 `feat-plastic-process-purchase-query`(2 提交)→ `--no-ff` 合并 master `552340b`,分支已删。11 文件 +399/−1。

## 教训/记录
- 加工采购单明细无单位列 → 单位从塑胶物料资料 LEFT JOIN(与入仓查询取 d.单位 不同·适配)。
- 塑胶加工采购单 录入(07db3c6)+ 加工采购查询(552340b)成对完成:录入单+其查询页配套模式稳固。

## 下一步
⑩发外加工余下(白件领料单/加工入仓单/采购加工进度表/采购加工明细表/加工领料进度表等);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单。
