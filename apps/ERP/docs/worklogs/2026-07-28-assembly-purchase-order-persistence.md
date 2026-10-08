# 装配加工采购单落库 + 明细快照（2026-07-28）

## 目标
实现旧版 ERP 规则"已经保存的装配加工采购单，只对当时的物料起作用；修改后的半成品BOM表，物料更改只能对后面的装配采购单生效"的前提：装配加工采购单落库 + BOM 明细快照。

## 表结构（db/44_assembly_purchase_order.sql，幂等）

- `装配加工采购单`（单头）：`ID` 自增主键、`单号`(唯一索引 UX_装配加工采购单_单号)、`日期`、`供应商编号/名称`、`客户编号/名称`、`收货仓库`、`电脑单号`、`装配方式`、`开始交货日期`、`每天交货`、`完成日期`、`收货人`、`单价`、`数量`、`金额`、`操作员`、`审核/审核人/审核日期`、`备注`。
- `装配加工采购单明细`（**BOM 物料快照**）：`单号`、`行号`、`生产单号`、`款号`、`物料编号`、`物料名称`、`单位`、`用量`（单个产品需求量）、`需求数量`、`单价`、`金额`、`备注`。
- `装配加工采购单生产明细`（生产行）：`单号`、`行号`、`接单日期`、`生产单号`、`款号`、`产品名称`、`配件编号`、`产品装配名称`、`加工数量`、`单价`、`金额`。

说明：需求只点名一张明细表，但页面明细实际有两类行——生产行（带加工数量/单价/金额）和辅料行（BOM 展开结果）。把两类塞进一张宽表会把快照语义搅浑，故拆为 `明细`（物料快照，列与需求清单一致）+ `生产明细` 两张。

## 后端（Features/Assembly）

- `AssemblyPurchaseOrderService.cs`：单号走 DocumentNumber 行锁引擎（DocType=`装配加工采购单`，前缀 `ZP` → `ZP+yyyyMMdd+3位流水`）。
  - `ListAsync` 分页列表；`GetAsync` 取单读**快照**（明细表原样返回，不碰 `款号物料明细表`）。
  - `CreateAsync` / `UpdateAsync`：保存时把前端按当时 BOM 展开并允许改过的辅料行**原样落库**；`UpdateAsync` 整单替换明细，已审核拒绝修改。
  - `DeleteAsync`：未审核才可删（UPDLOCK/HOLDLOCK 判审核位，与塑胶加工采购单一致）。
- `AssemblyPurchaseOrderController.cs`：路由 `api/assembly-purchase-orders`（列表/取单/POST 新增/PUT 修改/删除/审核/反审核），权限菜单 `装配加工采购单`；审核/反审核走 PostingEngine（纯锁定翻 `审核` 位 + 审核人/审核日期 + 审计日志），表已登记进 `PostableDocuments` 白名单。
- `MenuCatalog.cs` 增 `("发外加工","装配加工采购单")`；`Program.cs` 注册 service。
- `db/seed_assembly_purchase_order_perms.sql`：给 admin 授 9 位权限（开发用种子）。

## 快照语义与报表影响（决策记录）

- **取单/查单**：`api/assembly-purchase-orders/{单号}` 只读 `装配加工采购单明细` 快照。保存 → 改 BOM → 再取单，辅料行不变；之后新开的单按新 BOM 展开。DB 测试 `Bom_change_after_save_does_not_affect_saved_order` 固化该语义。
- **装配采购查询/缺料等报表**（`AssemblyPurchaseQueryService`）：现状全是"实时按 BOM 展开 `款号物料明细表`"，没有"已落库单"概念。按任务最小方案，**报表逻辑不动**——BOM 修改仍会即时反映到这些报表。如需报表也按快照统计，后续把报表数据源从 `款号物料总表/明细表` 换成 `装配加工采购单(+明细)` 即可（单已落库，是后续工作）。
- 旧的 `api/assembly-purchase-query/{单号}` 实时取单端点保留：前端打开单时先读落库单，取不到再回退旧逻辑（兼容查询页带 `单号=ZP{ID}` 伪单号跳转过来的打开路径）。

## 前端（AssemblyPurchaseOrderPage）

- 新增 `web/src/api/assemblyPurchaseOrder.ts`。
- 保存按钮启用：未落库 → POST 新增（回显新单号到"电脑单号"）；已打开的单且未审核 → PUT 修改。删除/审核/反审核启用并按 `装配加工采购单` 菜单权限 + 审核位控制可用性。
- "打开"列表改读已落库单（新 API）；调入明细后辅料行"需求数（g)/（个）"可改，保存时以改后值落快照。
- 打开已保存的单后抑制"辅料表 = BOM×数量"自动重算（`suppressRebuild`），避免覆盖快照；重新选产品货号载入新 BOM 或点"新建"后恢复自动重算。

## 边界遵守

未碰 `Features/Production/ProductionService.cs`、`BomSetupPage.tsx`、`web/src/App.tsx`、`web/src/nav/menuTree.tsx`；BOM 展开逻辑维持现状（展开在前端按现有 `stylesApi.materials` 调用，后端落库服务不展开 BOM）。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet build tests/ErpApi.Tests`：通过（警告均为存量）。
- `dotnet test tests/ErpApi.Tests`：126 通过 / 467 跳过（DB 测试未设 ERP_TEST_DB 自动跳过，含本任务 5 个新测试）/ 2 失败——`PricingServiceDbTests.Picks_latest_effective_price_on_or_before_date`（该测试自身未做 skip 守卫）与 `SemiFinishedShortageControllerTests.Export_returns_bom_csv...`，均为其它任务的存量失败，与本改动无关（本任务未触及其文件）。
- `cd web && npx tsc -b`：通过。

## 改动文件

- 新增 `db/44_assembly_purchase_order.sql`、`db/seed_assembly_purchase_order_perms.sql`
- 新增 `src/ErpApi/Features/Assembly/AssemblyPurchaseOrder{Service,Controller,Dtos}.cs`
- 修改 `src/ErpApi/Engines/Posting/PostableDocuments.cs`（白名单 +`装配加工采购单`）
- 修改 `src/ErpApi/Features/Admin/MenuCatalog.cs`（菜单目录 +`装配加工采购单`）
- 修改 `src/ErpApi/Program.cs`（注册 service）
- 新增 `tests/ErpApi.Tests/AssemblyPurchaseOrderServiceDbTests.cs`
- 新增 `web/src/api/assemblyPurchaseOrder.ts`
- 修改 `web/src/pages/assembly/AssemblyPurchaseOrderPage.tsx`

## 后续

- 部署时执行 `db/44_assembly_purchase_order.sql` 与权限种子。
- 报表快照化（见上"报表影响"）与"前单/后单/打印/刷新清单单价"等按钮仍是 disabled，按需另立任务。
