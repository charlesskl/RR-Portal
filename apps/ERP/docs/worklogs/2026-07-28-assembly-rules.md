# 装配三项规则：类别决定仓别 / 库存单价自动计算 / 本厂报价行

日期：2026-07-28

## 背景
旧版 ERP"车间外发装配、半成品操作"说明书的三项规则在 Web 版"存而不用"（缺口见 `docs/gap-analysis-old-erp-flows.md` 第三节，实施批次 3）：
1. 装配物料设置的"类别"（未包装半成品/半成品/成品）不决定成品/半成品入仓单的产品来源；
2. 库存单价(HK$) 只手工录入，不按工程BOM单价或 BOM 明细自动计算；
3. 装配物料报价没有"本厂"行（序号1本厂、不可选加工厂）。

## 规则一：类别决定仓别
- 成品入仓单产品来源（`FinishedReceiptService.ProductsAsync`，`src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs`）：CTE `Base` 增加 `LEFT JOIN [半成品共用物料设置] s ON s.[产品货号]=h.[款号]`，过滤 `s 不存在 OR 类别为空 OR 类别=N'成品'`。
- 半成品入仓单产品来源（`SemiFinishedLabelOrderService.QueryProductsAsync`，`src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderService.cs`，半成品入仓/标签单共用此来源）：在已有关联 `s` 的 `Base` 上过滤 `s 不存在 OR 类别为空 OR 类别<>N'成品'`。
- **口径决策**：未设置装配扩展、或扩展未填类别的款号两边都保持现状出现（不消失）；过滤条件写成"成品 vs 非成品"而不是枚举三个类别，存量数据里出现过的其它类别值（如"装彩盒半成品"）自动归入半成品侧。

## 规则二：库存单价(HK$) 自动计算
`StyleService.ReplaceMaterialsAsync`（`src/ErpApi/Features/Styles/StyleService.cs`）保存装配 BOM 时，扩展 `库存单价HK` 为 null **或 0**（前端重置表单默认填 0，0 视为未手工填写）时自动计算写入，新增 `ComputeInventoryPriceAsync`：
1. **优先**取款号主档（`款号总表`）新增单价字段：类别=成品 → `[出厂价]`；其余（半成品类/未设类别）→ `[装彩盒单价]`（取该字段非空的最新一行）。调查确认 `db/01_rebuild_schema.sql` 及全部增量脚本原先没有这两个或类似字段，故由 db/43 新增。
2. **兜底**按 BOM 明细 `Σ([款号物料明细表].使用数量 × [物料资料].单价)`（物料资料按物料编号取 MAX(单价)；无任何已定价物料行时 SUM 自然为 NULL，不落 0）。
- 手工已填（非 0）不覆盖；无单价权限的用户保存时 `StyleMaterialsPricePolicy.PreserveProtectedPrices` 先还原油价字段，自动计算不会把它冲掉。
- 计算发生在 BOM 明细重写之后、扩展 MERGE 之前，同一事务内，明细取数就是本次保存的明细。

## 规则三：本厂报价行
- 后端校验（`StyleService.ValidateQuotes`）：`合作方类型` 允许 {本厂, 加工厂, 供应商}；本厂行 `合作方编号/名称` 必须为空；每个款号至多一行本厂。校验在整组替换事务内，非法即整体回滚（沿用既有回滚语义）。
- DB 层（`db/43_assembly_rules.sql`，幂等）：
  - `款号总表` 新增 `[出厂价]`、`[装彩盒单价]` decimal(18,4)（`COL_LENGTH` 判存在）；
  - `CK_装配物料报价_本厂无合作方` CHECK：本厂行合作方编号/名称必须为空；
  - `UX_装配物料报价_本厂` 过滤唯一索引：`WHERE [合作方类型]=N'本厂'` 下 `产品货号` 唯一（若存量已有重复本厂行需先清理再执行）。
- 前端（`web/src/pages/styles/BomSetupPage.tsx`）：报价网格"类型"下拉加"本厂"；选本厂时清空并禁用"加工厂/供应商"选择框（placeholder"本厂无需选择"）；保存时本厂行强制 `合作方编号/名称=null`，且无合作方、无物料的本厂行也保留（原过滤会把它丢掉）；加载时 `合作方类型=本厂` 正确水合为"本厂"（原逻辑会回退成"供应商"）。

## 变更清单
**新增**
- `db/43_assembly_rules.sql` — 出厂价/装彩盒单价字段 + 本厂行 CHECK + 过滤唯一索引（幂等）。
- `tests/ErpApi.Tests/AssemblyCategoryWarehouseFilterDbTests.cs` — 类别仓别过滤两个用例：成品入仓来源只列 类别=成品（含无扩展款号、不含半成品）；半成品入仓来源排除 类别=成品（含半成品与无扩展款号）。

**修改**
- `src/ErpApi/Features/Styles/StyleService.cs` — `ValidateQuotes` 扩展本厂规则；`ReplaceMaterialsAsync` 保存时自动计算库存单价；新增 `ComputeInventoryPriceAsync`。
- `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs` — 产品来源按类别过滤。
- `src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderService.cs` — 产品来源按类别过滤。
- `web/src/pages/styles/BomSetupPage.tsx` — 报价类型下拉加"本厂"、本厂行禁用合作方选择、保存/水合口径。
- `tests/ErpApi.Tests/StyleAssemblyMaterialsDbTests.cs` — 新增 6 个用例：本厂行无合作方通过、本厂行带合作方报错、两个本厂行报错、库存单价空→出厂价优先（类别=成品）、空→Σ(用量×物料单价) 兜底（类别=半成品）、手工价不覆盖。Cleanup 增加清理测试用 `物料资料` 行；`SkipIfAssemblyRuleSchemaMissing` 在未部署 db/43 的库上跳过自动计算用例。
- `web/src/__tests__/bomSetupAssemblyPersistence.test.ts` — 新增用例：本厂报价行水合后合作方选择框禁用，保存体 `合作方类型=本厂` 且编号/名称为 null、行不被过滤丢弃。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过，0 warning 0 error。
- `dotnet test tests/ErpApi.Tests`（全量）：通过 126 / 跳过 462 / 失败 2。两个失败为存量问题，与本次无关（上一篇工作日志 2026-07-28-stocktake-writeback-master-stock.md 已记录同样两个）：
  - `SemiFinishedShortageControllerTests.Export_returns_bom_csv_...`：CSV 转义断言，短缺分析功能，本次未触碰；
  - `PricingServiceDbTests.Picks_latest_effective_price_...`：该用例无跳过保护，未设 `ERP_TEST_DB` 时直接报 ConnectionString 未初始化。
  - 本次新增/修改的 DB 集成用例（StyleAssemblyMaterialsDbTests 6 个、AssemblyCategoryWarehouseFilterDbTests 2 个）在本机因未设 `ERP_TEST_DB` 按既有约定自动跳过；需在已部署 `db/43_assembly_rules.sql` 的测试库上跑。
- `cd web && npx tsc -b`：通过。
- `npx vitest run src/__tests__/bomSetupAssemblyPersistence.test.ts`：12/12 通过。

## 部署注意
- 先执行 `db/43_assembly_rules.sql` 再发后端：自动计算会读 `款号总表.[出厂价]/[装彩盒单价]`，缺列会报错。
- "序号1为本厂数据"的旧版排版未强制实现（旧说明书行为）：本厂行可处于任意位置，仅受"至多一行、不可选合作方"约束。
