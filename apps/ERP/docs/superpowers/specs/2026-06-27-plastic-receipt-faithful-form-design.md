# 塑胶加工入仓单录入保真 · 设计 · 2026-06-27

## 目标

把 塑胶入仓单 录入从「共享供应商表单」升级为保真 **加工入仓单专用表单**(像 塑胶领料单 独立),补齐缺列 **工模编号 / 订单单号**,为后续增量 #2「塑胶入仓查询」提供完整数据源。**库存口径(SR 单号·审核即过账·LedgerUnion 入仓支按 物料编号×仓库)、脱敏、审核流 全不变。** 退仓/退料/报废 仍用共享表单不动。

(本增量是「塑胶入仓查询」两步拆分的第 1 步;第 2 步=两 Tab 查询 + 只读抽屉,后续单独做。)

## 范围与决策(已确认)

- 拆两步:**先加工入仓单录入保真(本增量)**,再查询报表。
- 入仓改**专用页**(移出共享 `PLASTIC_SUPPLIER_DOC_CONFIGS` 路由),退仓/退料/报废 共享表单不变。
- 现状已有:塑胶入仓明细单 有 生产单号/款号/塑胶货号;塑胶入仓单头 有 出库单号/入仓单号/电脑单号。**仅缺**:明细 工模编号、头与明细 订单单号。
- 双击只读抽屉 = 增量 #2 再做(本增量只做录入表单)。

## 架构

后端扩 `PlasticReceiptService`/DTOs 加 工模编号(明细)+订单单号(头+明细);DB 纯 ALTER 加列。前端新建专用 `PlasticReceiptFormPage` + `PlasticReceiptLineTable`(克隆共享件加两列),把 `plastic-receipts` 路由指向专用页。库存引擎 `PlasticInventoryService` 入仓支不动(按 物料编号×仓库,新增列无关)。

## ① DB(`db/25_plastic_receipt_processing_cols.sql`,新建·纯 ALTER 幂等)

```sql
-- 塑胶加工入仓单保真:塑胶入仓明细单补 工模编号/订单单号;塑胶入仓单头补 订单单号。
IF COL_LENGTH(N'[塑胶入仓明细单]', N'工模编号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [工模编号] nvarchar(30) NULL;
IF COL_LENGTH(N'[塑胶入仓明细单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[塑胶入仓单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓单] ADD [订单单号] nvarchar(40) NULL;
```
应用两库(ERP_DB + ERP_TEST_DB)。

## ② 后端(`PlasticReceipt/`)

**DTOs**(`PlasticReceiptDtos.cs`):
- `PlasticReceiptHeaderDto` + `订单单号`。
- `PlasticReceiptLineDto` + `工模编号`、`订单单号`。
- `PlasticReceiptCreateLineDto` + `工模编号`、`订单单号`。
- `PlasticReceiptCreateDto` + `订单单号`。

**`PlasticReceiptService.cs`**:
- Create:头 INSERT 列加 `[订单单号]`(`@订单单号`=dto.订单单号);明细 INSERT 列加 `[工模编号],[订单单号]`(`@工模编号`=l.工模编号、`@订单单号`=l.订单单号 ?? dto.订单单号 —— 明细订单单号缺省取头)。
- Get:头 SELECT 加 `[订单单号]`;明细 SELECT 加 `[工模编号],[订单单号]`。
- List 不变(不需新列)。

无新菜单/权限/控制器(沿用 塑胶入仓单 菜单与 `api/plastic-receipts`)。脱敏不变(单价/金额按 单价 权限置 null)。

## ③ 前端(`pages/plastics/`)

**类型**(`api/plasticSupplierDoc.ts`):`PSDLine` + `工模编号?`、`订单单号?`;`PSDHeader` + `订单单号?`。(共享件不渲染这两列,无副作用。)

**`PlasticReceiptLineTable.tsx`**(新·克隆 `PlasticSupplierDocLineTable`,保真列序):
订单单号(手录) | 生产单号(🔍ProductionPicker) | 款号 | 物料编号(🔍PlasticMaterialPicker 带出名称/规格/颜色/仓位号/单位) | 工模编号(手录) | 物料名称(只读) | 颜色 | 塑胶货号(手录) | 单位(只读) | 数量 | 单价 | 金额 | 备注 | 删除。`hidePrice` 隐藏 单价/金额。

**`PlasticReceiptFormPage.tsx`**(新·克隆 `PlasticSupplierDocFormPage`):
- 头:供应商(SupplierPicker)/日期(只读)/入库单号(name=入仓单号)/订单单号(手录·头主)/电脑单号(只读)/仓库/操作员(只读)/备注。
- 用 `PlasticReceiptLineTable` 替换共享 line table;标题「塑胶入仓(加工入仓)」。
- CRUD 复用 `plasticSupplierDocApi("plastic-receipts")`(同端点);save 时把头 `订单单号` 一并提交(create body 含)。
- 保存校验/审核/反审核/删除/列表/脱敏/合计 同共享件。
- **保存有效行判定不变**(物料编号+数量>0)。

**`App.tsx`**:第 121 行 `plastic-receipts` 路由由 `PlasticSupplierDocFormPage` 改为 `PlasticReceiptFormPage`(import 新页)。其余三单不动。`PLASTIC_SUPPLIER_DOC_CONFIGS["plastic-receipts"]` 条目保留(退仓的 PlasticReceiptPicker 经 plasticDocApi 仍用 `plastic-receipts` 资源,与 config 无关)。

## ④ 测试

- 后端 `PlasticReceiptProcessingColsDbTests`:Create 一张带 订单单号(头)+ 明细(工模编号/订单单号/生产单号/款号/塑胶货号)→ Get 验证头 订单单号、明细 工模编号/订单单号 回读一致;明细订单单号缺省取头(传 null → 取头值)。**含 款号总表 父行**(若明细款号引用——经查 塑胶入仓明细单.款号 无 FK,免父行;但若 Create 不触发 FK 则无需种 款号总表。确认:塑胶入仓明细单 无 FK 到 款号总表,故测试免父行)。清理 DELETE 明细+头。
- 全量 `dotnet test` 绿(368 → 369)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:登录 → POST `/api/plastic-receipts`(带 订单单号 + 明细 工模编号)→ GET 回读头 订单单号、明细 工模编号/订单单号;approve → `/api/plastic-inventory` 入仓数量正确(库存口径未变)。**起后端 `--contentRoot <bin\Release\net8.0 输出目录>`**。

## 不做(YAGNI)

- 增量 #2 塑胶入仓查询(两 Tab + 只读抽屉)。
- 打印合并表格/资料/前后单/表格设置 等次要工具栏按钮。
- 退仓/退料/报废 表单改动。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-receipt-faithful` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
