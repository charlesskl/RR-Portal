# 塑胶退仓单录入保真(复用加工入仓单表单)· 2026-06-27

## 做了什么
用户反馈「**退仓和入仓是一样的样式和表头,只是计算逻辑不一样**」。把刚建的保真录入页 `PlasticReceiptFormPage`/`PlasticReceiptLineTable` **泛化成 config 驱动**,让 **塑胶入仓单 + 塑胶退仓单 共用同一套样式表头**;库存方向(入仓+/退仓−)、单号前缀(SR/STC)、审核流 全在后端不变。退料/报废 表头不同(部门人头),仍用共享 `PlasticSupplierDocFormPage` 不动。
- **DB**(`db/26`·纯 ALTER 幂等·镜像入仓 `db/25`):塑胶退仓明细单 +工模编号(30)/订单单号(40);塑胶退仓单 +订单单号(40)。
- **后端**(扩 `PlasticWarehouseReturn`·镜像 `PlasticReceipt`):DTO 头+订单单号、明细+工模编号/订单单号(Detail+Create);`CreateAsync` 两 INSERT 补列(**明细订单单号缺省取头 `l.订单单号 ?? dto.订单单号`**);`GetAsync` 两 SELECT 补列。库存 LedgerUnion 退仓支(−)不动。
- **前端**(泛化·DRY):`PlasticReceiptFormPage` 由无 props 改为接 `cfg {resource,menu,title,allowReceiptPick}`;新 `PlasticReceiptFormConfigs`(入仓 allowReceiptPick=false·退仓 true 保留「🔍选已审核入仓单带出明细」)。**App.tsx 入仓+退仓 两路由都指向泛化页传 cfg**(入仓路由必须同步改传 cfg,否则崩);退料/报废 路由不动。`PlasticReceiptLineTable` 复用未改;`PSDLine/PSDHeader` 已含可选列(入仓增量已加)。

## 决策(AskUserQuestion)
退仓与入仓同样式同表头·仅库存方向不同→共用泛化表单;退仓保留「选已审核入仓单带出明细」picker(入仓不放)→ `allowReceiptPick` cfg 开关。

## 执行(subagent-driven)
brainstorming(探明退仓与入仓改前同状态·仅缺 工模编号/订单单号)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·370·DTO/ctor 名全对·杀锁 DLL 进程)/Task2 前端(顺利·54·tsc 干净·picker onPick(单号)签名确认·bringFromReceipt cast 补全 工模编号/订单单号映射)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8 项全 PASS·重点 #1 头14列/明细18列 程序化平衡·#3 库存退仓支−不在diff·#5 入仓路由也传cfg无崩·#6 allowReceiptPick 分支 + bringFromReceipt 映射真实[入仓GetAsync确返工模/订单单号])。

## 测试 / 验证
- 后端 `PlasticWarehouseReturnProcessingColsDbTests`(Create 头订单单号+2明细[明细2显式] → Get 验头订单单号/双明细工模编号/明细1订单单号取头/明细2显式·免款号总表父行)。全量 **后端 370**(369+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:入仓垫库存 SR…+20 → 退仓 STC20260627001(订单单号 ZCS-WRS+明细工模 GM-WRS)→ GET 回读 头订单单号/明细工模编号/明细订单单号(缺省取头)→ approve → 库存 **20→12(退仓−方向)**。脚本内两单 unapprove+delete 清理。

## 合并
分支 `feat-plastic-wh-return-faithful`(2 提交)→ `--no-ff` 合并 master `e2c64a9`,分支已删。7 文件 +119/−18。

## 教训/记录
- 泛化共享组件时,**把无 props 组件改成接 cfg → 所有用它的路由都得同步传 cfg**(入仓原路由 `<PlasticReceiptFormPage />` 必须改传,否则 cfg.menu on undefined 崩)。
- 入仓/退仓 共用一套保真录入表单(`PlasticReceiptFormPage` + `PlasticReceiptFormConfigs`),后续若入退仓表头再变只改一处。

## 下一步
用户已给 8 张截图=**4 张塑胶各单据查询报表**,按顺序做:①塑胶领料查询 ②塑胶退料查询 ③塑胶报废查询 ④塑胶盘点查询(均两 Tab 汇总+明细·双击开单·带价脱敏·含共用物料/共用货号列·镜像物料侧查询页)。
