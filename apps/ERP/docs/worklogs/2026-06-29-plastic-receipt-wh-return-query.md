# 塑胶入仓查询 + 塑胶退仓查询(塑胶入仓查询拆两步第2步·⑨塑胶报表查询收官)· 2026-06-29

## 做了什么
⑨ 塑胶报表最后两个占位「塑胶入仓查询」「塑胶退仓查询」落地。只读两 Tab(**汇总按物料编号** + 明细)over 塑胶入仓单/退仓单,明细双击新建只读抽屉看整单。带价脱敏。是「塑胶入仓查询拆两步」的**第 2 步**(第 1 步加工入仓单/退仓单录入保真已扩 订单单号/工模编号·数据齐了)。

## ①塑胶入仓查询(合并 `fba3909`·后端376)
- **后端**(扩 `PlasticReceiptService`):`ApprovalFilter` + `ReceiptQueryDetail/SummaryAsync`。`塑胶入仓明细单 d JOIN 塑胶入仓单 h`(供应商/日期/审核)`LEFT JOIN (塑胶共用物料表 GROUP BY 物料编号) cm`(共用货号=cm.塑胶货号·共用物料=cm.共用原料编号)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(物料类别)。**塑胶货号=d.塑胶货号·供应商=h.供应商名称·明细带 订单单号/工模编号**。汇总 GROUP BY 物料编号+颜色(数量/金额 SUM·**Summary 无单价字段**)。新 `PlasticReceiptQueryController`(`api/plastic-receipt-query`·菜单 塑胶入仓查询·明细脱敏单价+金额/汇总脱敏金额)。
- **前端**:两 Tab 页(镜像 PlasticScrapQueryPage)+ 新只读抽屉 `PlasticReceiptQueryDetailDrawer`(头 单号/日期/供应商/订单单号/审核·`plasticDocApi("plastic-receipts")`)。

## ②塑胶退仓查询(合并 `8d6983f`·后端377)
- **①的克隆**,数据源换 `PlasticWarehouseReturn`(塑胶退仓单/明细单),**仅换表名**,列/汇总口径/脱敏/抽屉全同。新 `PlasticWarehouseReturnQueryController`(`api/plastic-warehouse-return-query`·菜单 塑胶退仓查询)·抽屉 `plasticDocApi("plastic-warehouse-returns")`。

## 决策(AskUserQuestion)
沿用塑胶单据查询系列口径:共用货号=cm.塑胶货号·共用物料=cm.共用原料编号;双击新建只读抽屉;脱敏;省略次要功能。**新拍板:汇总按物料编号+颜色(入库统计口径)。**

## 执行(subagent-driven)
①入仓:brainstorming(用录入保真已扩的列)→ spec → plan → 子代理 Task1 后端(376·Summary 无单价故只脱敏金额)/Task2 前端(54·新抽屉)/Task3 冒烟+终审+合并·opus READY(8项)。②退仓:plan(克隆①)→ 子代理 Task1 后端(377·仅换表名)/Task2 前端(54)/Task3 冒烟+终审+合并·**opus 重点核对零入仓表残留(只有退仓表的 入仓单号 合法列)·READY**。

## 测试 / 验证
- 后端 `PlasticReceiptQueryServiceDbTests`/`PlasticWarehouseReturnQueryServiceDbTests`(种 共用物料表/物料资料/入仓或退仓单/明细 → Detail 订单单号/工模编号/供应商/共用货号/塑胶货号 + Summary 单行数量8 + 审核/物料类别/keyword/区间·免款号总表父行)。全量 **后端 377**(375→376→377)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:入仓 detail 订单单号 ZCS-RC/工模 GM-RC/供应商 供A/共用货号 H-RC·summary 单行数量8;退仓 detail 订单单号 ZCS-WR/工模 GM-WR/供应商 供B·summary 单行数量8;均未审核空。
- **冒烟坑**:退仓 Release 重建时被运行中后端(PID 41564·子代理 Debug 构建未杀)锁 DLL → 按 PID Stop-Process 后重建成功。

## 合并
入仓 `fba3909`(11 文件+403)、退仓 `8d6983f`(11 文件+403),分支均 `--no-ff` 合并 master 后删。

## 里程碑
**塑胶入仓查询拆两步全部完成**(第1步录入保真 5953984/e2c64a9 + 第2步查询 fba3909/8d6983f)。**⑨ 塑胶报表 各单据查询 6 张全齐**(入仓/退仓/领料/退料/报废/盘点查询)。

## 下一步
P4 余下:塑胶库存月报表;⑦塑胶采购其余占位(塑胶物料设置/采购订单/进度表/进出汇总)、⑧工模表/塑胶标签单。
