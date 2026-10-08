# 塑胶退仓单录入保真(复用加工入仓单表单)· 设计 · 2026-06-27

## 目标

把刚建的保真录入页 `PlasticReceiptFormPage`/`PlasticReceiptLineTable` **泛化成 config 驱动**,让 **塑胶入仓单 + 塑胶退仓单 共用同一套样式与表头**(供应商/日期/入库单号/订单单号/电脑单号 + 明细 订单单号/生产单号/款号/物料编号/工模编号/物料名称/颜色/塑胶货号/单位/数量/单价/金额/备注)。**库存方向(入仓+/退仓−)、单号前缀(SR/STC)、审核流 全在后端不变。** 退料/报废 表头不同(部门/人头),仍留共享 `PlasticSupplierDocFormPage`,不并入。

## 范围与决策(已确认)

- 退仓与入仓同样式同表头,仅计算逻辑(库存方向)不同 → 共用泛化表单。
- 退仓扩表补 工模编号/订单单号(退仓现已有 生产单号/款号/塑胶货号·头有 出库/入仓/电脑单号,与入仓改前同状态)。
- **退仓保留「🔍选已审核入仓单带出明细」(PlasticReceiptPicker),入仓不放** → 泛化表单加 `allowReceiptPick` cfg 开关。
- 不并入退料/报废;不做查询报表(后续)。

## 架构

DB 纯 ALTER 给退仓两表加列(镜像入仓 `db/25`)。后端扩 `PlasticWarehouseReturnService`/DTOs 加 工模编号/订单单号(镜像 `PlasticReceiptService`)。前端把 `PlasticReceiptFormPage` 泛化为接 cfg `{resource,menu,title,allowReceiptPick}`,新建 config 映射(入仓/退仓),App.tsx 两路由都指向它,退仓从共享表单移出。库存引擎不动。

## ① DB(`db/26_plastic_warehouse_return_processing_cols.sql`·纯 ALTER 幂等)

```sql
-- 塑胶退仓单保真:塑胶退仓明细单补 工模编号/订单单号;塑胶退仓单头补 订单单号。幂等。
IF COL_LENGTH(N'[塑胶退仓明细单]', N'工模编号') IS NULL
    ALTER TABLE [塑胶退仓明细单] ADD [工模编号] nvarchar(30) NULL;
IF COL_LENGTH(N'[塑胶退仓明细单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶退仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[塑胶退仓单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶退仓单] ADD [订单单号] nvarchar(40) NULL;
```
应用两库(ERP_DB + ERP_TEST_DB)。

## ② 后端(`PlasticWarehouseReturn/`·镜像入仓改动)

**DTOs**(`PlasticWarehouseReturnDtos.cs`):
- Header DTO + `订单单号`。
- Detail Line DTO + `工模编号`、`订单单号`。
- Create Line DTO + `工模编号`、`订单单号`。
- Create DTO(头)+ `订单单号`。

**`PlasticWarehouseReturnService.cs`**:
- Create:头 INSERT 列加 `[订单单号]`(`@订单单号`=dto.订单单号);明细 INSERT 列加 `[工模编号],[订单单号]`(`@工模编号`=l.工模编号、`@订单单号`=`l.订单单号 ?? dto.订单单号`)。
- Get:头 SELECT 加 `[订单单号]`;明细 SELECT 加 `[工模编号],[订单单号]`。
- List/Delete/库存方向 不变(库存 LedgerUnion 退仓支 − 不动)。

脱敏/菜单/控制器/SR-STC 前缀 全不变(沿用 塑胶退仓单 菜单 + `api/plastic-warehouse-returns`)。

## ③ 前端(泛化·DRY)

**`PlasticReceiptFormPage.tsx`** 改为接 cfg(去硬编码):
- props `{ cfg: { resource: string; menu: string; title: string; allowReceiptPick?: boolean } }`。
- `RESOURCE`=cfg.resource、`MENU`=cfg.menu、标题=`${cfg.title}（…）`。
- `allowReceiptPick` 为真时:渲染入库单号字段的 🔍 + `PlasticReceiptPicker` + `bringFromReceipt`(选已审核入仓单 → 带出 供应商 + 明细[含 生产单号/款号/工模编号/物料编号/物料名称/规格/颜色/塑胶货号/订单单号/仓位号/单位/数量/单价])。为假时入库单号为普通可录输入(同当前入仓)。

**`PlasticReceiptFormConfigs.ts`**(新):
```ts
export interface PlasticReceiptFormCfg { resource: string; menu: string; title: string; allowReceiptPick?: boolean }
export const PLASTIC_RECEIPT_FORM_CONFIGS: Record<string, PlasticReceiptFormCfg> = {
  "plastic-receipts":          { resource: "plastic-receipts",          menu: "塑胶入仓单", title: "塑胶入仓（加工入仓）" },
  "plastic-warehouse-returns": { resource: "plastic-warehouse-returns", menu: "塑胶退仓单", title: "塑胶退仓（加工退仓）", allowReceiptPick: true },
};
```

**类型**(`api/plasticSupplierDoc.ts`):`PSDLine` 已有 工模编号?/订单单号?(入仓增量已加)、`PSDHeader` 已有 订单单号?。无需再改。

**`App.tsx`**:
- `plastic-receipts` 路由 → `<PlasticReceiptFormPage cfg={PLASTIC_RECEIPT_FORM_CONFIGS["plastic-receipts"]} />`。
- `plastic-warehouse-returns` 路由 → `<PlasticReceiptFormPage cfg={PLASTIC_RECEIPT_FORM_CONFIGS["plastic-warehouse-returns"]} />`(从共享 `PlasticSupplierDocFormPage` 移出)。
- 退料/报废 两路由不动(仍用共享表单 + `PLASTIC_SUPPLIER_DOC_CONFIGS`)。

## ④ 测试

- 后端 `PlasticWarehouseReturnProcessingColsDbTests`:Create 一张带 订单单号(头)+ 明细(工模编号/订单单号缺省取头 + 一行显式订单单号)→ Get 验证头 订单单号、明细 工模编号/订单单号 回读;免 款号总表父行(塑胶表无 FK)。清理 DELETE。
- 全量 `dotnet test` 绿(369 → 370)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:登录 → POST `/api/plastic-warehouse-returns`(订单单号 + 明细 工模编号)→ GET 回读 → approve → `/api/plastic-inventory` 退仓 **−** 方向正确(先 POST 入仓垫库存 → 退仓减)。**起后端 `--contentRoot <bin\Release\net8.0 输出目录>` + 冒烟前 `dotnet build -c Release`(被锁先 Stop-Process)。**

## 不做(YAGNI)

- 退料/报废 并入(表头不同)。
- 塑胶入仓/退仓查询报表(后续增量)。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-wh-return-faithful` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
