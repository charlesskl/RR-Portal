# 塑胶加工入仓单录入保真(塑胶入仓查询·拆两步第1步)· 2026-06-27

## 做了什么
把 塑胶入仓单 录入从「共享供应商表单」升级为保真 **加工入仓单专用录入页**(像 塑胶领料单 独立),补齐缺列 **工模编号 / 订单单号**,为后续 #2「塑胶入仓查询」提供完整数据源。**库存口径(SR单号·审核即过账·LedgerUnion 入仓支按 物料编号×仓库)、脱敏、审核流 全不变。** 退仓/退料/报废 仍用共享表单不动。
- **DB**(`db/25`·纯 ALTER 幂等):塑胶入仓明细单 ADD 工模编号(30)/订单单号(40);塑胶入仓单 ADD 订单单号(40)。(现状已有 生产单号/款号/塑胶货号;头已有 出库单号/入仓单号/电脑单号。)
- **后端**(扩 `PlasticReceipt`):DTO 头+订单单号、明细+工模编号/订单单号(Detail+Create);`CreateAsync` 两 INSERT 补列(**明细订单单号缺省取头 `l.订单单号 ?? dto.订单单号`**);`GetAsync` 两 SELECT 补列。无新菜单/权限/控制器(沿用 塑胶入仓单 + `api/plastic-receipts`)。
- **前端**:新建专用 `PlasticReceiptLineTable`(克隆共享行·保真列序 订单单号|生产单号|款号|物料编号|工模编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注·物料编号🔍带出名称/规格/颜色/仓位号/单位·生产单号/款号🔍ProductionPicker·订单单号/工模编号/塑胶货号手录)+ `PlasticReceiptFormPage`(克隆共享表单·头加 订单单号 字段·入仓单号 label「入库单号」·SupplierPicker·CRUD 复用 `plasticSupplierDocApi("plastic-receipts")`)。`PSDLine`+工模编号?/订单单号?、`PSDHeader`+订单单号?(可选·共享件不渲染)。App.tsx 仅 `plastic-receipts` 路由切到专用页,退仓/退料/报废 不动。

## 决策(AskUserQuestion)
①缺列处理=**先扩表再查(完整保真)**;②双击只读抽屉=新建镜像物料侧(留给 #2);③范围拆分=**拆两步:先加工入仓单录入保真(本增量),再查询报表**。

## 执行(subagent-driven)
brainstorming(探明 塑胶入仓明细单 已有 生产单号/款号/塑胶货号·仅缺 工模编号/订单单号·确认无 FK 到款号总表)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·369·`DbFixture.Available` 确认)/Task2 前端(顺利·54·tsc 干净·仅切 入仓 路由)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8 项全 PASS·重点 #1 头INSERT 14列=14值/明细INSERT 18列=18值 程序化核对平衡·#3 库存引擎不在 diff 入仓支按物料编号×仓库无关·#5 PSDLine/PSDHeader 加可选列共享件零引用退仓/退料/报废不受影响)。

## 测试 / 验证
- 后端 `PlasticReceiptProcessingColsDbTests`(Create 头订单单号+2明细[明细2显式订单单号] → Get 验头订单单号/双明细工模编号/明细1订单单号取头/明细2显式·按单号清理·免款号总表父行)。全量 **后端 369**(368+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:POST `/api/plastic-receipts`(订单单号 ZCS-SMK + 明细 工模编号 GM-SMK)→ 单号 SR20260627001 → GET 回读 头订单单号=ZCS-SMK/明细工模编号=GM-SMK/**明细订单单号=ZCS-SMK(缺省取头)**/数量10 → approve 204 → `/api/plastic-inventory` SMKPM 数量=10。脚本内 unapprove+delete 清理。
- **冒烟坑**:Task1 子代理只 build 了 Debug,Release DLL 陈旧;起后端前需 `dotnet build -c Release`,但旧后端进程(.NET Host PID)锁 DLL → 先 `Stop-Process` 杀掉再 build。content root 用 `--contentRoot 输出目录`。

## 合并
分支 `feat-plastic-receipt-faithful`(2 提交)→ `--no-ff` 合并 master `5953984`,分支已删。8 文件 +294/−12。

## 教训/记录
- **冒烟前确保 Release DLL 是新的**:子代理跑 `dotnet test` 可能只产 Debug;HTTP 冒烟用 Release DLL,起前先 `dotnet build -c Release`,若被运行中的后端进程锁则先 Stop-Process(按 PID 或 ErpApi 名)。
- 塑胶入仓明细单/塑胶入仓单 现已完整保真 加工入仓单 字段(订单单号/生产单号/款号/工模编号/塑胶货号 全有)。
- `plasticSupplierDocApi(resource)` 是塑胶单据通用 CRUD;专用录入页也可复用它(只是不同明细组件)。

## 下一步
**#2 塑胶入仓查询(塑胶入仓参考)**:两 Tab(汇总+明细)只读查询 over 塑胶入仓单/明细单(现五列已有源)+ 明细双击新建只读抽屉(镜像物料侧 MaterialDocDetailDrawer)。其余 P4 塑胶报表(库存月报/各单据查询)亦待做。
