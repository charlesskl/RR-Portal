# 原料退仓单(⑪原料仓库占位落地) · 2026-07-01

## 做了什么
⑪ 原料仓库「原料退仓单」全屏主从录入单(退回供应商·原系统截图保真)。**原料入仓单(YRC)的近乎克隆**,明细列逐列一致。**v1 审核纯锁定不动库存**(与 原料入仓单/采购订单/需求表 一致),**库存台账整体延后**。前缀 **YTC**。
- **新表**(`db/34`):`原料退仓单`(头·供应商/日期/电脑单号/**入仓单号**/单价类型/数量/金额/审核三件套)+ `原料退仓明细单`(原料编号/名称/产地/每包重量/单价类型/单位/数量/单价/金额/备注)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialReturn/`):DTOs(5)+Service(前缀 **YTC**·数量=SUM数量·金额=SUM(数量×单价)·明细金额=数量×单价·List/Get/DeleteAsync 已审核抛错·**无库存写**)+Controller(`api/plastic-raw-material-return`·9位授权·审核走 IPostingEngine·**带价脱敏**)。过账白名单 `["原料退仓单"]="单号"`;DI;MenuCatalog `("原料仓库","原料退仓单")`;admin 9 位权限种子 `seed_raw_material_return_perms.sql`(**先确认未撞**)。
- **前端**(克隆入仓单页):`api/plasticRawMaterialReturn.ts`(类型 RTN*)+ `PlasticRawMaterialReturnLineTable`(与入仓 LineTable 同列)+ `PlasticRawMaterialReturnPage`(SupplierPicker 供应商头·**入仓单号🔍 Modal 调入已审核 YRC**·单价类型 Select·底部 数量+金额合计·历史列表+审核门控)+ App 路由 + menuTree 三参。

## 与入仓单唯一实质差异
① 调入源 = 已审核**原料入仓单 YRC**(复用 `plasticRawMaterialReceiptApi` list 过滤审核1→get·映射 **数量→数量**·**带出 产地/每包重量/单价类型 + 供应商头**[入仓单已含这些列,与入仓从采购订单调入时产地/每包重量留空不同]·零新后端);② 头字段 `订单单号`→`入仓单号`;③ 前缀 YRC→YTC;④ 文案「入仓」→「退仓」;⑤ 库存方向语义为减(v1 不体现,台账延后)。**明细列完全相同。**

## 决策(AskUserQuestion)
① 库存过账:**v1 纯锁定不动库存**(与入仓单一致·台账延后);② 前缀 **YTC**;③ 入仓单号选择器 = 从原料入仓单(YRC)调入明细。

## 执行(subagent-driven·opus 终审)
spec→plan→子代理 Task1 建表+白名单+菜单+DI+前端路由(`979b628`)/Task2 后端(`7e7e17d`)/Task3 Controller(`d087f01`)/Task4 测试(`6d9c6a4`·418绿)/Task5 前端 api+LineTable(`c04f001`)/Task6 录入页+路由(`4f3e604`·**本次无中断**)。lead 在 Task2 后停掉运行中的后端 dev server(释放 bin 文件锁,避免 Task3/4 build/test 被锁·上次入仓单已现此坑)。**opus 全分支终审=READY TO MERGE**(10 点全 PASS:表/前缀/纯锁定[LedgerUnion未建·采购分析表未改]/SUM/**五处列对齐**[INSERT↔@参↔表列↔SELECT↔DTO·头用入仓单号]/白名单菜单DI种子/带价脱敏/YRC调入映射数量→数量+带出产地每包重量供应商头/路由/类型一致;零bug·零over-build·恰16文件)。

## 测试 / 验证
- 后端 `PlasticRawMaterialReturnServiceDbTests`(create YTC·数量8/金额24/入仓单号 YRC.../明细2·产地台湾·每包重量25·单价类型含税·明细[0]金额15 + approve 审核1+审核日期 + delete 已审核抛错)。全量 **后端 418**(415+3)/前端 54、tsc 干净。
- **HTTP 冒烟全生命周期 PASS**:登录→建 YTC20260701001→get 数量8/金额24/入仓单号 YRC20260701001/明细2/产地台湾/审核0→approve 204→审核1→已审核 delete 拒 409→unapprove 204→delete 204。(沿用入仓单冒烟坑:Write 写 UTF-8 payload 文件 `--data-binary @`;`export no_proxy=localhost,127.0.0.1` 绕 nginx 代理,勿用会被 glob 展开的 `--noproxy *`)

## 合并
分支 `feat-raw-material-return`(7 提交)→ `--no-ff` 合并 master。

## 教训/记录
- **入仓/退仓成对成型**:原料入仓(YRC·库存方向+)/退仓(YTC·库存方向−)两张实物单据均 v1 纯锁定,后续建原料库存台账时两支一起接(入仓+/退仓−)。
- **调入源与带出列的关系**:入仓从采购订单(YCD)调入时,产地/每包重量 留空(采购订单无这两列);退仓从入仓单(YRC)调入时,产地/每包重量 **带出**(入仓单明细已含)——调入带出哪些列取决于源单据有哪些列。退仓还额外带出供应商头(退回原供应商)。
- **dev server 文件锁前置处理**:克隆类功能执行前若后端 dev server 在跑,会锁 bin/ErpApi.dll 致 Task build/test 失败(MSB3027)。lead 在后端代码任务完成后、测试任务前停掉后端进程即可(前端 dev server 不影响 dotnet)。
- 种子文件名先确认未撞(教训持续)。

## 下一步
原料采购进度表(YCD 订购 vs YRC 入仓);**原料库存台账**(接 入仓+/退仓− 两支·再改采购分析表/库存列表读法);⑪原料仓库余下(原料出库表/退库表/盘点单);⑫原料报表;⑩发外加工 生产加工缺料表;⑦塑胶物料设置/进度明细表;⑧工模表/塑胶标签单。
