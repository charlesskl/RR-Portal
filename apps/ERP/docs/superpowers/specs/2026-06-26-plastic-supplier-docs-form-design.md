# 塑胶退料/报废/入仓 保真重做 + 退仓抽通用供应商单据页 · 设计 · 2026-06-26

## 目标

用户确认:塑胶**退料/报废/入仓**三张单据与已做的**塑胶退仓单**表头/明细完全一致。把刚做的退仓全屏录入页**抽成 config 驱动的通用供应商单据页**,四张单(退仓+这三张)共用;每单只加一条 config + 一条路由 + 后端补列。退仓回调到通用件(一处维护)。

一个 spec 覆盖三张新单 + 退仓的通用化重构(行为不变)。

## 统一界面(四单一致)

- **表头**:供应商(只读+🔍 SupplierPicker,必填)、日期(只读今天)、出库单号(输入)、入仓单号(只读+🔍 PlasticReceiptPicker 带出)、电脑单号(只读)、仓库(输入,必填)、操作员(只读当前用户)、备注(输入)。
- **明细**(保真列序):生产单号 | 款号 | 物料编号 | 物料名称 | 颜色 | 塑胶货号 | 单位 | 数量 | 单价 | 金额 | 备注。物料编号🔍 PlasticMaterialPicker;生产单号/款号🔍 ProductionPicker;塑胶货号手录;单价可编辑、金额=数量×单价;`hidePrice` 隐藏单价/金额。
- **入仓带出**:四单的 入仓单号🔍 都选历史已审核塑胶入仓单 → `plasticDocApi("plastic-receipts").get` 拉明细+供应商映射进当前单(**零新后端**)。
- **底部**:数量合计、金额合计(脱敏不显)、制单人。**历史单列表**:本单 list,打开/审核/反审核/删除按权限。

## 决策(已确认)

- DRY:**抽通用件**(PlasticSupplierDocFormPage + LineTable + config),退仓也回调到通用件。
- 入仓单本身:**四单都保留 入仓单号🔍带出**(与退仓完全一致,即便入仓带出语义重复)。
- 退料/报废 旧的 部门/人 列:**DB 保留不动、不再使用**,改用供应商头。

## 架构

后端三个 service(`PlasticReturn`/`PlasticScrap`/`PlasticReceipt`)各自补列(镜像退仓 Task2):库存方向(退料 +/报废 −/入仓 +)、单号(STL/SBF/SR)、审核、成本脱敏 **全不变**,只在头/明细两表加列、DTO 与 Service 的 INSERT/SELECT 带新列。前端把退仓页/明细网格/API 通用化为 config 驱动,四单共用。供应商选择与入仓带出复用已有件(SupplierPicker、PlasticReceiptPicker、plastic-receipts list/get、master/suppliers)。

## ① 数据库

`db/24_plastic_supplier_docs_form.sql`(幂等 `IF COL_LENGTH ... ALTER ADD`,ERP_DB+ERP_TEST_DB 都执行):

- `塑胶退料单` 加:供应商编号 nvarchar(20)、供应商名称 nvarchar(60)、出库单号 nvarchar(30)、入仓单号 nvarchar(30)、电脑单号 nvarchar(30)。(旧 退料部门/退料人 保留不动。)
- `塑胶报废单` 加:供应商编号、供应商名称、出库单号、入仓单号、电脑单号。(旧 报废部门/报废人 保留不动。)
- `塑胶入仓单` 加:出库单号、入仓单号、电脑单号。(供应商编号/供应商名称 已有。)
- `塑胶退料明细单`/`塑胶报废明细单`/`塑胶入仓明细单` 各加:生产单号 nvarchar(30)、款号 nvarchar(40)、塑胶货号 nvarchar(40)。(物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注 三单都已有。)

## ② 后端(三 service 各补,镜像退仓)

每单(`PlasticReturn`/`PlasticScrap`/`PlasticReceipt`):
- DTO:Header/Create 头加 供应商编号/供应商名称(退料、报废;入仓已有)/出库单号/入仓单号/电脑单号;Line/CreateLine 加 生产单号/款号/塑胶货号。退料/报废 旧 部门/人字段在 DTO 中**保留可选**(向后兼容,新表单不传→入库 NULL)。
- Service:CreateAsync 头 INSERT 带 供应商+出库/入仓/电脑;明细 INSERT 带 生产单号/款号/塑胶货号;GetAsync 头/明细 SELECT 带新列。ListAsync 保持(可加 供应商名称 到搜索;退料/报废 原按 退料人/报废人 搜——保留即可)。DeleteAsync 不变。金额=Σ数量×单价 不变。
- Controller 不变(各自路由/菜单/脱敏)。

## ③ 前端(通用化重构)

- `web/src/api/plasticSupplierDoc.ts`:工厂 `plasticSupplierDocApi(resource)` 返回 list/get/create/remove/approve/unapprove;typed `PSDHeader`/`PSDLine`(= 现 PWRHeader/PWRLine 字段,含供应商+出库/入仓/电脑+生产单号/款号/塑胶货号)。
- `web/src/pages/plastics/PlasticSupplierDocLineTable.tsx`:= 现 `PlasticWarehouseReturnLineTable.tsx` 改名(内容不变,类型改 PSDLine)。
- `web/src/pages/plastics/PlasticSupplierDocFormPage.tsx`:= 现 `PlasticWarehouseReturnFormPage.tsx` 参数化,接 `cfg: { resource, menu, title }`,用 `plasticSupplierDocApi(cfg.resource)`、`MENU=cfg.menu`、标题 cfg.title。供应商/入仓带出/历史列表/脱敏逻辑不变。
- `web/src/pages/plastics/PlasticSupplierDocConfigs.ts`:
  ```ts
  export const PLASTIC_SUPPLIER_DOC_CONFIGS = {
    "plastic-warehouse-returns": { resource: "plastic-warehouse-returns", menu: "塑胶退仓单", title: "塑胶退仓" },
    "plastic-returns":           { resource: "plastic-returns",           menu: "塑胶退料单", title: "塑胶退料" },
    "plastic-scraps":            { resource: "plastic-scraps",            menu: "塑胶报废单", title: "塑胶报废" },
    "plastic-receipts":          { resource: "plastic-receipts",          menu: "塑胶入仓单", title: "塑胶入仓" },
  };
  ```
- `web/src/App.tsx`:四条路由都用 `<PlasticSupplierDocFormPage cfg={PLASTIC_SUPPLIER_DOC_CONFIGS["..."]} />`;删旧 `PlasticWarehouseReturnFormPage` import/用法(及 LineTable 改名);`plastic-receipts`/`plastic-returns` 从原 `PlasticDocPage`/`PlasticIssueFormPage`?——注意:`plastic-issues`(领料)保持 `PlasticIssueFormPage` 不变(领料是另一套头,本 spec 不动);只换 退仓/退料/报废/入仓 四条。
- 删除文件:`PlasticWarehouseReturnFormPage.tsx`、`PlasticWarehouseReturnLineTable.tsx`、`api/plasticWarehouseReturn.ts`(被通用件取代)。

## ④ 测试

- 后端各补往返测试:`PlasticReturnSupplierFormDbTests`/`PlasticScrapSupplierFormDbTests`/`PlasticReceiptSupplierFormDbTests`——create 带 供应商/出库单号/入仓单号 + 明细 生产单号/塑胶货号 → get 读回断言。退仓 `PlasticWarehouseReturnFormDbTests` 不变(已绿)。
- 全量 `dotnet test` 绿(358 起,+3 往返);现有 `PlasticIssueReturnServiceDbTests`/`PlasticReturnScrapServiceDbTests` 仍绿(新列可空、旧 DTO 字段保留)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净(改名/删除后无悬空 import)。
- 冒烟:四单各建一张(带新字段 + 入仓带出)→ 审核 → 库存按各自方向(退料+/报废−/入仓+/退仓−)变化 → 打开读回一致。

## ⑤ 不做(YAGNI)

- 塑胶货号自动带出(手录)。
- 退料/报废 旧 部门/人 列的数据迁移(留空弃用)。
- 复制单/前单后单/表格设置/资料按钮。
- 领料单(plastic-issues)——它是另一套头(领料人/箱数),已单独保真,本 spec 不动。

## 执行

writing-plans → subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-supplier-docs-form` `--no-ff` 合并 master 删分支 → worklog + 更新 MEMORY.md。
