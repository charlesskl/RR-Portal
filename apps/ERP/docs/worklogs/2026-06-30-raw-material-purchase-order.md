# 原料采购订单(⑪原料仓库占位落地) · 2026-06-30

## 做了什么
⑪ 原料仓库「原料采购订单」全屏主从录入单(原料采购计划)。**审核纯锁定不动库存**(订单=计划·收货/入仓才动库存·与塑胶采购订单/塑胶加工采购单一致)。镜像 塑胶加工采购单(PlasticProcessPurchaseOrder)去 BOM 调入·供应商头+原料明细带价(单价类型 含税/未税)。**新表**。后续 原料采购进度表 以本单明细为订购源。
- **新表**(`db/32`):`原料采购订单`(头·供应商编号/名称/订购日期/交货日期/数量/金额/审核三件套)+ `原料采购订单明细`(原料编号/原料名称/规格/单位/单价类型/订货数量/单价/金额/备注)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialPurchaseOrder/`):DTOs(5)+Service(前缀 **YCD**·数量=SUM订货数量·金额=SUM(订货数量×单价)·明细金额=订货数量×单价·List/Get/DeleteAsync 已审核抛错·无 BOM 调入)+Controller(`api/plastic-raw-material-purchase-order`·9位授权·审核走 IPostingEngine·**带价脱敏**[list 头金额·get 单头金额+明细单价/金额])。过账白名单 `["原料采购订单"]="单号"`;DI;MenuCatalog `("原料仓库","原料采购订单")`;admin 9 位权限种子(**新文件名 `seed_raw_material_purchase_order_perms.sql`·先 grep 确认未撞**)。
- **前端**(克隆塑胶加工采购单页·去调入清单):`api/plasticRawMaterialPurchaseOrder.ts` + `PlasticRawMaterialPurchaseOrderLineTable`(原料编号🔍 **复用 PlasticRawMaterialPicker** 回填 原料编号/名称/规格/单位/单价·单价类型 Select 含税/未税·单价/金额 hidePrice 隐藏)+ `PlasticRawMaterialPurchaseOrderPage`(**SupplierPicker 供应商头**必填/订购日期只读/交货日期 DatePicker/操作员只读/备注·底部 数量+金额[hidePrice 隐藏]合计·历史列表+审核/反审核/删除门控)+ App 路由 + menuTree 三参。

## 决策(AskUserQuestion)
审核纯锁定不动库存 + 单价类型下拉(含税/未税);v1 头+明细+保存+审核/反审核+列表/打开/删除·原料手录(无 BOM 调入)。**依赖说明**:原料采购进度表依赖本单(订购源)+ 原料入仓(实际)→ 先建本订单。

## 执行(subagent-driven)
spec→plan→子代理 Task1 建表+白名单+DI(`2944a59`)/Task2 后端(`79aa422`)/Task3 测试(`67d09c4`·412绿)/Task4 前端(`4c4226c`·tsc0+vitest54)/Task5 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:审核纯锁定 LedgerUnion未改·白名单仅加一行/INSERT列对齐·数量金额SUM·明细金额=订货数量×单价/路由+9位授权+带价脱敏正确/菜单权限DI齐·种子新文件名未撞/前端SupplierPicker+原料Picker回填+单价类型下拉+hidePrice隐藏单价金额列合计+门控/DTO↔SQL↔前端一致/全参数化·未动塑胶加工采购单及LedgerUnion)。

## 测试 / 验证
- 后端 `PlasticRawMaterialPurchaseOrderServiceDbTests`(create YCD·数量8/金额24/明细2·单价类型含税·明细[0]金额15 + approve 审核1+审核日期 + delete 已审核抛错)。全量 **后端 412**(409+3)/前端 54、tsc 干净。
- **HTTP 冒烟全生命周期 PASS**:建 YCD20260630001→审核→数量8/金额24/明细2/单价类型含税→列表→已审核删拒409→反审核后删。

## 合并
分支 `feat-raw-material-purchase-order`(5 提交)→ `--no-ff` 合并 master `4f51875`,分支已删。16 文件 +1381/−1。

## 教训/记录
- **原料链路继续延伸**:塑胶原料资料(主数据)→ 原料生产需求表(需求)→ 原料采购分析表(可购)→ **原料采购订单(采购)**。本订单是后续 原料采购进度表(订购 vs 入仓=相差)的订购源。
- **依赖前置识别**:用户给 原料采购进度表 截图时,先识别它依赖 原料采购订单(订购源)+ 原料入仓(实际)均未建,诚实 flag 并改先建订单——避免做空壳报表。
- 带价供应商录入单模式(塑胶加工采购单/原料采购订单)稳定:供应商头(SupplierPicker)+ 物料明细(Picker回填+单价)+ 审核纯锁定 + 带价脱敏(list头金额/get单价金额)+ 前端 hidePrice 列与合计同步隐藏。
- 种子文件名先 grep 确认(连续三次执行·教训持续)。

## 下一步
原料采购进度表(本订单已就绪·还需 原料入仓 作实际源·或先做"订购 vs 0入仓"版);⑩发外加工 生产加工缺料表;⑪原料仓库余下(原料入仓单/退仓单/出库单/盘点等);⑫原料报表;⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
