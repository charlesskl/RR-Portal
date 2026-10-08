# 塑胶退仓单 保真重做(全屏主从录入页)· 设计 · 2026-06-26

## 目标

照塑胶领料单的模板(`erp-plastic-issue-form`),把**塑胶退仓单**(P3c·STC·库存−·供应商头)从 P3c 的通用单据组件换成**专用全屏主从录入页**,按原系统截图保真。后端补头/明细列,库存方向(退仓 −)/STC 单号/审核全不变。**仅塑胶退仓单一张**;其它单保持现状。

## 范围与决策(已确认)

- 范围:仅塑胶退仓单。
- 供应商:**新建 SupplierPicker**(`masterApi("suppliers")`=供应商资料),🔍 回填 供应商编号+名称。
- 入仓单号:**🔍 选历史已审核塑胶入仓单,把其明细带入退仓**——**零新后端端点**,前端复用现成 `plastic-receipts` 的 list/get。
- 单价/金额:退仓**保留单价/金额列**,按「单价」权限脱敏(无权限隐藏两列;后端 Controller 已有剥离逻辑)。

## 架构

后端仍是「塑胶退仓单 + 塑胶退仓明细单」两层、Dapper、STC 单号、审核走 PostingEngine、库存 UNION 退仓支(−)——全不变,只在两表加列、DTO 与 Service 的 INSERT/SELECT 带新列。入仓带出与供应商选择都在前端,复用已有端点;前端新建专用页替换 `/plastic-warehouse-returns` 路由。

## ① 数据库

`db/23_plastic_warehouse_return_form.sql`(幂等 `IF COL_LENGTH ... ALTER ADD`,ERP_DB + ERP_TEST_DB 都执行):

- `塑胶退仓单` 加:`出库单号 nvarchar(30)`、`入仓单号 nvarchar(30)`、`电脑单号 nvarchar(30)`。(供应商编号/供应商名称/日期/仓库/备注/操作员/审核/审核人/审核日期 已有。)
- `塑胶退仓明细单` 加:`生产单号 nvarchar(30)`、`款号 nvarchar(40)`、`塑胶货号 nvarchar(40)`。(物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注 已有。)

## ② 后端(仅改 PlasticWarehouseReturn)

- `PlasticWarehouseReturnDtos.cs`:
  - `PlasticWarehouseReturnCreateDto` 头加:出库单号/入仓单号/电脑单号(`string?`)。
  - `PlasticWarehouseReturnCreateLineDto` 加:生产单号/款号/塑胶货号(`string?`)。
  - `PlasticWarehouseReturnHeaderDto` 与 `PlasticWarehouseReturnLineDto` 同步加读出字段。
- `PlasticWarehouseReturnService.cs`:`CreateAsync` 头/明细 INSERT 带新列;`GetAsync` 头/明细 SELECT 带新列。`ListAsync`/`DeleteAsync` 不变;数量/金额合计算法不变(金额=Σ数量×单价)。库存方向不变(退仓 −)。
- Controller 不变(路由 `api/plastic-warehouse-returns`,菜单 塑胶退仓单,List/Get 已按「单价」权限剥离 金额/单价)。

## ③ 前端(专用页 + 两个新选择器)

新文件:
- `web/src/pages/plastics/SupplierPicker.tsx`:`masterApi("suppliers").list` 列供应商资料(列 供应商编号/供应商名称,可搜),`onPick(row)` 回填。镜像 `EmployeePicker` 结构。
- `web/src/pages/plastics/PlasticReceiptPicker.tsx`:`plasticDocApi("plastic-receipts").list` 列塑胶入仓单(显示 单号/供应商名称/日期,可只列已审核——前端过滤 审核==='1'),`onPick(单号)` 由调用方再 `get` 拉明细。
- `web/src/api/plasticWarehouseReturn.ts`:typed `PWRHeader`/`PWRLine`(含新字段)+ `plasticWarehouseReturnApi`(list/get/create/remove/approve/unapprove,resource=`plastic-warehouse-returns`)。
- `web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx`:明细可编辑网格,**保真列序** 生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注。物料编号🔍→`PlasticMaterialPicker`(回填名称/规格/颜色/仓位号/单位);生产单号/款号🔍→`ProductionPicker`;塑胶货号手录;颜色可改。**单价 可编辑、金额=数量×单价 实时**;`hidePrice` 为真时隐藏 单价/金额 两列。
- `web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx`:
  - **工具栏**:新建(清空)/保存(create)/打印(window.print)/关闭(=新建)。删除/审核/反审核 放历史列表行内(按权限)。复制单 v1 不做(灰显或省略)。
  - **表头**(保真):供应商(只读+🔍 SupplierPicker,回填 供应商编号+供应商名称;名称显示)、日期(只读今天)、出库单号(输入)、入仓单号(只读+🔍 PlasticReceiptPicker,选中带出)、电脑单号(只读)、备注(输入)、操作员(只读当前用户)、仓库(输入,必填——后端必需,原截图未显式画)。
  - **入仓带出**:选入仓单→`plasticDocApi("plastic-receipts").get(单号)`→设 入仓单号=该单号、供应商(若入仓头有供应商则回填)、把入仓明细映射进退仓明细(物料编号/名称/规格/颜色/仓位号/单位/单价/数量;生产单号/款号/塑胶货号 留空待手录)。
  - **左明细网格**:`PlasticWarehouseReturnLineTable`。
  - **底部**:数量合计、金额合计(脱敏时不显金额)。
  - **历史单列表**:`plasticWarehouseReturnApi.list` 显示已建退仓单,单号点击 openDoc 只读回填;审核/反审核/删除按权限。
  - `App.tsx` 把 `/plastic-warehouse-returns` 路由从 `<PlasticDocPage cfg=...>` 换成 `<PlasticWarehouseReturnFormPage/>`;`PLASTIC_DOC_CONFIGS["plastic-warehouse-returns"]` 保留供其它复用(不再被引用)。

## ④ 测试

- 后端 `tests/ErpApi.Tests/PlasticWarehouseReturnFormDbTests.cs`:create 带 出库单号/入仓单号/电脑单号 + 明细 生产单号/款号/塑胶货号 → GetAsync 读回逐一断言;STC 前缀、金额=数量×单价 回归不变。
- 全量 `dotnet test` 绿(357 起不减;现有 `PlasticReturnScrapServiceDbTests` 不传新字段仍绿——新列可空)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:重启后端→登录→(可选先建入仓)→新页建退仓单(带 出库单号/入仓单号 + 明细 生产单号/塑胶货号 + 单价)→审核→库存按退仓 − 变化→打开该单读回新字段一致。

## ⑤ 不做(YAGNI)

- 其它塑胶单据的保真重做。
- 复制单 / 前单后单 / 表格设置 / 资料按钮。
- 塑胶货号自动带出(手录)。
- 入仓带出时映射 生产单号/款号/塑胶货号(入仓单不带这些,留空手录)。

## 执行

writing-plans → subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-wh-return-form` `--no-ff` 合并 master 删分支 → worklog + 更新 MEMORY.md。
