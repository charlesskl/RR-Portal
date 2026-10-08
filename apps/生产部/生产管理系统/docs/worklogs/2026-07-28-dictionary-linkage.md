# 数据互通补缺：主数据字典与表单联动（2026-07-28）

今天早些时候建好的主数据字典（啤机机型啤工表、仓库位置、工模表）与引用它们的表单没有联动，本任务补齐三处"数据互通"。未碰共享文件 `web/src/App.tsx`、`web/src/nav/menuTree.tsx`、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`、`src/ErpApi/Engines/Posting/PostableDocuments.cs`。

## 1. 工模表.啤机机型 ← 啤机机型啤工表

- 仅前端改动 `web/src/pages/plastics/PlasticMoldPage.tsx`：啤机机型 由自由文本 Input 改为 `Select showSearch allowClear`，数据源 `GET api/master/injection-machine-rates`（一次取 size=200）。
- 选中机型后：仅当 **啤机价钱为空** 且 **有"工模表·单价"权限**（`!priceHidden`）时，带出该机型 啤工价。字典接口后端已对无"啤机机型啤工表·单价"权限者把 啤工价 脱敏为 null，此时自动不带出。
- 字典加载失败（如无"啤机机型啤工表·打开"权限 403）回落为普通 Input，不阻塞录入；编辑存量自由文本机型时 Select 直接显示原值。

## 2. 物料资料.仓库位置 ← 仓库位置表

- 仅前端改动 `web/src/pages/materials/MaterialMasterPage.tsx`：新增/编辑表单原本**没有** 仓库位置 字段，本次在"单位"后新增该 `Form.Item`，用 `AutoComplete`（可输入可选择，不强制字典值，兼容存量自由文本），数据源 `GET api/master/warehouse-locations`，选项显示"编号 名称"、存值取 编号，按 label 过滤。字典加载失败回落为空选项（仍可手输）。
- 后端无需改：`物料资料` 实体已有 `[仓库位置]` 列，走既有 `api/master/materials` CRUD。

## 3. 塑胶共用物料表.工模编号 存在性校验（后端兜底）

- `src/ErpApi/Features/Plastics/PlasticCommonMaterial/塑胶共用物料校验.cs`：新增常量 `工模编号不存在消息 = "工模编号不存在于工模表"`、纯函数 `需校验工模编号`（空白不校验）与 `校验工模编号存在(factory, 工模编号)`（查 `[工模表]`，比较前 Trim+大写规范化，与工模表录入大写规则对齐）。
- `src/ErpApi/Features/MasterData/MasterCrudController.cs`：新增 `protected virtual Task<string?> ValidateForSaveAsync`（默认回落到同步 `ValidateForSave`），Create/Update 改调异步钩子；并暴露 `protected ISqlConnectionFactory Factory => factory` 供子类查库（避免子类重复捕获主构造参数触发 CS9107）。对其它 MasterCrud 子类零行为变化。
- `src/ErpApi/Features/MasterData/Controllers.cs`（仅 PlasticCommonMaterialController）：覆写 `ValidateForSaveAsync`——先跑四量校验（套数=出模数÷用量），再查工模编号存在性，不存在 → 400 `工模编号不存在于工模表`。
- 前端 `PlasticCommonMaterialPage.tsx` 未改（选模弹窗已存在，自由手输由后端兜底；该文件当前另有并行任务的未提交改动，未触碰）。

## 测试

- 纯单测 `tests/ErpApi.Tests/PlasticCommonMaterialValidationTests.cs`：新增 需校验工模编号（空白不校验）与错误文案两条。
- DB 集成测试 `tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs`：新增 `工模编号存在性校验_查工模表`（种子 `工模表 MT-LINK1`，覆盖存在/小写输入/留空/不存在四种情况，测后清理）。
- `dotnet test --filter FullyQualifiedName~PlasticCommonMaterial`：通过 8、跳过 5（ERP_TEST_DB 未设，DB 用例自动跳过，属正常）。

## 验证

- `dotnet build src/ErpApi`：0 错误（曾短暂出现 LabelOrders 编译错误，系并行任务正在编辑的文件，稍后自愈，与本任务无关）。
- `cd web && npx tsc -b`：通过。
- vitest：受影响页面无既有用例；跑 `master.test.ts` + `permissions.test.ts` 共 3 条通过。
- eslint 两个改动页面：报的 3 条 `react-hooks/set-state-in-effect` 均在既有代码行（loadCats/loadRows 的 effect），非本次新增；本次新增的 effect 均为异步 `.then` 回填，未引入新告警。

## 待主会话接线

- 代码侧**无**需注册：无新路由/新菜单（`仓库位置设置`、`啤机机型啤工表` 菜单与路由此前已接好）。
- **权限种子缺口**：db/ 下没有 `仓库位置设置`、`啤机机型啤工表` 两个菜单的授权种子脚本。未授权用户取字典会 403，前端已降级（工模机型回落手输框、仓库位置给空选项可手输），但若要全员享受下拉联动，需补这两个菜单的"打开"（工模联动还需要"单价"）授权种子或在管理界面授权。
