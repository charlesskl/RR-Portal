# Semi-Finished Common Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the modern “半成品共用物料表” list under 半成品仓库, connect row double-click to the editable 装配物料设置 detail, and persist common-material metadata, BOM rows, quotes, and audit state.

**Architecture:** Add an isolated semi-finished common-material query feature backed by the existing 款号物料总表/明细表 plus two additive extension tables. Extend the existing Styles BOM load/save transaction for detail persistence instead of duplicating the editor. Keep permissions enforced server-side and expose a typed React API/page using the project’s Ant Design layout.

**Tech Stack:** .NET 8, ASP.NET Core, Dapper, SQL Server, xUnit, React 19, TypeScript 6, Ant Design 6, Axios, Vitest, Vite.

## Global Constraints

- The menu is `半成品仓库 / 半成品共用物料表`; do not add this feature to 辅料报表.
- Do not modify or reuse `[塑胶共用物料表]` or the plastic common-material page.
- Reuse `/assembly-material-setup` for detail editing; do not create a second editor.
- All new database scripts must be idempotent.
- BOM rows, detail extension data, and quote rows save in one SQL transaction.
- Price data must be removed by the backend when the user lacks `单价` permission.
- Use the current modern Ant Design page style, not legacy desktop-window styling.
- Preserve unrelated dirty-worktree changes and stage only files owned by each task.

---

## File Map

- `db/migrate_semi_finished_common_materials.sql`: creates the two additive persistence tables and indexes.
- `db/seed_semi_finished_common_materials_perms.sql`: grants the new menu permissions to admin.
- `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialDtos.cs`: query and row contracts.
- `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialService.cs`: paged list, filters, price redaction, audit state updates.
- `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialController.cs`: permission boundary and HTTP endpoints.
- `src/ErpApi/Features/Styles/StyleDtos.cs`: extended BOM detail/load/save and quote contracts.
- `src/ErpApi/Features/Styles/StyleService.cs`: transactional detail loading and saving.
- `src/ErpApi/Features/Styles/StyleController.cs`: audit and reverse-audit endpoints using 款号资料 permissions.
- `src/ErpApi/Features/Admin/MenuCatalog.cs`: new permission catalog entry.
- `src/ErpApi/Program.cs`: service registration.
- `tests/ErpApi.Tests/SemiFinishedCommonMaterialsDbTests.cs`: list/filter/permission/audit database tests.
- `tests/ErpApi.Tests/StyleAssemblyMaterialsDbTests.cs`: extension/quote/transaction database tests.
- `web/src/api/semiFinishedCommonMaterials.ts`: typed list and audit API.
- `web/src/api/styles.ts`: extended detail DTO and save payload.
- `web/src/utils/semiFinishedCommonMaterials.ts`: pure query normalization and detail URL builder.
- `web/src/pages/semi/SemiFinishedCommonMaterialsPage.tsx`: modern list page.
- `web/src/pages/styles/BomSetupPage.tsx`: hydrate/save extension and quote data, audit read-only mode, return navigation.
- `web/src/nav/menuTree.tsx`: real menu route and permission key.
- `web/src/App.tsx`: new list route.
- `web/src/__tests__/semiFinishedCommonMaterials.test.ts`: API/query/route contract tests.
- `web/src/__tests__/semiFinishedCommonMaterialsPage.test.ts`: page interaction tests.
- `web/src/__tests__/bomSetupAssemblyPersistence.test.ts`: detail load/save/return/audit regression tests.

---

### Task 1: Add Idempotent Persistence and Permission Scripts

**Files:**
- Create: `db/migrate_semi_finished_common_materials.sql`
- Create: `db/seed_semi_finished_common_materials_perms.sql`

**Interfaces:**
- Produces: `[半成品共用物料设置]` keyed by `产品货号` and `[装配物料报价]` keyed by identity.
- Produces: admin permission row for menu `半成品共用物料表`.

- [ ] **Step 1: Write the migration script with exact columns and indexes**

```sql
IF OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NULL
BEGIN
  CREATE TABLE [半成品共用物料设置](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [产品装配名称] nvarchar(200) NULL,
    [配件编号] nvarchar(100) NULL,
    [共用物料编号] nvarchar(100) NULL,
    [装配方式] nvarchar(100) NULL,
    [类别] nvarchar(50) NULL,
    [库存单价HK] decimal(18,4) NULL,
    [其他成本HK] decimal(18,4) NULL,
    [需求用量] decimal(18,4) NULL,
    [单位] nvarchar(30) NULL,
    [半成品计算库存] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_计算库存] DEFAULT(0),
    [备注内容] nvarchar(500) NULL,
    [调整审核] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_审核] DEFAULT(0),
    [审核人] nvarchar(50) NULL,
    [审核时间] datetime2 NULL,
    [更新人] nvarchar(50) NULL,
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_半成品共用物料设置_更新时间] DEFAULT(SYSDATETIME())
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_半成品共用物料设置_产品货号')
  CREATE UNIQUE INDEX [UX_半成品共用物料设置_产品货号] ON [半成品共用物料设置]([产品货号]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_半成品共用物料设置_共用审核')
  CREATE INDEX [IX_半成品共用物料设置_共用审核] ON [半成品共用物料设置]([共用物料编号],[调整审核]);

IF OBJECT_ID(N'[装配物料报价]', N'U') IS NULL
BEGIN
  CREATE TABLE [装配物料报价](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [物料编号] nvarchar(100) NULL,
    [物料名称] nvarchar(200) NULL,
    [合作方类型] nvarchar(20) NOT NULL,
    [合作方编号] nvarchar(50) NULL,
    [合作方名称] nvarchar(200) NULL,
    [报价日期] date NULL,
    [货币] nvarchar(20) NULL,
    [单价] decimal(18,4) NULL,
    [港币价] decimal(18,4) NULL,
    [对比相差] decimal(18,4) NULL,
    [相差比例] decimal(18,4) NULL,
    [是否默认] bit NOT NULL CONSTRAINT [DF_装配物料报价_默认] DEFAULT(0),
    [顺序] int NOT NULL CONSTRAINT [DF_装配物料报价_顺序] DEFAULT(0),
    [备注] nvarchar(500) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_装配物料报价_产品货号')
  CREATE INDEX [IX_装配物料报价_产品货号] ON [装配物料报价]([产品货号],[顺序],[ID]);
```

- [ ] **Step 2: Write the idempotent permission seed**

```sql
DECLARE @用户 nvarchar(30)=N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'半成品共用物料表';
INSERT INTO [userbqrpower]
([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES(@用户,N'半成品共用物料表',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: Apply both scripts twice to verify idempotency**

Run:

```powershell
dotnet run --project tools/DbDeploy -- db/migrate_semi_finished_common_materials.sql
dotnet run --project tools/DbDeploy -- db/migrate_semi_finished_common_materials.sql
dotnet run --project tools/DbDeploy -- db/seed_semi_finished_common_materials_perms.sql
```

Expected: all three commands exit `0`; second migration reports no duplicate-object error.

- [ ] **Step 4: Commit only the scripts**

```powershell
git add db/migrate_semi_finished_common_materials.sql db/seed_semi_finished_common_materials_perms.sql
git commit -m "db: add semi-finished common material storage"
```

---

### Task 2: Implement the Server-Side List and Filters with Tests

**Files:**
- Create: `tests/ErpApi.Tests/SemiFinishedCommonMaterialsDbTests.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialDtos.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialService.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialController.cs`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Modify: `src/ErpApi/Program.cs`

**Interfaces:**
- Produces: `Task<PagedResult<SemiFinishedCommonMaterialRow>> ListAsync(SemiFinishedCommonMaterialQuery query, bool canSeePrice)`.
- Produces: `GET /api/semi-finished-common-materials`.

- [ ] **Step 1: Write failing database tests for list grain and filters**

Create fixtures with two `[款号物料总表]` versions for `STYLE-1`, one for `STYLE-2`, and extension rows sharing `COMMON-1`. Assert:

```csharp
[SkippableFact]
public async Task List_uses_latest_header_and_one_row_per_style()
{
    var result = await _service.ListAsync(new() { Page = 1, Size = 20 }, true);
    Assert.Single(result.Items.Where(x => x.产品货号 == "STYLE-1"));
    Assert.Equal("最新产品名", result.Items.Single(x => x.产品货号 == "STYLE-1").产品名称);
}

[SkippableTheory]
[InlineData("显示重复", null, null, 2)]
[InlineData(null, "待设置", null, 1)]
[InlineData(null, "已设置", "已审核", 1)]
public async Task List_applies_server_filters(string? duplicate, string? pending, string? audit, int count)
{
    var result = await _service.ListAsync(new()
    {
        重复内容 = duplicate,
        待操作物料 = pending,
        审核情况 = audit,
        Page = 1,
        Size = 20
    }, true);

    Assert.Equal(count, result.Total);
    Assert.Equal(count, result.Items.Count);
}

[SkippableFact]
public async Task List_redacts_price_without_price_permission()
{
    var result = await _service.ListAsync(new() { Page = 1, Size = 20 }, false);
    Assert.All(result.Items, row => Assert.Null(row.库存单价));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedCommonMaterialsDbTests
```

Expected: FAIL because the DTO/service does not exist.

- [ ] **Step 3: Add exact query contracts**

```csharp
public sealed class SemiFinishedCommonMaterialQuery
{
    public string? 重复内容 { get; set; }
    public string? 待操作物料 { get; set; }
    public string? 审核情况 { get; set; }
    public string? 查询字段 { get; set; }
    public string? Keyword { get; set; }
    public bool 精确 { get; set; }
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
}

public sealed class SemiFinishedCommonMaterialRow
{
    public string 产品货号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 库存单价 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 共用物料编号 { get; set; }
    public string 调整审核 { get; set; } = "未审核";
    public string? 备注内容 { get; set; }
}
```

- [ ] **Step 4: Implement a parameterized CTE query**

Use `ROW_NUMBER() OVER (PARTITION BY h.[款号] ORDER BY h.[ID] DESC)` for the latest header, join `[半成品共用物料设置]`, and compute duplicate count with `COUNT(*) OVER (PARTITION BY NULLIF(LTRIM(RTRIM([共用物料编号])),N''))`. Map the selected field through a C# whitelist (`产品货号`, `产品名称`, `产品装配名称`, `配件编号`, `共用物料编号`, `客户`) before interpolating only the known SQL expression; pass all values through Dapper parameters.

```csharp
var fieldSql = query.查询字段 switch {
    "产品名称" => "b.[产品名称]", "产品装配名称" => "b.[产品装配名称]",
    "配件编号" => "b.[配件编号]", "共用物料编号" => "b.[共用物料编号]",
    "客户" => "b.[客户]", _ => "b.[产品货号]"
};
var match = query.精确 ? keyword : $"%{keyword}%";
```

Clamp page to `>=1` and size to `1..200`; run count and page queries in one open connection. Set `库存单价 = null` before returning when `canSeePrice` is false.

- [ ] **Step 5: Add controller permission boundaries and registrations**

```csharp
[ApiController, Authorize, Route("api/semi-finished-common-materials")]
public sealed class SemiFinishedCommonMaterialController(
    SemiFinishedCommonMaterialService svc,
    IPermissionService perms) : ControllerBase
{
    private const string Menu = "半成品共用物料表";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] SemiFinishedCommonMaterialQuery query)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var canSeePrice = await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);
        return Ok(await svc.ListAsync(query, canSeePrice));
    }
}
```

Add `new("半成品仓库","半成品共用物料表")` to `MenuCatalog.All` and register `SemiFinishedCommonMaterialService` in `Program.cs`.

- [ ] **Step 6: Run focused and full backend tests**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedCommonMaterialsDbTests
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj
```

Expected: focused tests PASS; full suite has no new failure.

- [ ] **Step 7: Commit the list backend**

```powershell
git add src/ErpApi/Features/Warehouse/Semi/CommonMaterials src/ErpApi/Features/Admin/MenuCatalog.cs src/ErpApi/Program.cs tests/ErpApi.Tests/SemiFinishedCommonMaterialsDbTests.cs
git commit -m "feat: add semi-finished common material query"
```

---

### Task 3: Extend Assembly Detail Persistence Transactionally

**Files:**
- Create: `tests/ErpApi.Tests/StyleAssemblyMaterialsDbTests.cs`
- Modify: `src/ErpApi/Features/Styles/StyleDtos.cs`
- Modify: `src/ErpApi/Features/Styles/StyleService.cs`
- Modify: `src/ErpApi/Features/Styles/StyleController.cs`
- Modify: `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialService.cs`
- Modify: `src/ErpApi/Features/Warehouse/Semi/CommonMaterials/SemiFinishedCommonMaterialController.cs`

**Interfaces:**
- Produces: extended `StyleMaterialsViewDto` containing `扩展` and `报价`.
- Produces: extended `BomSaveDto` containing `扩展`, `报价`, and row-level `工模编号`/`备注`.
- Produces: audit and reverse-audit endpoints.

- [ ] **Step 1: Write failing persistence, rollback, and audit tests**

```csharp
[SkippableFact]
public async Task ReplaceMaterials_round_trips_extension_and_quotes()
{
    var payload = new BomSaveDto(
        客户编号: "0003",
        客户名称: "ZURU",
        日期: new DateTime(2026, 7, 13),
        单位: "盒",
        明细: [new StyleMaterialDto(
            物料编号: "MAT-1",
            物料名称: "彩盒",
            物料类别: "包装",
            规格: "41*30MM",
            颜色: "4C",
            单位: "PCS",
            使用数量: 1,
            工模编号: "MOULD-1",
            备注: "主盒彩盒")],
        扩展: new AssemblyMaterialExtensionDto(
            产品装配名称: "产品一装配",
            配件编号: "PART-1",
            共用物料编号: "COMMON-1",
            装配方式: "组装半成品",
            类别: "装彩盒半成品",
            库存单价HK: 2.5m,
            其他成本HK: 0.3m,
            需求用量: 1,
            单位: "盒",
            半成品计算库存: true,
            备注内容: "测试备注",
            调整审核: false,
            审核人: null,
            审核时间: null),
        报价: [new AssemblyMaterialQuoteDto(
            ID: null,
            物料编号: "MAT-1",
            物料名称: "彩盒",
            合作方类型: "加工厂",
            合作方编号: "0088",
            合作方名称: "东莞加工厂",
            报价日期: new DateTime(2026, 7, 13),
            货币: "HK$",
            单价: 2.5m,
            港币价: 2.5m,
            对比相差: 0,
            相差比例: 0,
            是否默认: true,
            顺序: 1,
            备注: null)]);

    await _style.ReplaceMaterialsAsync("STYLE-1", payload);
    var loaded = await _style.GetMaterialsViewAsync("STYLE-1");
    Assert.Equal("COMMON-1", loaded!.扩展.共用物料编号);
    Assert.Equal("加工厂", Assert.Single(loaded.报价).合作方类型);
}

[SkippableFact]
public async Task ReplaceMaterials_rolls_back_all_sections_when_quote_is_invalid()
{
    using var before = fx.Open();
    var originalBomCount = await before.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=N'STYLE-1'");
    var originalCommonCode = await before.ExecuteScalarAsync<string?>(
        "SELECT [共用物料编号] FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'");
    var invalidPayload = ValidPayload() with
    {
        报价 = [new AssemblyMaterialQuoteDto(
            ID: null, 物料编号: "MAT-1", 物料名称: "彩盒", 合作方类型: "其他",
            合作方编号: "X", 合作方名称: "非法合作方", 报价日期: new DateTime(2026, 7, 13),
            货币: "HK$", 单价: 1, 港币价: 1, 对比相差: 0, 相差比例: 0,
            是否默认: false, 顺序: 1, 备注: null)]
    };

    await Assert.ThrowsAsync<InvalidOperationException>(
        () => _style.ReplaceMaterialsAsync("STYLE-1", invalidPayload));

    using var after = fx.Open();
    Assert.Equal(originalBomCount, await after.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=N'STYLE-1'"));
    Assert.Equal(originalCommonCode, await after.ExecuteScalarAsync<string?>(
        "SELECT [共用物料编号] FROM [半成品共用物料设置] WHERE [产品货号]=N'STYLE-1'"));
}

[SkippableFact]
public async Task Audited_style_rejects_save_until_reverse_audit()
{
    var payload = ValidPayload();

    await _common.SetAuditAsync("STYLE-1", true, "auditor");
    await Assert.ThrowsAsync<InvalidOperationException>(
        () => _style.ReplaceMaterialsAsync("STYLE-1", payload));

    await _common.SetAuditAsync("STYLE-1", false, "auditor");
    await _style.ReplaceMaterialsAsync("STYLE-1", payload);

    var loaded = await _style.GetMaterialsViewAsync("STYLE-1");
    Assert.NotNull(loaded);
    Assert.False(loaded!.扩展.调整审核);
}

private static BomSaveDto ValidPayload() => new(
    客户编号: "0003",
    客户名称: "ZURU",
    日期: new DateTime(2026, 7, 13),
    单位: "盒",
    明细: [new StyleMaterialDto(
        物料编号: "MAT-1", 物料名称: "彩盒", 物料类别: "包装",
        规格: "41*30MM", 颜色: "4C", 单位: "PCS", 使用数量: 1,
        工模编号: "MOULD-1", 备注: "主盒彩盒")],
    扩展: new AssemblyMaterialExtensionDto(
        产品装配名称: "产品一装配", 配件编号: "PART-1", 共用物料编号: "COMMON-1",
        装配方式: "组装半成品", 类别: "装彩盒半成品", 库存单价HK: 2.5m,
        其他成本HK: 0.3m, 需求用量: 1, 单位: "盒", 半成品计算库存: true,
        备注内容: "测试备注", 调整审核: false, 审核人: null, 审核时间: null),
    报价: []);
```

- [ ] **Step 2: Run tests and confirm failure**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~StyleAssemblyMaterialsDbTests
```

Expected: FAIL because the extended contracts and persistence are absent.

- [ ] **Step 3: Add the extended contracts**

```csharp
public sealed record AssemblyMaterialExtensionDto(
    string? 产品装配名称, string? 配件编号, string? 共用物料编号,
    string? 装配方式, string? 类别, decimal? 库存单价HK, decimal? 其他成本HK,
    decimal? 需求用量, string? 单位, bool 半成品计算库存, string? 备注内容,
    bool 调整审核, string? 审核人, DateTime? 审核时间);

public sealed record AssemblyMaterialQuoteDto(
    long? ID, string? 物料编号, string? 物料名称, string 合作方类型,
    string? 合作方编号, string? 合作方名称, DateTime? 报价日期, string? 货币,
    decimal? 单价, decimal? 港币价, decimal? 对比相差, decimal? 相差比例,
    bool 是否默认, int 顺序, string? 备注);
```

Add `string? 工模编号, string? 备注` to `StyleMaterialDto`; add `AssemblyMaterialExtensionDto? 扩展` and `List<AssemblyMaterialQuoteDto>? 报价` to `BomSaveDto`; add extension and quote collections to `StyleMaterialsViewDto`.

- [ ] **Step 4: Load all detail sections**

In `GetMaterialsViewAsync`, query the latest header, material rows, one extension row, and ordered quote rows. When no extension exists, return defaults derived from header (`产品装配名称=款式`, `配件编号=产品编号`, `单位=header.单位`, `备注内容=header.备注`).

- [ ] **Step 5: Save all sections in the existing Dapper transaction**

Before deleting data, reject save when `[半成品共用物料设置].[调整审核]=1`. In the same `SqlTransaction`:

1. Replace `[款号物料明细表]` rows.
2. `MERGE` `[半成品共用物料设置]` by 产品货号 without changing audit fields during ordinary save.
3. Delete and reinsert `[装配物料报价]` rows for the product number.
4. Validate `合作方类型 IN (N'加工厂',N'供应商')` before writes.
5. Commit only after all commands succeed; rollback in `catch` and rethrow.

- [ ] **Step 6: Implement audit state methods and endpoints**

```csharp
public Task SetAuditAsync(string 产品货号, bool audited, string user)
```

Use an upsert so auditing an existing BOM without an extension row is valid. Add:

```csharp
[HttpPost("{产品货号}/audit")]
[HttpPost("{产品货号}/reverse-audit")]
```

to the semi controller for list operations, checking the new menu’s `审核`/`反审核`; add equivalent style routes or delegate from `StyleController` while checking `款号资料` permissions so the reused detail page never crosses permission boundaries.

- [ ] **Step 7: Run focused and regression tests**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~StyleAssemblyMaterialsDbTests|FullyQualifiedName~StyleMaterialsDbTests"
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj
```

Expected: all focused tests PASS and existing style material tests remain green.

- [ ] **Step 8: Commit detail persistence**

```powershell
git add src/ErpApi/Features/Styles src/ErpApi/Features/Warehouse/Semi/CommonMaterials tests/ErpApi.Tests/StyleAssemblyMaterialsDbTests.cs
git commit -m "feat: persist assembly material setup details"
```

---

### Task 4: Add Typed Frontend APIs and Pure Query Utilities

**Files:**
- Create: `web/src/api/semiFinishedCommonMaterials.ts`
- Create: `web/src/utils/semiFinishedCommonMaterials.ts`
- Create: `web/src/__tests__/semiFinishedCommonMaterials.test.ts`
- Modify: `web/src/api/styles.ts`

**Interfaces:**
- Produces: `semiFinishedCommonMaterialsApi.list`, `.audit`, `.reverseAudit`.
- Produces: `buildSemiFinishedCommonMaterialParams` and `buildAssemblyMaterialDetailUrl`.

- [ ] **Step 1: Write failing API and utility tests**

```ts
it("normalizes list params and preserves exact mode", () => {
  expect(buildSemiFinishedCommonMaterialParams({ field: "产品货号", keyword: " A-1 ", exact: true }))
    .toEqual({ 查询字段: "产品货号", keyword: "A-1", 精确: true, page: 1, size: 50 });
});

it("builds the assembly detail return URL", () => {
  expect(buildAssemblyMaterialDetailUrl("A/B"))
    .toBe("/assembly-material-setup?款号=A%2FB&return=%2Fsemi-finished-common-materials");
});

it("calls the dedicated backend", async () => {
  await semiFinishedCommonMaterialsApi.audit("A/B");
  expect(clientMock.post).toHaveBeenCalledWith("/semi-finished-common-materials/A%2FB/audit");
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
Set-Location web
npm test -- semiFinishedCommonMaterials.test.ts
```

Expected: FAIL because modules are missing.

- [ ] **Step 3: Define typed API contracts**

```ts
export interface SemiFinishedCommonMaterialRow {
  产品货号: string; 客户?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 库存单价?: number | null; 配件编号?: string | null;
  共用物料编号?: string | null; 调整审核: "已审核" | "未审核"; 备注内容?: string | null;
}
export interface PagedSemiFinishedCommonMaterials { items: SemiFinishedCommonMaterialRow[]; total: number }
```

Implement URL encoding with `encodeURIComponent` and pass list filters through Axios `params`.

- [ ] **Step 4: Extend style API contracts without breaking existing callers**

Add `AssemblyMaterialExtension`, `AssemblyMaterialQuote`, optional `扩展`, and optional `报价` to `StyleMaterialsView` and `BomSave`. Keep every new save property optional so BOM-only callers remain source compatible.

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm test -- semiFinishedCommonMaterials.test.ts
npm run build
```

Expected: test PASS; TypeScript and Vite build exit `0`.

- [ ] **Step 6: Commit API contracts**

```powershell
git add web/src/api/semiFinishedCommonMaterials.ts web/src/api/styles.ts web/src/utils/semiFinishedCommonMaterials.ts web/src/__tests__/semiFinishedCommonMaterials.test.ts
git commit -m "feat: add semi-finished common material client"
```

---

### Task 5: Build the Unified Modern List Page

**Files:**
- Create: `web/src/pages/semi/SemiFinishedCommonMaterialsPage.tsx`
- Create: `web/src/__tests__/semiFinishedCommonMaterialsPage.test.ts`
- Modify: `web/src/nav/menuTree.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 4 typed API and URL builder.
- Produces: route `/semi-finished-common-materials` and real menu item under `g-semi`.

- [ ] **Step 1: Write failing page interaction tests**

Mock permissions, API, router navigation, and Ant Design. Assert:

```ts
expect(pageSource).toContain('const MENU = "半成品共用物料表"');
expect(pageSource).toContain("onDoubleClick");
expect(pageSource).toContain("variant=\"borderless\"");
expect(menuSource).toContain('M("半成品共用物料表", "/semi-finished-common-materials", "半成品共用物料表")');
```

Mount the page, change `重复内容` to `显示重复`, click `精确查询`, and assert API receives the server-side filters. Invoke row `onDoubleClick` and assert navigation to the encoded assembly detail URL.

- [ ] **Step 2: Run and verify failure**

```powershell
Set-Location web
npm test -- semiFinishedCommonMaterialsPage.test.ts
```

Expected: FAIL because the page and route do not exist.

- [ ] **Step 3: Implement the filter toolbar and table**

Use one borderless `Card`, compact `Space`/`Select`/`Input`, and a horizontally scrollable `Table`. Columns must be exactly:

```ts
const columns = [
  "客户", "产品货号", "产品名称", "产品装配名称", "库存单价",
  "配件编号", "共用物料编号", "调整审核", "备注内容",
];
```

Render price as `***` when null, audit as a status `Tag`, use server pagination, and ignore stale responses using a monotonically increasing request id.

- [ ] **Step 4: Implement selection and double-click navigation**

```tsx
onRow={row => ({
  onClick: () => setSelectedKey(row.产品货号),
  onDoubleClick: () => row.产品货号
    ? navigate(buildAssemblyMaterialDetailUrl(row.产品货号))
    : message.warning("该记录缺少产品货号，无法打开详情"),
})}
```

Preserve filter state in `sessionStorage` before navigating and restore it on remount.

- [ ] **Step 5: Wire menu and route**

Replace the placeholder with:

```ts
M("半成品共用物料表", "/semi-finished-common-materials", "半成品共用物料表")
```

Import the page in `App.tsx` and add `<Route path="semi-finished-common-materials" element={<SemiFinishedCommonMaterialsPage />} />`.

- [ ] **Step 6: Run page tests and production build**

```powershell
npm test -- semiFinishedCommonMaterialsPage.test.ts semiFinishedCommonMaterials.test.ts
npm run build
```

Expected: tests PASS and build exits `0`.

- [ ] **Step 7: Commit the list UI**

```powershell
git add web/src/pages/semi/SemiFinishedCommonMaterialsPage.tsx web/src/__tests__/semiFinishedCommonMaterialsPage.test.ts web/src/nav/menuTree.tsx web/src/App.tsx
git commit -m "feat: add semi-finished common material page"
```

---

### Task 6: Connect the Editable Assembly Detail and Return Flow

**Files:**
- Create: `web/src/__tests__/bomSetupAssemblyPersistence.test.ts`
- Modify: `web/src/pages/styles/BomSetupPage.tsx`

**Interfaces:**
- Consumes: extended `stylesApi.materials` and `stylesApi.saveMaterials` contracts.
- Produces: editable persisted extension/quotes, audit actions, read-only audited state, and `return` navigation.

- [ ] **Step 1: Write failing detail regression tests**

Use source and component mocks to assert:

```ts
it("hydrates and saves extension plus quotes", async () => {
  const extension = {
    产品装配名称: "产品一装配",
    配件编号: "PART-1",
    共用物料编号: "COMMON-1",
    装配方式: "组装半成品",
    类别: "装彩盒半成品",
    库存单价HK: 2.5,
    其他成本HK: 0.3,
    需求用量: 1,
    单位: "盒",
    半成品计算库存: true,
    备注内容: "测试备注",
    调整审核: false,
    审核人: null,
    审核时间: null,
  };
  const quotes = [{
    ID: 1,
    物料编号: "MAT-1",
    物料名称: "彩盒",
    合作方类型: "加工厂",
    合作方编号: "0088",
    合作方名称: "东莞加工厂",
    报价日期: "2026-07-13",
    货币: "HK$",
    单价: 2.5,
    港币价: 2.5,
    对比相差: 0,
    相差比例: 0,
    是否默认: true,
    顺序: 1,
    备注: "",
  }];
  materialsMock.mockResolvedValue({
    款号: "STYLE-1",
    款式: "产品一",
    物料: [],
    扩展: extension,
    报价: quotes,
  });

  render(<BomSetupPage />);
  await screen.findByDisplayValue("产品一装配");
  fireEvent.change(screen.getByLabelText("产品装配名称"), {
    target: { value: "产品一装配新版" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(saveMock).toHaveBeenCalledWith(
    "STYLE-1",
    expect.objectContaining({
      扩展: expect.objectContaining({ 产品装配名称: "产品一装配新版" }),
      报价: quotes,
    }),
  ));
});

it("returns to the supplied list route on close", () => {
  expect(buildCloseTarget("/semi-finished-common-materials")).toBe("/semi-finished-common-materials");
});

it("disables editable controls when adjusted audit is true", async () => {
  materialsMock.mockResolvedValue({
    款号: "STYLE-1",
    款式: "产品一",
    物料: [],
    扩展: {
      产品装配名称: "产品一装配",
      配件编号: "PART-1",
      共用物料编号: "COMMON-1",
      装配方式: "组装半成品",
      类别: "装彩盒半成品",
      库存单价HK: 2.5,
      其他成本HK: 0.3,
      需求用量: 1,
      单位: "盒",
      半成品计算库存: true,
      备注内容: "测试备注",
      调整审核: true,
      审核人: "auditor",
      审核时间: "2026-07-13T09:00:00",
    },
    报价: [],
  });

  render(<BomSetupPage />);
  await screen.findByDisplayValue("产品一");

  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByLabelText("产品装配名称")).toBeDisabled();
  expect(screen.getByRole("button", { name: "反审核" })).toBeEnabled();
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
Set-Location web
npm test -- bomSetupAssemblyPersistence.test.ts
```

Expected: FAIL because extension fields are not hydrated or saved.

- [ ] **Step 3: Hydrate all editable fields from the service**

In `loadDoc`, map `full.扩展` to `HeaderForm`, map row `工模编号` and `备注`, and map `full.报价` to quote rows. Do not generate placeholder quote data when persisted rows exist.

- [ ] **Step 4: Include all sections in `buildBody`**

```ts
const body: BomSave = {
  客户编号: v.客户编号 || undefined,
  客户名称: v.客户名称 || undefined,
  日期: v.日期?.format("YYYY-MM-DD"),
  单位: v.单位 || undefined,
  扩展: {
    产品装配名称: v.产品装配名称, 配件编号: v.配件编号,
    共用物料编号: v.共用物料编号, 装配方式: v.装配方式,
    类别: v.类别, 库存单价HK: v.库存单价, 其他成本HK: v.其他成本,
    需求用量: v.需求用量, 单位: v.单位,
    半成品计算库存: !!v.半成品计算库存, 备注内容: v.备注,
  },
  明细: materialRows,
  报价: quoteRows,
};
```

- [ ] **Step 5: Add audit/read-only and close behavior**

Read `const returnTo = sp.get("return")`; close via `navigate(returnTo || -1)`. When `full.扩展?.调整审核` is true, disable all editable fields and the save/delete actions. Wire 审核 and 反审核 buttons to the dedicated endpoints, refresh after success, and display success/error messages.

- [ ] **Step 6: Run focused tests and full frontend suite**

```powershell
npm test -- bomSetupAssemblyPersistence.test.ts semiFinishedCommonMaterialsPage.test.ts
npm test
npm run build
```

Expected: focused and full tests PASS; build exits `0`.

- [ ] **Step 7: Commit the detail integration**

```powershell
git add web/src/pages/styles/BomSetupPage.tsx web/src/__tests__/bomSetupAssemblyPersistence.test.ts
git commit -m "feat: connect common materials to assembly setup"
```

---

### Task 7: Apply, Publish, Restart Hidden, and Verify End to End

**Files:**
- Modify generated output only: `src/ErpApi/wwwroot/**`
- Modify generated output only: `publish/**`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a terminal-independent local published service on ports `5000` and `5173`.

- [ ] **Step 1: Run clean verification commands**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj
Set-Location web
npm test
npm run build
Set-Location ..
dotnet build src/ErpApi/ErpApi.csproj -c Release
```

Expected: every command exits `0`; record exact test totals and generated asset name.

- [ ] **Step 2: Reapply migration and permission seed**

```powershell
dotnet run --project tools/DbDeploy -- db/migrate_semi_finished_common_materials.sql
dotnet run --project tools/DbDeploy -- db/seed_semi_finished_common_materials_perms.sql
```

Expected: both commands exit `0`; admin has `打开=True`, `单价=True`, `审核=True`, `反审核=True` for the new menu.

- [ ] **Step 3: Publish frontend and backend**

Run the repository publish script. It executes `npm run build`, replaces `src/ErpApi/wwwroot` with `web/dist`, and publishes the API to `publish/erpapi`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-windows.ps1
```

Expected: the command exits `0`, prints a `Published to:` path ending in `publish\erpapi`, and `publish/erpapi/wwwroot/index.html` references the latest Vite asset.

- [ ] **Step 4: Restart the published service without a visible terminal**

Use `Get-NetTCPConnection -LocalPort 5000,5173 -State Listen` to identify the current owning process, confirm its executable path belongs to this repository, and stop only that PID. Launch `wscript.exe scripts/start-published-hidden.vbs`; the script starts `scripts/run-published.cmd` without a window and appends logs to `erpapi.stdout.log` and `erpapi.stderr.log`. Verify a new PID owns both ports with `Get-NetTCPConnection`.

- [ ] **Step 5: Verify HTTP and browser behavior**

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5173/semi-finished-common-materials
Invoke-WebRequest -UseBasicParsing http://localhost:5000/swagger
```

Expected: both return status `200`. In the browser, verify list filters, horizontal scrolling, row selection, double-click detail, edit/save/refresh persistence, audit read-only state, reverse-audit editing, and close return. Check at desktop and narrow viewport that controls do not overlap.

- [ ] **Step 6: Confirm terminal independence**

Close any development terminals, wait 10 seconds, and request both URLs again. Expected: status `200` and the hidden published PID remains listening.

- [ ] **Step 7: Review the final diff and commit owned generated assets only when repository policy tracks them**

```powershell
git status --short
git diff --check
```

Confirm no辅料、塑胶 or unrelated user files were changed. If generated publish assets are tracked by this repository, stage only `src/ErpApi/wwwroot`; otherwise leave generated output uncommitted and report it as deployment output.

---

## Final Acceptance Checklist

- [ ] The menu appears only under 半成品仓库 and opens `/semi-finished-common-materials`.
- [ ] The list fields and filters match the approved design.
- [ ] Price permission is enforced by the API.
- [ ] Double-click opens the correct product in the existing assembly editor.
- [ ] Extension fields, BOM rows, and quotes survive save and refresh.
- [ ] Audit prevents editing; reverse audit restores it.
- [ ] Closing detail returns to the list with filters restored.
- [ ] Backend tests, frontend tests, production build, and HTTP checks pass.
- [ ] Closing visible terminals does not stop the website.
- [ ] 辅料报表, 塑胶共用物料表, and 装配物料汇总表 remain unchanged.
