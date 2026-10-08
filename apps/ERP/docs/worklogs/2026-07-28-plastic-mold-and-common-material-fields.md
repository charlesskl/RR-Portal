# 塑胶模块：工模表主数据 + 共用物料表补字段/四量校验/工模联动

日期：2026-07-28

## 背景
对照旧版说明书（`docs/gap-analysis-old-erp-flows.md` 第二节）补塑胶模块三块缺口：工模表（原完全缺失）、塑胶共用物料表缺字段、"套数=出模数÷用量"校验与工模编号联动。

## 变更清单

**DB 脚本（幂等，沿用近期脚本约定，未注册进已过时的 run-db.ps1）**
- `db/39_plastic_mold.sql` — 新建 `工模表`：ID bigint IDENTITY 主键（沿用全部主数据表约定，配合 MasterCrud 泛型按 ID 增删改）；说明书"工模编号为主键"以唯一索引 `UX_工模表_工模编号` 落实。列：工模编号 nvarchar(30) NOT NULL、工模名称 nvarchar(80)、颜色 nvarchar(40)（格式"颜色/PANTONE"）、色粉号 nvarchar(30)、整啤模腔数/水口比例/模具日产量/整啤毛重/整啤净重 decimal(18,4)、啤机机型 nvarchar(30)、啤机价钱/胶件啤工价/胶料单价/原胶料单价 decimal(18,4)、用料名称 nvarchar(40)、备注 nvarchar(200)。
- `db/40_plastic_common_materials_add_cols.sql` — `塑胶共用物料表` ALTER ADD 12 列（COL_LENGTH 判空幂等）：出模数、水口比例、整啤毛重、模具日产量、啤机价钱、胶件啤工价、胶料单价、原胶料单价、加工总单价、其它成本（均 decimal(18,4)）、啤机机型 nvarchar(30)、二次加工内容 nvarchar(100)（批次 3 备用，本次只建列）。
- `db/seed_mold_perms.sql` — admin 授予"工模表"菜单 9 位权限（仿 seed_plastic_common_perms.sql）。

**后端**
- `src/ErpApi/Data/Entities/工模表.cs` — 新实体；啤机价钱/胶件啤工价/胶料单价/原胶料单价标 `[PriceField]`（无"单价"权限自动脱敏）。
- `src/ErpApi/Data/Entities/塑胶共用物料表.cs` — 补 12 个映射属性；单价/成本类标 `[PriceField]`。
- `src/ErpApi/Data/ErpDbContext.cs` — 注册 `DbSet<工模表>`。
- `src/ErpApi/Features/MasterData/MasterCrudController.cs` — 泛型基类加一个**可选**保存前挂钩 `protected virtual string? ValidateForSave(T)`（默认 null），Create/Update 在权限检查后经它校验，返回非 null 时 `400 { 消息 = ... }`。泛型本身不含任何塑胶逻辑。
- `src/ErpApi/Features/MasterData/Controllers.cs` —
  - `PlasticCommonMaterialController` 重写 `ValidateForSave` → 调 `塑胶共用物料校验.校验套数(套数, 出模数, 用量)`；
  - 新增 `PlasticMoldController`（`api/master/plastic-molds`，菜单"工模表"），重写 `ValidateForSave` 做录入规范化：`工模编号 = Trim().ToUpperInvariant()`。
- `src/ErpApi/Features/Plastics/PlasticCommonMaterial/塑胶共用物料校验.cs` — 纯静态规则：三值任一为空不校验（向后兼容）；用量=0 视为不一致；按 4 位小数（库存储精度）比较；错误文案"套数必须等于 出模数 ÷ 用量"。
- `PlasticCommonMaterialDtos.cs` / `PlasticCommonMaterialService.cs` — 只读列表行与 SELECT 补 12 列。
- `PlasticCommonMaterialController.cs`（Features/Plastics）— 无"单价"权限时脱敏扩展到全部价格列（加工单价、啤机价钱、胶件啤工价、胶料单价、原胶料单价、加工总单价、其它成本）。
- `src/ErpApi/Features/Admin/MenuCatalog.cs` — 注册 `("塑胶仓储","工模表")`（与塑胶共用物料表同组）。

**前端（未动 App.tsx / menuTree.tsx，接线由主会话统一做）**
- `web/src/api/plasticMold.ts` — `PlasticMoldRow` 类型 + 列表 helper（走 `/master/plastic-molds`）。
- `web/src/pages/plastics/PlasticMoldPage.tsx` — 工模表页（仿 PlasticCommonMaterialPage）：关键字搜索/分页/增删改弹窗；编号输入即时大写（后端保存时兜底 ToUpper）；价格字段按 `hidePrice(perms,"工模表")` 脱敏/隐藏。
- `web/src/pages/plastics/PlasticMoldPicker.tsx` — 工模选择弹窗（仿 PlasticMaterialPicker，点行返回）。
- `web/src/api/plasticCommonMaterial.ts` — 行类型补 12 字段。
- `web/src/pages/plastics/PlasticCommonMaterialPage.tsx` —
  - 表格补新列（单价类走既有 `money` 脱敏渲染）；
  - 表单补新字段（单价类在 `!priceHidden` 下渲染）；
  - 套数即时校验：`dependencies=["出模数","用量"]` + validator，与后端同规则同文案，后端 400 的 `消息` 也会在保存失败时弹出；
  - 工模编号改只读，双击输入框或点"选模"弹出 PlasticMoldPicker；选中后工模编号必带回，其余 13 个字段（颜色/色粉号/用料名称/整啤模腔数/水口比例/模具日产量/整啤毛重/整啤净重/啤机机型/啤机价钱/胶件啤工价/胶料单价/原胶料单价）按工模值覆盖（工模侧为空的跳过；无单价权限跳过价格字段），带回后重套数校验。

**测试**
- `tests/ErpApi.Tests/PlasticCommonMaterialValidationTests.cs` — 四量规则纯单元测试（6 例：空值跳过、整数、小数套数、不一致报错、用量 0、4 位小数精度边界）。
- `tests/ErpApi.Tests/PlasticMoldDbTests.cs` — `MasterCrudService<工模表>` CRUD 往返 + 关键字搜索（仿 MasterCrudServiceDbTests，ERP_TEST_DB 未设自动跳过）。
- `tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs` — 新增 `List_carries_new_p40_columns`：插入含 12 新列的行，断言只读列表全列带回。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过，0 warning 0 error。
- `dotnet test tests/ErpApi.Tests`：通过 83 / 跳过 447 / 失败 2。新增 6 个单元用例全过；DB 用例未设 ERP_TEST_DB 自动跳过（正常）。两个失败为**先存问题**且与本改动无关（与 2026-07-28-stocktake 日志记录的相同）：
  - `PricingServiceDbTests.Picks_latest_effective_price_on_or_before_date` — 非 Skippable 的 DB 用例，无 ERP_TEST_DB 时 ConnectionString 未初始化。
  - `SemiFinishedShortageControllerTests.Export_returns_bom_csv...` — CSV 断言与环境换行（\r\n）相关。
- `cd web && npx tsc -b`：通过。web 侧无覆盖本次改动页面的 vitest 用例，未跑 vitest。

## 待办 / 交接
- 部署：在 SQL Server 依次执行 `db/39_plastic_mold.sql`、`db/40_plastic_common_materials_add_cols.sql`，开发环境另跑 `db/seed_mold_perms.sql`。
- 主会话统一接线：`web/src/App.tsx` 路由 + `web/src/nav/menuTree.tsx` 中"工模表"占位项挂到 `/plastic-molds` → `PlasticMoldPage`。
- 有 ERP_TEST_DB 的环境跑一遍 `PlasticMoldDbTests` 与 `List_carries_new_p40_columns` 确认绿。
- 既有小缺口（未动）：MasterCrud 的 Create 对无"单价"权限用户不做价格字段剥离（Update 有回填保护）；工模选择器在无单价权限时前端已跳过价格带回，但手工构造请求仍可写入，如需严格可在挂钩里统一处理。
