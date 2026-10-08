# 技术债清理：装配报表快照化 + Create 价格剥离 + 物料编号长度评估（2026-07-28）

清理三份 2026-07-28 工作日志中的"遗留事项"。未碰共享文件 `web/src/App.tsx`、`web/src/nav/menuTree.tsx`、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`。

## 1. 装配采购查询/缺料报表快照化（AssemblyPurchaseQueryService）

配合 db/44 的 `装配加工采购单明细`（BOM 快照，见 2026-07-28-assembly-purchase-order-persistence.md），物料展开类报表改为 **快照 ∪ 实时展开**：

- **改造范围**：`TrackingAsync`（装配物料跟踪/未入仓）、`RequiredMaterialsAsync`（需领材料）、`FactoryInventoryAsync`（加工厂库存）、`AuxiliaryIssueProgressAsync`（辅料领料进度，需求 CTE）、`FactoryCategoryMonthlyAsync`（加工厂分类月结）。这 5 个是唯一直接展开 `款号物料明细表` 的统计口径。
- **不动的部分**：`SummaryAsync`/`DetailAsync` 只读 `款号物料总表` 单头、不展开 BOM，无重复计数问题；`GetAsync`（`api/assembly-purchase-query/{单号}`）是未落库伪单号（ZP+ID）的实时取单回退端点，维持实时展开。
- **防重复计数规则（核心口径）**：实时展开的归属键是 `(最近 MO 的 生产单号, 款号)`。该组合一旦在 `装配加工采购单明细` 存在落库行，实时分支用 `NOT EXISTS` **整组排除**，统计只按快照计一次；生产单号两侧均为 NULL 时按 NULL=NULL 配对。删除落库单后该组合自动回到实时展开（无需迁移）。已固化为服务内常量 `SnapshotExcludeSql`，5 处共用。
- **快照行口径**：需求数量 = 快照行 `需求数量`（保存时前端可改过的值，这是快照化的意义）；单件用量 = 快照行 `用量`；加工数量 = 同单同 `生产单号+款号` 的 `装配加工采购单生产明细.加工数量`，取不到回退单头 `数量`；日期/审核/收货仓库/供应商（加工厂）取落库单单头；`规格/颜色/物料类别` 快照表没有，取 `物料资料` 主档（非 BOM，允许实时，不破坏快照语义；辅料领料进度的 物料类别 过滤对快照行同样走主档）。
- **已知边界**：① 明细行 `款号` 为空的落库单（无生产明细且物料行未填款号）无法与实时展开配对，两边各自统计不去重——实际前端保存必带产品货号，仅理论边界；② 落库单日期与 `款号物料总表.日期` 不同步时，该组合归入落库单日期所在区间统计（单据日期为准），在原区间不再出现；③ 同一 生产单号+款号 存在多张落库单（改 BOM 后重开单）时各单各计，实时展开仍整体排除——这是正确语义。
- **缺料同源检查结论**：装配域缺料口径就在本服务（tracking 的未入仓数量、required-materials 需领、auxiliary-issue-progress 未领），已一并快照化。`SemiFinishedShortageService`（半成品缺料）数据源是 `生产制单 + 半成品共用物料设置 + 半成品仓流水`，塑胶域 `PlasticProcessShortage` 同理，均不展开 `款号物料明细表`，非同源，不动。

## 2. MasterCrud Create 价格剥离（MasterCrudController）

Update 路径对无"单价"权限者有"从库回填原值"保护（防止整实体覆盖抹价），Create 路径此前没有——无权限者可借新增写入价格。修复：Create 在 `ValidateForSave` 之前，无"单价"权限时把 `[PriceField]` 标注的属性全部置 null（`PriceProps`，每封闭泛型只反射一次，与 Update/Mask 同一策略源，泛型无硬编码）。有"单价"权限者不受影响。

## 3. 物料资料.物料编号 长度评估（db/56_widen_material_code.sql）

- **调查**：`物料资料.物料编号` nvarchar(20)，带唯一约束 `UQ_物料资料_物料编号`；db/02 中 **18 个 FK** 引用它（FK_2/9/13/21/119/133/140/160/163/185/187/191/203/207/215/220/226/231，含盘点明细单 FK_163）；`物料编号 nvarchar(20)` 列散布 12 个增量脚本共 32 处。加宽需 drop 18 FK + UQ → alter 主表 → 同步 alter 全部引用列（SQL Server 要求 FK 双方列长度一致）→ recreate，牵连远超 10 表。
- **决策：不加宽**。db/56 为幂等空操作脚本（仅 PRINT + 评估说明），占号备查。
- **替代防御**：在 BOM 保存入口 `StyleService.ReplaceMaterialsAsync`（即多层级半成品调入处）加长度防御——调入行属于已设置半成品（`半成品共用物料设置.产品货号`，可超 20 字）且长度 > 20 时直接拒绝保存并给中文提示。否则 nvarchar(20) 截断/报错后，半成品行判定（编号 ∈ 半成品共用物料设置.产品货号）失效，多层级展开把半成品当普通物料错算。

## 测试

- 新增 `tests/ErpApi.Tests/AssemblyPurchaseQuerySnapshotDbTests.cs`（4 个 DB 集成测试）：落库前实时 200 → 落库后快照 150 且实时不重复计、未落库款号仍实时 80；required-materials/factory-inventory 快照数量；auxiliary-issue-progress 快照行按物料主档类别命中过滤；删单后回到实时展开。
- `tests/ErpApi.Tests/MaterialMasterApiTests.cs` 新增 2 个 API 测试：无"单价"权限 Create 价格不落库（999/888 → NULL）、有权限正常落库。
- 新增 `tests/ErpApi.Tests/SemiCodeLengthGuardDbTests.cs`：24 字半成品款号调入 BOM 被拒（报"20 字"）且未写入明细。

## 验证

- `dotnet build src/ErpApi`：通过，0 警告 0 错误。
- `dotnet build tests/ErpApi.Tests`：通过（17 个警告均为存量 xUnit 分析器警告，在其它文件）。
- `dotnet test tests/ErpApi.Tests`：182 通过 / 494 跳过（ERP_TEST_DB 未设，DB 测试自动跳过，含本次新增）/ 2 失败——`PricingServiceDbTests.Picks_latest_effective_price_on_or_before_date` 与 `SemiFinishedShortageControllerTests.Export_returns_bom_csv...`，均为其它任务存量失败（与 2026-07-28-assembly-purchase-order-persistence.md 记录一致），本改动未触及其文件。
- `cd web && npx tsc -b`：通过（前端无改动）。

## 改动文件

- 修改 `src/ErpApi/Features/Assembly/AssemblyPurchaseQueryService.cs`（5 个统计方法快照化 + `ApprovalFilter` 加别名参数 + `SnapshotExcludeSql` 常量与口径注释）
- 修改 `src/ErpApi/Features/MasterData/MasterCrudController.cs`（Create 价格剥离；ValidateForSave 挂钩保留）
- 修改 `src/ErpApi/Features/Styles/StyleService.cs`（ReplaceMaterialsAsync 半成品款号长度防御）
- 新增 `db/56_widen_material_code.sql`（评估结论：不加宽，幂等空操作）
- 新增 `tests/ErpApi.Tests/AssemblyPurchaseQuerySnapshotDbTests.cs`、`tests/ErpApi.Tests/SemiCodeLengthGuardDbTests.cs`
- 修改 `tests/ErpApi.Tests/MaterialMasterApiTests.cs`（+2 测试）

## 后续

- 有测试库环境时设 `ERP_TEST_DB` 重跑 DB 集成测试确认快照口径。
