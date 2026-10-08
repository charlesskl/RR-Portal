# 物料盘点单 设计文档

> 日期：2026-06-15　主题：照「半成品盘点」(SemiStocktake) 镜像出物料盘点单——选仓库带出账面库存做底稿，录实盘数，审核后盈亏调整物料库存。

## 目标

新增**物料盘点单**：用户选仓库 → 系统带出该仓所有有库存物料作底稿（系统数量=账面库存）→ 逐行录入盘点数量 → 盈亏=盘点−系统（前端实时算）→ 保存 → 审核。审核后，盘点明细的「盈亏数量」作为一笔有符号台账调整计入物料库存（盘盈+、盘亏−），使账面库存对齐实盘。

## 背景与现状（调研结论）

- **物料盘点表已存在**：`[盘点单]` + `[盘点明细单]`（`db/01_rebuild_schema.sql:2157-2194`）。数量列 `系统数量/盘点数量/盈亏数量` 为 `real` 型；另有 `库存单价/库存金额/单价/金额`（money，本期不用）。审核留痕列 `审核人/审核日期` 已由 `db/03_p0_additions.sql` 的过账表循环补齐（`盘点单` 在该清单内）。**无需建表 / 无 DB 迁移。**
- **过账白名单已登记** `["盘点单"]="单号"`（`PostableDocuments.cs:14`）。
- **完美范本**：半成品盘点 `src/ErpApi/Features/Warehouse/Semi/SemiStocktake{Service,Controller}.cs` + `SemiDtos.cs` + 前端 `web/src/pages/warehouse/SemiStocktakePage.tsx`，以及成品盘点（同构）。物料盘点逐件镜像，只把库存源 `IInventorySummaryService.SemiFinishedAsync` 换成 `IMaterialInventoryService.ListAsync`。
- **缺失**：MaterialStocktake 后端三件套、库存引擎盘点 UNION 分支、MenuCatalog 注册、权限种子、前端页 + api + 路由。

## 命名约定（已确认）

- 单号前缀 `PD`（= `PD + yyyyMMdd + 3位流水`；经核对现有前缀无冲突）。
- 后端资源/路由：`api/material-stocktakes`。
- 前端路由：`/materials/material-stocktake`（**专用页面路由**，非 `materials/:doc` 通配——盘点页结构与通用单据组件不同）。
- 权限菜单名 / 表名 / DocType：`盘点单`（归「物料管理」组）。
- 录入方式：**选仓 → 带出底稿**（已确认）。
- 明细**不出价格列**（已确认）——只 系统数量/盘点数量/盈亏数量。

## 库存调整机制（核心）

物料库存引擎 `MaterialInventoryService.LedgerUnion`（UNION 符号法，按 物料编号×仓库 聚合，仅审核='1'）当前含：采购入仓(+)、退料(+)、领料(−)、采购退仓(−)、报废(−)。**新增一支**：

```sql
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(d.[盈亏数量] AS decimal(18,4))
    FROM [盘点明细单] d JOIN [盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
```

盈亏数量 = 盘点 − 系统（建单时算并落库）。把它作为有符号调整计入：盘盈则 +、盘亏则 −，使聚合后的账面库存等于实盘数。与成品/半成品盘点同哲学（它们的库存引擎已用 `盈亏数量` 入账）。注释更新为 `… − 报废(−) ± 盘点盈亏(±)`。

> 一致性说明：底稿的「系统数量」取自当前库存（已含此前已审核的盘点）。故盈亏=盘点−当前系统，叠加后新账面=盘点数，连续盘点之间自洽。

## 分层设计

### 1. 数据库
无改动（表与审核留痕列均已就绪）。

### 2. 后端 Feature（`src/ErpApi/Features/Materials/MaterialStocktake/`）

镜像 `SemiStocktake`：

- **`MaterialStocktakeDtos.cs`**：
  - `MaterialStocktakeBasisRow`：物料编号/物料名称/规格/单位/物料类别/系统数量（底稿行）。
  - `MaterialStocktakeLineDto`（建单入参行）：物料编号/物料名称/规格/单位/物料类别/系统数量/盘点数量。
  - `MaterialStocktakeCreateDto`：仓库/备注/明细 List。
  - `MaterialStocktakeHeaderDto`：ID/单号/仓库/日期/操作员/审核/审核人/备注。
  - `MaterialStocktakeLineRowDto`（读回行）：物料编号/物料名称/规格/单位/物料类别/系统数量/盘点数量/盈亏数量。
  - `MaterialStocktakeDetailDto`：单头 + 明细。
- **`MaterialStocktakeService.cs`**：`DocType="盘点单"`、`Prefix="PD"`，注入 `IMaterialInventoryService`。
  - `BasisAsync(仓库)`：`materialInventory.ListAsync(仓库, null)` → 映射底稿行 物料编号/物料名称/规格/单位/系统数量=库存数量。**物料类别留空**（物料库存按 物料编号×仓库 聚合，不携带物料类别；非盘点必需，YAGNI 不 JOIN 物料资料）。前端「材料」列对物料盘点显示为空。
  - `CreateAsync(dto, user)`：校验 明细非空 + 仓库必填；单号引擎取号；INSERT `[盘点单]`(单号/日期/仓库/操作员/审核='0'/备注) + 循环 INSERT `[盘点明细单]`(单号/日期/仓库/物料类别/物料编号/物料名称/规格/单位/系统数量/盘点数量/盈亏数量=盘点−系统)。数量列 real，服务端传 decimal（SQL 隐式转）。
  - `ListAsync(page,size,keyword)`：分页查 `[盘点单]`，关键字搜 单号/仓库/备注。
  - `GetAsync(单号)`：单头 + 明细（明细数量列 `CAST(... AS decimal(18,4))` 读回）。
  - `DeleteAsync(单号)`：未审核才可删（`UPDLOCK,HOLDLOCK`），先删明细再删单头。
- **`MaterialStocktakeController.cs`**：`[Route("api/material-stocktakes")]`，`Menu=Table="盘点单"`、`口径="物料"`。端点：
  - `GET basis?仓库=` → 打开权限，返回底稿。
  - `GET /`（List，打开）、`GET /{单号}`（Get，打开）、`POST /`（Create，保存，创建前 `EnsureWarehouseOpenAsync`）、`DELETE /{单号}`（删除）、`POST /{单号}/approve`（审核，`EnsureHeaderOpenAsync`+`IPostingEngine.ApproveAsync`）、`POST /{单号}/unapprove`（反审核）。审计 `IAuditLogger`。
  - 盘点无单价/金额，**不做** MaskDetail 价格保密。
- **DI**：`Program.cs` 注册 `MaterialStocktakeService`。

### 3. 库存引擎
`MaterialInventoryService.cs`：`LedgerUnion` 追加盘点分支（见上）；第6行注释补 `± 盘点盈亏(±)`。

### 4. 权限
- `MenuCatalog.cs`：物料管理组加 `new("物料管理","盘点单")`。
- `db/seed_scrap_perms.sql` 风格新建 `db/seed_stocktake_perms.sql`：给 admin 授予「盘点单」9 位权限；对 erp+erp_test 执行。

### 5. 前端（`web/src/pages/materials/` + `web/src/api/`）

镜像 `SemiStocktakePage.tsx`：

- **`web/src/api/materialStocktake.ts`**：`basis(仓库)` / `list` / `get` / `create` / `remove` / `approve` / `unapprove` → `/material-stocktakes`。类型 `MaterialStocktakeBasisRow`/`...LineDto`/`...Header`/`...Detail`。
- **`web/src/pages/materials/MaterialStocktakePage.tsx`**：
  - 顶部：仓库选择器（输入/选择仓库）+「带出」按钮 → 调 basis 填底稿表（盘点数量默认=系统数量）。
  - 底稿表：物料编号/物料名称/规格/材料/单位/系统数量(只读)/盘点数量(InputNumber 录入)/盈亏数量(=盘点−系统,实时显示) + 备注（单头）。
  - 「保存」→ create，**传全部带出行**（镜像 semi 现状，不在前端按盈亏过滤；盈亏=0 的行也保留，整仓盘点留痕）。
  - 下半：盘点单列表（单号/仓库/日期/状态）+ 审核/反审核/删除/查看明细。
  - 权限门 `can(perms,'盘点单',...)`。
- **菜单/路由**：`menuTree.tsx` 把「库存盘点单」/「盘点单」占位补成 `/materials/material-stocktake`（perm `盘点单`）；`App.tsx` 加专用 `<Route path="materials/material-stocktake" element={<MaterialStocktakePage/>} />`。

### 6. 测试

- **后端 `MaterialStocktakeServiceDbTests`**：① BasisAsync 返回某仓库存行（先 Seed 入仓使物料有库存）；② Create→Get 往返（盈亏=盘点−系统 正确落库与读回）；③ Create 空明细/空仓库 抛 ArgumentException；④ **审核后 `MaterialInventoryService` 该物料库存=实盘数**（Seed 入仓100→建盘点单盘点数80→审核→StockOf=80，即盈亏−20 生效），反审核后恢复100。
- **前端**：盈亏计算纯逻辑（盘点−系统）单测；basis→行映射。

## 数据流

选仓库→`GET basis?仓库` →`MaterialInventoryService.ListAsync(仓库)` 取账面 → 前端底稿（系统数量已填，盘点数量默认=系统）→ 用户改盘点数量→盈亏实时算→「保存」`POST /material-stocktakes`（CreateDto）→ Service 事务写 盘点单+盘点明细单（盈亏=盘点−系统，审核='0'）→ 列表「审核」`POST /{单号}/approve`→`PostingEngine`（审核='1'+审核人+审核日期）→ `MaterialInventoryService` 聚合时该单盘点明细 `盈亏数量` 计入 → 账面库存对齐实盘。

## 错误处理

明细空/仓库空→400；期间锁→409；审核失败（不存在或已审核）→409；无权限→403；已审核单不可删→409。

## 不做（YAGNI / 延后）

- 价格列（库存单价/库存金额/单价/金额）：本期不录不显（已确认）。
- 颜色/货号列：物料库存不按颜色维度聚合、货号是成品概念，故物料盘点不含（原图这两列对物料留空）。
- 「更新」按钮（重拉系统数量覆盖）：本期用「带出」一次成型；如需再加。
- 盘点冻结/差异审批流：不做。
