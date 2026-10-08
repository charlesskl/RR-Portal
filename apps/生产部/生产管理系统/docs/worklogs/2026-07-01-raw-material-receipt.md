# 原料入仓单(⑪原料仓库占位落地) · 2026-07-01

## 做了什么
⑪ 原料仓库「原料入仓单」全屏主从录入单(供应商头 + 带价明细·原系统截图保真)。**v1 审核纯锁定不动库存**(与 原料采购订单/需求表 一致),**库存台账整体延后**。镜像 原料采购订单(PlasticRawMaterialPurchaseOrder)加 产地/每包重量 明细列,支持从**已审核原料采购订单(YCD)调入明细**。前缀 **YRC**。
- **新表**(`db/33`):`原料入仓单`(头·供应商/日期/电脑单号/订单单号/单价类型/数量/金额/审核三件套)+ `原料入仓明细单`(原料编号/名称/产地/每包重量/单价类型/单位/数量/单价/金额/备注)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialReceipt/`):DTOs(5)+Service(前缀 **YRC**·数量=SUM数量·金额=SUM(数量×单价)·明细金额=数量×单价·List/Get/DeleteAsync 已审核抛错·**无库存写**)+Controller(`api/plastic-raw-material-receipt`·9位授权·审核走 IPostingEngine·**带价脱敏** list头金额/get单头金额+明细单价金额)。过账白名单 `["原料入仓单"]="单号"`;DI;MenuCatalog `("原料仓库","原料入仓单")`;admin 9 位权限种子 `seed_raw_material_receipt_perms.sql`(**先确认文件名未撞**)。
- **前端**(克隆原料采购订单页):`api/plasticRawMaterialReceipt.ts` + `PlasticRawMaterialReceiptLineTable`(原料编号🔍复用 PlasticRawMaterialPicker·加 产地/每包重量 可编辑列·**数量**替订货数量·单价/金额 hidePrice 隐藏)+ `PlasticRawMaterialReceiptPage`(SupplierPicker 供应商头必填/日期只读/电脑单号/**订单单号🔍 Modal 调入已审核 YCD**/单价类型 Select/操作员只读/备注·底部 数量+金额合计·历史列表+审核门控)+ App 路由 + menuTree 三参。
- **订单调入零新后端**:订单单号🔍 Modal 复用 `plasticRawMaterialPurchaseOrderApi`(list 过滤 审核='1' → get)映射 **订货数量→数量**,产地/每包重量 留空(主数据无该列)。

## 决策(AskUserQuestion)
① 库存过账方式:**先选实时台账(镜像塑胶侧)**,但用户随即改口「**先不改**采购分析表/库存列表读法」→ 收窄为 **v1 审核纯锁定不动库存**,LedgerUnion + 采购分析改读**整体延后**。② 订单单号选择器 = **从原料采购订单调入明细**。

## 执行(subagent-driven·opus 终审)
spec→plan→子代理 Task1 建表+白名单+菜单+DI+前端路由(`c418947`)/Task2 后端 DTOs+Service(`ade64e6`)/Task3 Controller(`4ab9cce`)/Task4 测试(`08c3c42`·415绿)/Task5 前端 api+LineTable(`78c4d9a`)/Task6 录入页+路由(`2cb3125`)。**Task6 子代理写完文件后因 "Not logged in" API 中断,未提交——lead 直接验证文件完整+tsc/vitest 绿后补交**。**opus 全分支终审=READY TO MERGE**(10 点全 PASS:表/前缀/纯锁定[LedgerUnion未建·采购分析表未改]/SUM/**INSERT↔@参↔表列↔SELECT↔DTO 全对齐**/白名单菜单DI种子/带价脱敏/YCD调入映射订货数量→数量/路由/类型一致;零 bug·零 over-build·恰 16 文件)。

## 测试 / 验证
- 后端 `PlasticRawMaterialReceiptServiceDbTests`(create YRC·数量8/金额24/明细2·产地台湾·每包重量25·单价类型含税·明细[0]金额15 + approve 审核1+审核日期 + delete 已审核抛错)。全量 **后端 415**(412+3)/前端 54、tsc 干净。
- **HTTP 冒烟全生命周期 PASS**:登录→建 YRC20260701001→get 数量8/金额24/明细2/产地台湾/每包重量25/审核0→approve 204→审核1→已审核 delete 拒 409→unapprove 204→delete 204。(坑:Git Bash 内联 Chinese JSON 会被 shell 编码打乱→用 Write 写 UTF-8 payload 文件 `--data-binary @`;系统有 nginx 代理拦 localhost→`--noproxy *` 会被 glob 展开,改用 `export no_proxy=localhost,127.0.0.1` 才生效)

## 合并
分支 `feat-raw-material-receipt`(6 提交)→ `--no-ff` 合并 master。

## 教训/记录
- **库存台账落点是本单最大决策**:原料库存无实时 LedgerUnion,`塑胶原料资料.[库存]` 是静态死列(全库无人写),采购分析表直接读它。原本要镜像塑胶侧建原料台账(先接入仓+一支·复刻 P3a),但用户「先不改」→ **入仓单 v1 纯锁定,台账延后**。后续做原料库存时:建 `RawMaterialInventoryService.LedgerUnion` 先接本单入仓(+),再改采购分析表/库存列表从台账读,逐支加退仓/出库/盘点。
- **subagent 中途因 API 鉴权中断可续接**:文件已落盘未提交时,lead 验证完整性 + 跑 tsc/vitest 后直接补交,不必重派。
- **带价供应商录入单模式稳定第三例**(塑胶加工采购单/原料采购订单/原料入仓单);**调入源可换**:白件领料按生产单号调塑胶共用物料表,本单按订单单号调 YCD 采购订单(复用其 list+get·零新后端·源单价字段名不同则映射)。
- 种子文件名先确认未撞(教训持续生效)。

## 下一步
原料采购进度表(订购[YCD]vs 入仓[YRC]·本单已就绪作实际源);**原料库存台账**(接本单入仓+·再改采购分析表读法);⑪原料仓库余下(原料退仓单/出库表/退库表/盘点单);⑫原料报表;⑩发外加工 生产加工缺料表;⑦塑胶物料设置/进度明细表;⑧工模表/塑胶标签单。
