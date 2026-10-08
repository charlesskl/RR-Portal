# 标签单与物料设置：来料标签单 / 塑胶标签单 / 采购物料设置 / 塑胶物料设置（2026-07-28）

实现 4 个菜单占位功能，全套照抄 `半成品标签单`（SemiFinishedLabelOrder*）模式：单头+明细落库、DocumentNumber 行锁单号、审核/反审核（UPDLOCK+HOLDLOCK 头锁）、审计日志同事务、权限按菜单 9 位。未碰共享文件 `web/src/App.tsx`、`web/src/nav/menuTree.tsx`、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`、`src/ErpApi/Engines/Posting/PostableDocuments.cs`——所需注册见末节"待主会话接线"。

## 1. 来料标签单（菜单：来料标签单，前缀 LLB）

- DB：`db/52_material_label_order.sql` 建 `[来料标签单]`（电脑单号唯一/日期/备注一二/操作员/审核 char(1)/审核人/审核时间/创建更新时间）+ `[来料标签明细]`（标签单ID FK 级联删/行号/物料编号/物料名称/规格/颜色/单位/数量 decimal(18,4)/标签数 int/备注，UQ(标签单ID,行号)，CK 数量≥0、标签数≥0）。幂等（IF OBJECT_ID IS NULL + IF NOT EXISTS 索引），风格对齐近期编号脚本（如 44）。
- 后端 `src/ErpApi/Features/Materials/LabelOrders/`（Dtos/Service/Controller），路由 `api/material-label-orders`：GET 列表 / GET{单号} / POST / PUT{单号} / DELETE{单号} / POST{单号}/audit / POST{单号}/reverse-audit / GET{单号}/adjacent / GET materials（选物料数据源，查 `[物料资料]`，单价按"单价"权限脱敏）。菜单权限 `来料标签单`。
- 与半成品版的差异：明细无"每箱数量/预计标签数/实需标签数已手改"，改为直接填 `标签数`（来料没有箱规概念，标签数由用户指定）；物料编号同单唯一。
- 页面 `web/src/pages/materials/MaterialLabelOrderPage.tsx`：工具栏（新建/打开/保存/删除/复制单/前单/后单/审核/反审核/打印标签/关闭）+ 单头表单 + 明细表格，物料选择/开单弹窗内联；打印用现有 `printTable`（utils/tableExport），按 `标签数` 逐张展开（含 标签序号 i/n），上限 2000 张防失控。api client `web/src/api/materialLabelOrders.ts`。

## 2. 塑胶标签单（菜单：塑胶标签单，前缀 PLB）

与来料标签单同构：DB `db/53_plastic_label_order.sql` 建 `[塑胶标签单]` + `[塑胶标签明细]`；后端 `src/ErpApi/Features/Plastics/LabelOrders/`，路由 `api/plastic-label-orders`，物料数据源查 `[塑胶物料资料]`；页面 `web/src/pages/plastics/PlasticLabelOrderPage.tsx`，api client `web/src/api/plasticLabelOrders.ts`。

## 3. 采购物料设置（菜单：采购物料设置）

- **调查结论**：代码中无"采购物料设置"既有概念（grep 采购损耗/默认供应商/最小订量 均无线索），按任务兜底方案做最简实现：按物料设置采购参数。
- DB：`[采购物料设置]`（并入 52 号脚本）：物料编号唯一、默认供应商 nvarchar(160)、最小订量 decimal(18,4)、采购损耗率 decimal(9,4)（%，CK 0–100）、备注、操作员、创建/更新时间。
- 后端 `src/ErpApi/Features/Materials/PurchaseSettings/`，路由 `api/purchase-material-settings`：GET（列表 = `物料资料 LEFT JOIN 采购物料设置`，未设置的物料也列出便于补录，支持编号/名称/规格关键字分页）/ PUT{物料编号}（upsert，校验物料必须存在于物料资料，UPDLOCK+HOLDLOCK 防并发重复插，保存/删除写审计）/ DELETE{物料编号}。权限：打开/保存/删除。
- 页面 `web/src/pages/production/PurchaseMaterialSettingsPage.tsx`：查询表格 + 编辑弹窗 + 删除（仅已设置行可删）。api client `web/src/api/purchaseMaterialSettings.ts`。

## 4. 塑胶物料设置（菜单：塑胶物料设置）

- **调查结论**：塑胶域已有的是 `塑胶共用物料表`（PlasticCommonMaterial，按产品货号设共用物料），与"按塑胶物料的设置项"不同；无其他既有线索，按兜底方案实现：默认仓库 + 损耗率%。
- DB：`[塑胶物料设置]`（并入 53 号脚本）：物料编号唯一、默认仓库 nvarchar(80)、损耗率 decimal(9,4)（%，CK 0–100）、备注、操作员、创建/更新时间。
- 后端 `src/ErpApi/Features/Plastics/MaterialSettings/`，路由 `api/plastic-material-settings`，同采购物料设置模式（数据源 `塑胶物料资料`）。
- 页面 `web/src/pages/plastics/PlasticMaterialSettingsPage.tsx`，api client `web/src/api/plasticMaterialSettings.ts`。

## 权限种子

- `db/seed_material_label_order_perms.sql`：`来料标签单`（打开/保存/删除/打印/审核/反审核）+ `采购物料设置`（打开/保存/删除），MERGE 增量不覆盖已有设置，照 seed_semi_finished_label_order_perms 模式（applock + 超长账号跳过不截断）。
- `db/seed_plastic_label_order_perms.sql`：`塑胶标签单` + `塑胶物料设置`，同上。

## 决策记录

- **菜单分组以 menuTree 现状为准**：任务书说"采购管理组的来料标签单"，但 `web/src/nav/menuTree.tsx` 里 `来料标签单` 在"仓库管理"组、`塑胶标签单` 在"塑胶仓库"组、`塑胶物料设置` 在"塑胶采购"组；按 menuTree 实际分组报告接线建议，未自行改动。
- **不过账**：标签单审核只翻转审核标志（service 内头锁 UPDATE），不产生库存流水，与半成品标签单一致——因此 **PostableDocuments 白名单无需新增条目**。
- **复用半成品 DTO 的公共类型**：`AdjacentDirection` 枚举与 `Decimal18_4Attribute` 直接 using 自 `ErpApi.Features.Warehouse.Semi.Labels`，避免重复定义。
- 单据编号前缀：LLB（来料）/PLB（塑胶）；单号引擎按（单据类型，业务日期）隔离，前缀互不冲突。

## 测试

- `tests/ErpApi.Tests/MaterialLabelOrderServiceDbTests.cs` / `PlasticLabelOrderServiceDbTests.cs`：照 SemiFinishedLabelOrderServiceDbTests 模式——不开库参数校验（null 行/各列长度/decimal(18,4)/操作员长度）+ DB 集成（保存/改/删、重复物料编号与负数校验、审核锁单与相邻单、并发审核串行化、物料查询精确/模糊/分页/单价脱敏、审计失败全回滚、审计同事务）。ERP_TEST_DB 未设时 SkippableFact 自动跳过。
- `tests/ErpApi.Tests/PurchaseMaterialSettingsServiceDbTests.cs` / `PlasticMaterialSettingsServiceDbTests.cs`：不开库校验 + DB 集成（物料不存在拒绝、upsert 创建/更新同人同 ID、列表 LEFT JOIN 语义、删除幂等、删除后列表行 ID 回到 NULL）。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet test tests/ErpApi.Tests --filter "…LabelOrder…|…MaterialSettings…"`：44 个匹配，通过 28、跳过 16（ERP_TEST_DB 未设置，DB 集成测试按设计跳过）、失败 0。
- `cd web && npx tsc -b`：通过。

## 待主会话接线（共享文件注册清单）

- `src/ErpApi/Program.cs` DI：
  - `builder.Services.AddScoped<ErpApi.Features.Materials.LabelOrders.IMaterialLabelOrderService, ErpApi.Features.Materials.LabelOrders.MaterialLabelOrderService>();`
  - `builder.Services.AddScoped<ErpApi.Features.Plastics.LabelOrders.IPlasticLabelOrderService, ErpApi.Features.Plastics.LabelOrders.PlasticLabelOrderService>();`
  - `builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseSettings.PurchaseMaterialSettingsService>();`
  - `builder.Services.AddScoped<ErpApi.Features.Plastics.MaterialSettings.PlasticMaterialSettingsService>();`
- `src/ErpApi/Features/Admin/MenuCatalog.cs`（组名建议，参照现有分组）：`("物料管理","来料标签单")`、`("物料管理","采购物料设置")`、`("塑胶仓储","塑胶标签单")`、`("塑胶采购","塑胶物料设置")`。
- `src/ErpApi/Engines/Posting/PostableDocuments.cs`：**无需新增**（标签单不过账，同半成品标签单）。
- `web/src/nav/menuTree.tsx`：`M("来料标签单", "/material-label-orders", "来料标签单")`（仓库管理组）、`M("采购物料设置", "/purchase-material-settings", "采购物料设置")`（采购管理组）、`M("塑胶标签单", "/plastic-label-orders", "塑胶标签单")`（塑胶仓库组）、`M("塑胶物料设置", "/plastic-material-settings", "塑胶物料设置")`（塑胶采购组）。
- `web/src/App.tsx` 路由：`material-label-orders` → `pages/materials/MaterialLabelOrderPage`；`purchase-material-settings` → `pages/production/PurchaseMaterialSettingsPage`；`plastic-label-orders` → `pages/plastics/PlasticLabelOrderPage`；`plastic-material-settings` → `pages/plastics/PlasticMaterialSettingsPage`。
