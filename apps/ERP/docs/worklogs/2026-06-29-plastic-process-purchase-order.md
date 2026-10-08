# 塑胶加工采购单(发外加工·⑩占位落地)· 2026-06-29

## 做了什么
⑩ 发外加工「塑胶加工采购单」落地——**全屏主从录入单据**(头+明细+保存+审核+列表/打开/删除),按生产单号从 BOM 调入加工清单。**塑胶采购单的发外加工版**:头用加工厂(非供应商)、明细带 加工内容/单价/金额(带价)。
- **新表**(`db/28`):`塑胶加工采购单`(头:单号/日期/交货日期/加工厂编号/加工厂名称/客户名称/收货仓库/收货人/数量/金额/操作员/审核/审核人/**审核日期**/备注)+ `塑胶加工采购单明细`(单号/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额/备注)。
- **后端** `PlasticProcessPurchaseOrder/`(DI AddScoped·`Prefix=SJ`):`BasisAsync(生产单号)`=按生产单号从 `塑胶共用物料表 JOIN 生产制单货号`+生产制单款号 带 BOM(模具编号=工模编号/物料/用料名称/颜色/**加工内容/加工单价 AS 单价**);`CreateAsync`(SJ 单号·头数量=SUM明细数量·金额=SUM(数量×单价)·明细金额=数量×单价·审核'0');List/Get/Delete(已审核拦)。`api/plastic-process-purchase-orders`。**审核三件套**(PostableDocuments+审核日期列+测试·过账引擎纯锁定·不动库存)。**单价/金额脱敏**(list 头金额·get 头金额+明细单价/金额)。
- **前端**:新 `FactoryPicker`(克隆 SupplierPicker→`masterApi("factories")`)+ `PlasticProcessPurchaseOrderPage`(克隆 PlasticPurchaseOrderPage·**去右侧合并面板**):头 加工厂(FactoryPicker)/交货日期/客户名称/收货仓库/收货人 + 调入加工清单(ProductionPicker→basis 填明细·单价从 basis 带)+ 可编辑明细(加工内容/单价/金额·hidePrice 隐藏)+ 底部数量/金额合计(金额仅 !priceHidden 显)+ 历史列表(审核/反审核/删除)。

## 决策(AskUserQuestion)
调入加工清单=按生产单号从塑胶共用物料表 BOM 带入(带加工内容/加工单价);右侧合并面板 v1 省略;范围=头+明细+保存+审核+列表/打开/删除(镜像塑胶采购单)。审核=纯锁定·单价/金额脱敏·新建 FactoryPicker。

## 执行(subagent-driven)
brainstorming(3决策·探明无 FactoryPicker·BOM 源同塑胶采购单)→ spec → plan(全表/SQL/DTO)→ 子代理 Task1 后端(389·审核三件套·SJ单号·PostingEngine new(Factory(),new AuditLogger())·DI AddScoped·款号总表 FK)/Task2 前端(54·FactoryPicker+去右面板)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(9项·审核三件套 incl 审核日期+无库存·头INSERT 13=13/明细13=13 列对齐·BasisAsync·单价脱敏服务端+客户端无泄露·共享文件加行式)。

## 测试 / 验证
- 后端 `PlasticProcessPurchaseOrderServiceDbTests`×3(BasisAsync 带 模具编号/加工内容/单价·Create→Get 头数量8/金额24/明细2[金额15/9]·Approve 翻审核='1'+审核日期非空·Delete 已审核抛)。全量 **后端 389**(386+3)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:basis 带出 模具编号 GM-PJS/加工内容 喷油/单价3 → POST 创建 SJ20260629001 → GET 头数量8/金额24/加工厂 甲加工厂/收货人 李四 → approve 204 审核=1。脚本内 unapprove+delete 清理。

## 合并
分支 `feat-plastic-process-purchase-order`(2 提交)→ `--no-ff` 合并 master `07db3c6`,分支已删。15 文件 +743/−1。

## 教训/记录
- 第二张全屏主从录入单(继塑胶采购单):审核三件套 + BOM 调入 + 全屏主从 模式稳固复用;带价单加脱敏(list/get·明细+头金额)。新建 FactoryPicker(masterApi("factories"))供发外加工头选加工厂。

## 下一步
⑩发外加工余下(加工采购查询/白件领料单/加工入仓单/采购加工进度表/采购加工明细表等);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单。
