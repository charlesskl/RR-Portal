# 采购退仓单（采购入仓单镜像）设计

**日期**：2026-06-12
**模块**：采购管理/仓库管理 → 采购退仓单（把已采购入仓的物料退回供应商）。菜单已存在 `M("采购退仓单")`，当前无路由/无实现。

## 目标

镜像采购入仓单：两层单据（采购退仓单 + 采购退仓明细单）、Dapper 事务、审核过账、月结锁、成本脱敏、订单选择器。**唯一语义差异：库存方向为减（−）**——退仓使物料库存减少。带与采购入仓单**完全一样的订单选择器**（复用 `OrderLinePicker`/`orderPicker` 开关）。

## 现状与复用

- `采购退仓单`/`采购退仓明细单` 表已存在（`db/01_rebuild_schema.sql` 2794/2811），`采购退仓单` 已在过账白名单（`PostableDocuments`，单号列「单号」）。
- 镜像模板：`src/ErpApi/Features/Materials/PurchaseReceipt/`（`PurchaseReceiptService`/`Controller`/`Dtos`）。共享 `MaterialDocLineDto`（已含 订单单号/生产单号/款号，采购入仓功能已加）。
- 前端物料单据**纯配置驱动**：`MaterialDocRouter`（按 `:doc` 取 `MATERIAL_DOC_CONFIGS[doc]`）→ `MaterialDocPage`/`MaterialDocCreateDrawer`/`MaterialDocDetailDrawer`/`MaterialLineTable`。订单选择器由配置 `orderPicker:true` 自动启用（`MaterialLineTable.enableOrderPicker`）。`materialDocApi(resource)` 基址 `/${resource}`。
- 库存引擎 `MaterialInventoryService.LedgerUnion` 现为：采购入仓(+) + 退料(+) − 领料(−)；需加第 4 支 采购退仓(−)。

### 表结构（`db/01_rebuild_schema.sql`）

- `采购退仓单`(单头)：ID, 单号, **入仓单号**, 日期, 供应商编号, 供应商名称, 仓库, 数量, 金额, 操作员, 审核, 备注 …（**无付款方式**）
- `采购退仓明细单`(明细)：ID, 单号, **入仓单号**, 生产单号, 款号, 合同号, 客户款号, 日期, 供应商编号/名称, 仓库, 物料类别, 条码号, 物料编号, 物料名称, 批号, 规格, 颜色, 单位, 数量, 单价, 金额, 备注 …（**无 订单单号 列——本设计加**）

## 后端

新增 `src/ErpApi/Features/Materials/PurchaseReturn/`（镜像 PurchaseReceipt）：

- `PurchaseReturnDtos.cs`：
  - `PurchaseReturnCreateDto`：入仓单号?, 供应商编号?, 供应商名称?, 仓库?, 备注?, 明细 `List<MaterialDocLineDto>`。
  - `PurchaseReturnHeaderDto`：ID, 单号, 日期, 入仓单号, 供应商编号/名称, 仓库, 数量?, 金额?, 操作员, 审核, 审核人?, 备注。
  - `PurchaseReturnDetailDto`：单头 + 明细 `List<MaterialDocLineDto>`。
- `PurchaseReturnService.cs`（`(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`）：
  - `DocType="采购退仓单"`，`Prefix="CT"`（采退；= CT+yyyyMMdd+3位）。
  - `CreateAsync`：校验明细非空 + 仓库必填；数量合计=Σ数量、金额合计=Σ(数量×单价??0)；插 `采购退仓单`(单号/入仓单号/日期/供应商编号/名称/仓库/数量/金额/操作员/'0'/备注) + 逐行插 `采购退仓明细单`(单号/入仓单号/订单单号/生产单号/款号/日期/仓库/物料类别/物料编号/物料名称/规格/颜色/单位/数量/单价/金额/备注，入仓单号取单头)。
  - `ListAsync(page,size,keyword)`、`GetAsync(单号)`、`DeleteAsync(单号)`（仅未审核可删，FK 顺序 明细→单头）。
- `PurchaseReturnController.cs` `/api/purchase-returns`：菜单/表名「采购退仓单」、口径「物料」、月结锁（`PeriodLockService.EnsureWarehouseOpenAsync`/`EnsureHeaderOpenAsync`）、审核/反审核（`IPostingEngine`）、成本脱敏（无「单价」权限剥离单头金额+明细单价/金额）、审计——逐项镜像 `PurchaseReceiptController`。
- `Program.cs`：注册 `PurchaseReturnService`。
- `MaterialInventoryService.LedgerUnion` 末尾加：
  ```sql
  UNION ALL
  SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
      FROM [采购退仓明细单] d JOIN [采购退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
  ```
  并更新顶部注释为「采购入仓(+) + 退料(+) − 领料(−) − 采购退仓(−)」。
- `db/13_purchase_return.sql`（幂等）：`IF COL_LENGTH(N'采购退仓明细单',N'订单单号') IS NULL ALTER TABLE [采购退仓明细单] ADD [订单单号] nvarchar(20) NULL;` —— 让订单选择器的订单号留痕。`db/run-db.ps1` 追加加载 13。两库执行。
- `db/seed_purchase_return_perms.sql`：admin 授权「采购退仓单」（打开/保存/删除/单价/审核/反审核/打印）。

## 前端（纯配置）

- `materialDocConfigs.ts` 加 `purchase-returns`：
  ```ts
  "purchase-returns": {
    resource: "purchase-returns", menu: "采购退仓单", title: "采购退仓", orderPicker: true,
    headerFields: [
      { name: "入仓单号", label: "入仓单号" }, { name: "供应商编号", label: "供应商编号" },
      { name: "供应商名称", label: "供应商名称" }, { name: "仓库", label: "仓库", required: true },
      { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "供应商名称", label: "供应商" }, { name: "仓库", label: "仓库" }],
  },
  ```
- `menuTree.tsx`：`M("采购退仓单")` → `M("采购退仓单", "/materials/purchase-returns", "采购退仓单")`。
- 其它零改动（路由 `/materials/:doc`→MaterialDocRouter；订单选择器随 orderPicker 自动生效；`materialDocApi("purchase-returns")` 自动指向 `/api/purchase-returns`）。

## 测试

- 后端 `PurchaseReturnServiceDbTests`：创建写单头+明细（数量/金额合计、入仓单号/订单单号/生产单号/款号 持久化）、list/get/delete 生命周期（已审核不可删）、空明细/无仓库 抛 ArgumentException。
- 后端库存联动 DbTest（扩 `MaterialInventoryDbTests` 或新增）：种 采购入仓 100(已审核) + 采购退仓 20(已审核) → `StockOfAsync`/`ListAsync` = 80（证明退仓扣库存，仅审核单）。
- 后端 API 测试 `PurchaseReturnApiTests`：无「保存」403；create→approve→（已审核删冲突 409）→unapprove→delete 生命周期；无「单价」权限明细单价/金额脱敏。

## 取舍与边界

1. 库存方向 **减（−）**——与入仓唯一语义差异；引擎只认审核='1'。
2. 复用采购入仓的订单选择器（`orderPicker:true`+共享 `OrderLinePicker`）；给 `采购退仓明细单` 加 `订单单号` 列以完整留痕。
3. 镜像月结锁/审核/脱敏/审计，行为与入仓一致。
4. 不做"退仓≤已入仓"硬校验（与入仓不超欠数一致，均不强约束）。
5. 采购退仓不参与订单进度表（进度表只聚合采购入仓+）；退仓的 订单单号 仅留痕，不进任何聚合。
6. 前缀 `CT`；采购退仓单已在过账白名单，无需改白名单。
