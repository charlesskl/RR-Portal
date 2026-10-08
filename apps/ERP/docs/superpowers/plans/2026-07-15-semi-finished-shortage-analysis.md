# 半成品欠料分析表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“半成品仓库”下实现统一现代 ERP 风格的“半成品欠料分析表”，实时计算已审核且未完成生产制单的半成品需求、全部半成品仓库库存和实际欠料。

**Architecture:** 新增独立的 `Warehouse/Semi/ShortageAnalysis` 后端功能目录，由服务使用单个 SQL 批次完成需求、产品与配件映射、全仓库存、欠料、筛选、排序和分页。前端新增类型化 API 与独立报表页，沿用现有 Ant Design、权限上下文、分页表格、CSV 导出和打印交互；页面只呈现后端计算结果，不在浏览器重复业务计算。

**Tech Stack:** ASP.NET Core 8、Dapper、SQL Server、xUnit、React 19、TypeScript 6、Ant Design 6、Axios、Vitest。

## Global Constraints

- 路由固定为 `/semi-finished-shortage-analysis`，接口固定为 `/api/semi-finished-shortage-analysis`。
- 菜单必须位于“半成品仓库”，显示名称与权限菜单名均为“半成品欠料分析表”。
- 需求只取 `[生产制单]` 中 `[审核]='1'` 且 `ISNULL([完成],N'否')<>N'是'` 的记录，并按客户、产品货号、产品名称汇总 `[计划数量]`。
- 产品货号只通过 `[半成品共用物料设置]` 中非空 `[配件编号]` 映射到配件编号、产品装配名称和单位。
- 库存必须汇总所有仓库中已审核的半成品入仓、领料和盘点盈亏，不得增加单仓库过滤。
- 欠料数量固定为 `max(需求数量 - 库存数量, 0)`，接口只返回欠料数量大于 0 的行。
- 所有数量在 C# 和 SQL 中使用 `decimal` / `decimal(18,4)`，不得使用浮点数。
- 查询字段只允许 `productCode`、`productName`、`customer`、`partCode`；普通查询使用包含匹配，精确查询使用完全匹配。
- 默认稳定排序为客户、产品货号、配件编号升序；列表响应包含 `items`、`total`、`page`、`pageSize`。
- 项目现有权限模型没有独立“导出”动作；遵循本地约定，以“打印”权限同时控制导出 Excel 与打印，并在导出接口再次校验。
- 导出接口使用与列表相同的筛选和排序，不受当前分页限制；文件采用本项目 Excel 可直接打开的 UTF-8 BOM CSV。
- 前端必须沿用现有现代 ERP 报表页结构，不复刻旧 Windows 窗口样式，不修改无关页面。
- 工作树已有其他改动；只暂存本计划列出的文件，不覆盖或回退用户现有修改。

---

## File Map

- Create `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageDtos.cs`: 查询、行数据和分页结果契约。
- Create `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/ISemiFinishedShortageService.cs`: 控制器依赖的服务接口。
- Create `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageService.cs`: 实时 SQL 聚合、筛选、稳定排序、分页和全量导出数据。
- Create `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageController.cs`: 打开权限、打印权限、列表和 CSV 导出。
- Modify `src/ErpApi/Program.cs`: 注册新服务。
- Modify `src/ErpApi/Features/Admin/MenuCatalog.cs`: 注册“半成品仓库 / 半成品欠料分析表”权限菜单。
- Create `tests/ErpApi.Tests/SemiFinishedShortageServiceDbTests.cs`: 数据口径、查询、分页和排序的 SQL 集成测试。
- Create `tests/ErpApi.Tests/SemiFinishedShortageControllerTests.cs`: 打开/导出权限和 CSV 响应测试。
- Create `web/src/api/semiFinishedShortageAnalysis.ts`: 前端查询类型、结果类型、列表请求和导出请求。
- Create `web/src/utils/semiFinishedShortageAnalysis.ts`: 查询参数规范化、数量格式和导出文件触发。
- Create `web/src/__tests__/semiFinishedShortageAnalysisApi.test.ts`: API 参数和 Blob 导出测试。
- Create `web/src/pages/semi/SemiFinishedShortageAnalysisPage.tsx`: 统一现代报表页面。
- Create `web/src/__tests__/semiFinishedShortageAnalysisPage.test.tsx`: 页面查询、权限、分页、导出、打印和导航测试。
- Modify `web/src/App.tsx`: 注册真实路由。
- Modify `web/src/nav/menuTree.tsx`: 将占位菜单替换为真实路由和权限菜单名。

---

### Task 1: Backend aggregation contract and SQL service

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageDtos.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/ISemiFinishedShortageService.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageService.cs`
- Test: `tests/ErpApi.Tests/SemiFinishedShortageServiceDbTests.cs`

**Interfaces:**
- Consumes: `ErpApi.Infrastructure.Db.ISqlConnectionFactory.Create()` and the existing SQL Server tables `[生产制单]`, `[半成品共用物料设置]`, `[半成品入仓单/明细单]`, `[半成品领料单/明细单]`, `[半成品盘点单/明细单]`.
- Produces: `Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query)` and `Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query)`.

- [ ] **Step 1: Write the failing database tests**

Create `tests/ErpApi.Tests/SemiFinishedShortageServiceDbTests.cs` with deterministic records prefixed `SFS-` and the following test cases:

```csharp
using Dapper;
using ErpApi.Features.Warehouse.Semi.ShortageAnalysis;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

[Collection("db")]
public sealed class SemiFinishedShortageServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SemiFinishedShortageService Service() => new(Factory());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品领料单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品盘点单] WHERE [单号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] LIKE N'SFS-%'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号] LIKE N'SFS-%'");
    }

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute(@"
INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核],[完成]) VALUES
(N'SFS-MO-1',N'SFS-P1',N'测试产品甲',N'C01',N'客户甲',10,'1',N'否'),
(N'SFS-MO-2',N'SFS-P1',N'测试产品甲',N'C01',N'客户甲',5,'1',N'否'),
(N'SFS-MO-3',N'SFS-P2',N'测试产品乙',N'C02',N'客户乙',8,'0',N'否'),
(N'SFS-MO-4',N'SFS-P3',N'测试产品丙',N'C03',N'客户丙',9,'1',N'是'),
(N'SFS-MO-5',N'SFS-P4',N'测试产品丁',N'C04',N'客户丁',7,'1',N'否');
INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[单位]) VALUES
(N'SFS-P1',N'装配甲',N'SFS-A1',N'PCS'),
(N'SFS-P2',N'装配乙',N'SFS-A2',N'PCS'),
(N'SFS-P3',N'装配丙',N'SFS-A3',N'PCS'),
(N'SFS-P4',N'装配丁',N'',N'PCS');
INSERT INTO [半成品入仓单]([单号],[日期],[审核]) VALUES
(N'SFS-IN-1','2026-07-01','1'),(N'SFS-IN-2','2026-07-01','1'),(N'SFS-IN-X','2026-07-01','0');
INSERT INTO [半成品入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[颜色],[数量]) VALUES
(N'SFS-IN-1',N'半成品仓A',N'SFS-A1',N'装配甲',N'',N'',3),
(N'SFS-IN-2',N'半成品仓B',N'SFS-A1',N'装配甲',N'',N'',4),
(N'SFS-IN-X',N'半成品仓A',N'SFS-A1',N'装配甲',N'',N'',100);
INSERT INTO [半成品领料单]([单号],[日期],[审核]) VALUES (N'SFS-OUT-1','2026-07-02','1');
INSERT INTO [半成品领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[颜色],[数量]) VALUES
(N'SFS-OUT-1',N'半成品仓B',N'SFS-A1',N'装配甲',N'',N'',2);
INSERT INTO [半成品盘点单]([单号],[日期],[审核]) VALUES (N'SFS-ST-1','2026-07-03','1');
INSERT INTO [半成品盘点明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[颜色],[盈亏数量]) VALUES
(N'SFS-ST-1',N'半成品仓A',N'SFS-A1',N'装配甲',N'',N'',1);");
    }

    [SkippableFact]
    public async Task List_uses_only_approved_unfinished_demand_and_all_warehouses()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var result = await Service().ListAsync(new());
            var row = Assert.Single(result.Items);
            Assert.Equal("客户甲", row.Customer);
            Assert.Equal("SFS-P1", row.ProductCode);
            Assert.Equal("SFS-A1", row.PartCode);
            Assert.Equal(15m, row.RequiredQuantity);
            Assert.Equal(6m, row.InventoryQuantity); // 3 + 4 - 2 + 1; unapproved +100 excluded
            Assert.Equal(9m, row.ShortageQuantity);
            Assert.Equal(1, result.Total);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task List_excludes_completed_unapproved_unmapped_and_fully_stocked_rows()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var result = await Service().ListAsync(new());
            Assert.DoesNotContain(result.Items, x => x.ProductCode is "SFS-P2" or "SFS-P3" or "SFS-P4");

            c.Execute("UPDATE [半成品入仓明细单] SET [数量]=20 WHERE [单号]=N'SFS-IN-1'");
            Assert.Empty((await Service().ListAsync(new())).Items);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task List_supports_contains_exact_paging_and_stable_order()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户名称],[计划数量],[审核],[完成])
VALUES(N'SFS-MO-6',N'SFS-P5',N'测试产品戊',N'客户乙',4,'1',N'否');
INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[单位])
VALUES(N'SFS-P5',N'装配戊',N'SFS-A5',N'PCS');");

            var contains = await Service().ListAsync(new() { Field = "productName", Keyword = "产品", Page = 1, PageSize = 1 });
            Assert.Equal(2, contains.Total);
            Assert.Single(contains.Items);
            Assert.Equal("SFS-P1", contains.Items[0].ProductCode);
            Assert.Equal(1, contains.Page);
            Assert.Equal(1, contains.PageSize);

            var exact = await Service().ListAsync(new() { Field = "partCode", Keyword = "SFS-A5", Exact = true });
            Assert.Equal("SFS-P5", Assert.Single(exact.Items).ProductCode);
        }
        finally { Clean(c); }
    }
}
```

- [ ] **Step 2: Run the database test and verify the contract is missing**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedShortageServiceDbTests
```

Expected: FAIL at compile time because `ErpApi.Features.Warehouse.Semi.ShortageAnalysis` and `SemiFinishedShortageService` do not exist.

- [ ] **Step 3: Add DTOs and the service interface**

Create `SemiFinishedShortageDtos.cs`:

```csharp
namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public sealed class SemiFinishedShortageQuery
{
    public string Field { get; set; } = "productCode";
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public sealed class SemiFinishedShortageRow
{
    public string Customer { get; set; } = "";
    public string ProductCode { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string PartCode { get; set; } = "";
    public string AssemblyName { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal RequiredQuantity { get; set; }
    public decimal InventoryQuantity { get; set; }
    public decimal ShortageQuantity { get; set; }
}

public sealed record SemiFinishedShortageResult(
    IReadOnlyList<SemiFinishedShortageRow> Items,
    int Total,
    int Page,
    int PageSize);
```

Create `ISemiFinishedShortageService.cs`:

```csharp
namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public interface ISemiFinishedShortageService
{
    Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query);
    Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query);
}
```

- [ ] **Step 4: Implement the real-time SQL service**

Create `SemiFinishedShortageService.cs`. Use one shared SQL builder for list and export. Materialize the calculated rows into `#Shortages`, then apply the field whitelist, exact/contains mode, stable ordering and optional pagination:

```csharp
using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public sealed class SemiFinishedShortageService(ISqlConnectionFactory factory) : ISemiFinishedShortageService
{
    private static readonly IReadOnlyDictionary<string, string> Fields =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["productCode"] = "ProductCode",
            ["productName"] = "ProductName",
            ["customer"] = "Customer",
            ["partCode"] = "PartCode",
        };

    private const string AggregateSql = @"
;WITH Demand AS (
    SELECT
        COALESCE(NULLIF(LTRIM(RTRIM([客户名称])),N''), NULLIF(LTRIM(RTRIM([客户编号])),N''), N'') AS Customer,
        LTRIM(RTRIM([款号])) AS ProductCode,
        MAX(ISNULL([款式],N'')) AS ProductName,
        SUM(CAST(ISNULL([计划数量],0) AS decimal(18,4))) AS RequiredQuantity
    FROM [生产制单]
    WHERE ISNULL([审核],'0')='1'
      AND ISNULL([完成],N'否')<>N'是'
      AND NULLIF(LTRIM(RTRIM([款号])),N'') IS NOT NULL
    GROUP BY COALESCE(NULLIF(LTRIM(RTRIM([客户名称])),N''), NULLIF(LTRIM(RTRIM([客户编号])),N''), N''), LTRIM(RTRIM([款号]))
), Mappings AS (
    SELECT DISTINCT
        LTRIM(RTRIM([产品货号])) AS ProductCode,
        LTRIM(RTRIM([配件编号])) AS PartCode,
        ISNULL([产品装配名称],N'') AS AssemblyName,
        ISNULL([单位],N'') AS Unit
    FROM [半成品共用物料设置]
    WHERE NULLIF(LTRIM(RTRIM([产品货号])),N'') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM([配件编号])),N'') IS NOT NULL
), Movements AS (
    SELECT LTRIM(RTRIM(d.[物料编号])) AS PartCode, CAST(ISNULL(d.[数量],0) AS decimal(18,4)) AS Quantity
    FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT LTRIM(RTRIM(d.[物料编号])), CAST(ISNULL(d.[数量],0) AS decimal(18,4))*-1
    FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT LTRIM(RTRIM(d.[物料编号])), CAST(ISNULL(d.[盈亏数量],0) AS decimal(18,4))
    FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(h.[审核],'0')='1'
), Inventory AS (
    SELECT PartCode, SUM(Quantity) AS InventoryQuantity
    FROM Movements
    WHERE NULLIF(PartCode,N'') IS NOT NULL
    GROUP BY PartCode
)
SELECT
    d.Customer,
    d.ProductCode,
    d.ProductName,
    m.PartCode,
    m.AssemblyName,
    m.Unit,
    CAST(d.RequiredQuantity AS decimal(18,4)) AS RequiredQuantity,
    CAST(ISNULL(i.InventoryQuantity,0) AS decimal(18,4)) AS InventoryQuantity,
    CAST(d.RequiredQuantity-ISNULL(i.InventoryQuantity,0) AS decimal(18,4)) AS ShortageQuantity
INTO #Shortages
FROM Demand d
JOIN Mappings m ON m.ProductCode=d.ProductCode
LEFT JOIN Inventory i ON i.PartCode=m.PartCode
WHERE d.RequiredQuantity-ISNULL(i.InventoryQuantity,0)>0;
";

    public Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query) => QueryAsync(query, true);

    public async Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query) =>
        (await QueryAsync(query, false)).Items;

    private async Task<SemiFinishedShortageResult> QueryAsync(SemiFinishedShortageQuery query, bool paged)
    {
        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 200);
        var field = Fields.TryGetValue(query.Field ?? "", out var selected) ? selected : "ProductCode";
        var keyword = query.Keyword?.Trim();
        var where = string.IsNullOrEmpty(keyword)
            ? ""
            : query.Exact ? $"WHERE [{field}]=@Keyword" : $"WHERE [{field}] LIKE N'%'+@Keyword+N'%'";
        var paging = paged ? "OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY" : "";
        var sql = AggregateSql + $@"
SELECT COUNT(1) FROM #Shortages {where};
SELECT Customer,ProductCode,ProductName,PartCode,AssemblyName,Unit,
       RequiredQuantity,InventoryQuantity,ShortageQuantity
FROM #Shortages {where}
ORDER BY Customer,ProductCode,PartCode
{paging};";

        using var connection = factory.Create();
        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            Keyword = keyword,
            Offset = (page - 1) * pageSize,
            PageSize = pageSize,
        });
        var total = await multi.ReadSingleAsync<int>();
        var items = (await multi.ReadAsync<SemiFinishedShortageRow>()).AsList();
        return new(items, total, page, pageSize);
    }
}
```

- [ ] **Step 5: Run the service tests and verify they pass**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedShortageServiceDbTests
```

Expected: PASS when `ERP_TEST_DB` is available; otherwise every database test reports SKIP with the existing fixture message, with no compile failure.

- [ ] **Step 6: Commit the backend aggregation slice**

```powershell
git add src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis tests/ErpApi.Tests/SemiFinishedShortageServiceDbTests.cs
git commit -m "feat: add semi-finished shortage aggregation"
```

---

### Task 2: Authorized list and export endpoints

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageController.cs`
- Modify: `src/ErpApi/Program.cs`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Test: `tests/ErpApi.Tests/SemiFinishedShortageControllerTests.cs`

**Interfaces:**
- Consumes: `ISemiFinishedShortageService.ListAsync(...)`, `ISemiFinishedShortageService.ExportAsync(...)`, `IPermissionService.HasAsync(user, "半成品欠料分析表", action)`.
- Produces: `GET /api/semi-finished-shortage-analysis` JSON and `GET /api/semi-finished-shortage-analysis/export` UTF-8 BOM CSV.

- [ ] **Step 1: Write failing controller tests**

Create `SemiFinishedShortageControllerTests.cs` using a small fake service and fake permission service. Cover these exact outcomes:

```csharp
public sealed class SemiFinishedShortageControllerTests
{
    [Fact]
    public async Task List_forbids_without_open_permission()
    {
        var controller = Controller(open: false, print: false, out _);
        Assert.IsType<ForbidResult>(await controller.List(new()));
    }

    [Fact]
    public async Task List_returns_service_result_with_open_permission()
    {
        var controller = Controller(open: true, print: false, out var service);
        service.ListResult = new([Row()], 1, 1, 50);
        var ok = Assert.IsType<OkObjectResult>(await controller.List(new()));
        Assert.Same(service.ListResult, ok.Value);
    }

    [Fact]
    public async Task Export_forbids_without_print_permission()
    {
        var controller = Controller(open: true, print: false, out _);
        Assert.IsType<ForbidResult>(await controller.Export(new()));
    }

    [Fact]
    public async Task Export_returns_bom_csv_in_page_column_order()
    {
        var controller = Controller(open: true, print: true, out var service);
        service.ExportRows = [Row()];
        var file = Assert.IsType<FileContentResult>(await controller.Export(new()));
        var text = System.Text.Encoding.UTF8.GetString(file.FileContents);
        Assert.StartsWith("\uFEFF客户,产品货号,产品名称,配件编号,产品装配名称,单位,需求数量,库存数量,欠料数量", text);
        Assert.Contains("客户甲,SFS-P1,产品甲,SFS-A1,装配甲,PCS,15,6,9", text);
        Assert.Equal("text/csv; charset=utf-8", file.ContentType);
    }
}
```

Add these concrete helpers in the same test file so controller tests stay independent from SQL:

```csharp
private static SemiFinishedShortageController Controller(
    bool open,
    bool print,
    out FakeShortageService service)
{
    service = new FakeShortageService();
    var controller = new SemiFinishedShortageController(
        service,
        new FakePermissionService(open, print));
    controller.ControllerContext = new ControllerContext
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, "tester")],
                "test")),
        },
    };
    return controller;
}

private static SemiFinishedShortageRow Row() => new()
{
    Customer = "客户甲",
    ProductCode = "SFS-P1",
    ProductName = "产品甲",
    PartCode = "SFS-A1",
    AssemblyName = "装配甲",
    Unit = "PCS",
    RequiredQuantity = 15m,
    InventoryQuantity = 6m,
    ShortageQuantity = 9m,
};

private sealed class FakeShortageService : ISemiFinishedShortageService
{
    public SemiFinishedShortageResult ListResult { get; set; } = new([], 0, 1, 50);
    public IReadOnlyList<SemiFinishedShortageRow> ExportRows { get; set; } = [];

    public Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query) =>
        Task.FromResult(ListResult);

    public Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query) =>
        Task.FromResult(ExportRows);
}

private sealed class FakePermissionService(bool open, bool print) : IPermissionService
{
    public Task<bool> HasAsync(string userName, string menu, PermissionAction action) =>
        Task.FromResult(action switch
        {
            PermissionAction.打开 => open,
            PermissionAction.打印 => print,
            _ => false,
        });

    public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName) =>
        Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(
            new Dictionary<string, PermissionFlags>());
}
```

Include these imports at the top of the test file:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Warehouse.Semi.ShortageAnalysis;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
```

- [ ] **Step 2: Run the controller tests and verify the controller is missing**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedShortageControllerTests
```

Expected: FAIL at compile time because `SemiFinishedShortageController` does not exist.

- [ ] **Step 3: Implement controller permission checks and CSV escaping**

Create `SemiFinishedShortageController.cs`:

```csharp
using System.Security.Claims;
using System.Text;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

[ApiController, Authorize, Route("api/semi-finished-shortage-analysis")]
public sealed class SemiFinishedShortageController(
    ISemiFinishedShortageService service,
    IPermissionService permissions) : ControllerBase
{
    private const string Menu = "半成品欠料分析表";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] SemiFinishedShortageQuery query)
    {
        if (!await permissions.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await service.ListAsync(query));
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] SemiFinishedShortageQuery query)
    {
        if (!await permissions.HasAsync(CurrentUser, Menu, PermissionAction.打开) ||
            !await permissions.HasAsync(CurrentUser, Menu, PermissionAction.打印)) return Forbid();

        var rows = await service.ExportAsync(query);
        var csv = new StringBuilder("\uFEFF客户,产品货号,产品名称,配件编号,产品装配名称,单位,需求数量,库存数量,欠料数量\r\n");
        foreach (var row in rows)
        {
            csv.AppendLine(string.Join(',', new[]
            {
                Cell(row.Customer), Cell(row.ProductCode), Cell(row.ProductName), Cell(row.PartCode),
                Cell(row.AssemblyName), Cell(row.Unit), row.RequiredQuantity.ToString("0.####"),
                row.InventoryQuantity.ToString("0.####"), row.ShortageQuantity.ToString("0.####"),
            }));
        }
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv; charset=utf-8", "半成品欠料分析表.csv");
    }

    private static string Cell(string value) =>
        value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
}
```

- [ ] **Step 4: Register the service and permission menu**

Add to `Program.cs` next to the other semi-finished registrations:

```csharp
builder.Services.AddScoped<
    ErpApi.Features.Warehouse.Semi.ShortageAnalysis.ISemiFinishedShortageService,
    ErpApi.Features.Warehouse.Semi.ShortageAnalysis.SemiFinishedShortageService>();
```

Add to `MenuCatalog.cs` inside the “半成品仓库” block:

```csharp
new("半成品仓库", "半成品欠料分析表"),
```

- [ ] **Step 5: Run controller and full backend tests**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedShortage
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --no-restore
```

Expected: both commands PASS, with database-only cases allowed to SKIP when `ERP_TEST_DB` is not configured.

- [ ] **Step 6: Commit the HTTP and permission slice**

```powershell
git add src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis/SemiFinishedShortageController.cs src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs tests/ErpApi.Tests/SemiFinishedShortageControllerTests.cs
git commit -m "feat: expose semi-finished shortage report"
```

---

### Task 3: Typed frontend API and query helpers

**Files:**
- Create: `web/src/api/semiFinishedShortageAnalysis.ts`
- Create: `web/src/utils/semiFinishedShortageAnalysis.ts`
- Test: `web/src/__tests__/semiFinishedShortageAnalysisApi.test.ts`

**Interfaces:**
- Consumes: shared Axios client `api` from `web/src/api/client.ts`.
- Produces: `semiFinishedShortageAnalysisApi.list(query)`, `.export(query)`, `normalizeShortageQuery(...)`, `formatShortageQuantity(...)`, and `downloadShortageExport(...)`.

- [ ] **Step 1: Write failing API/helper tests**

Create `web/src/__tests__/semiFinishedShortageAnalysisApi.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { semiFinishedShortageAnalysisApi } from "../api/semiFinishedShortageAnalysis";
import {
  formatShortageQuantity,
  normalizeShortageQuery,
} from "../utils/semiFinishedShortageAnalysis";

const get = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api: { get } }));

describe("semi-finished shortage API", () => {
  beforeEach(() => get.mockReset());

  it("normalizes blank filters and clamps paging", () => {
    expect(normalizeShortageQuery({ field: "customer", keyword: "  客户甲  ", exact: true, page: 0, pageSize: 999 }))
      .toEqual({ field: "customer", keyword: "客户甲", exact: true, page: 1, pageSize: 200 });
  });

  it("requests the list and export endpoints with the same filter", async () => {
    const query = { field: "partCode" as const, keyword: "A1", exact: false, page: 2, pageSize: 50 };
    get.mockResolvedValueOnce({ data: { items: [], total: 0, page: 2, pageSize: 50 } });
    await semiFinishedShortageAnalysisApi.list(query);
    expect(get).toHaveBeenNthCalledWith(1, "/semi-finished-shortage-analysis", { params: query });

    const blob = new Blob(["csv"]);
    get.mockResolvedValueOnce({ data: blob });
    await semiFinishedShortageAnalysisApi.export(query);
    expect(get).toHaveBeenNthCalledWith(2, "/semi-finished-shortage-analysis/export", {
      params: query,
      responseType: "blob",
    });
  });

  it("formats decimal quantities without forced trailing zeroes", () => {
    expect(formatShortageQuantity(12)).toBe("12");
    expect(formatShortageQuantity(12.5)).toBe("12.5");
    expect(formatShortageQuantity(1234.25)).toBe("1,234.25");
  });
});
```

- [ ] **Step 2: Run the frontend test and verify imports are missing**

Run:

```powershell
npm --prefix web test -- semiFinishedShortageAnalysisApi.test.ts
```

Expected: FAIL because both new modules do not exist.

- [ ] **Step 3: Implement the typed API**

Create `web/src/api/semiFinishedShortageAnalysis.ts`:

```ts
import { api } from "./client";

export type SemiFinishedShortageField = "productCode" | "productName" | "customer" | "partCode";

export interface SemiFinishedShortageQuery {
  field: SemiFinishedShortageField;
  keyword?: string;
  exact: boolean;
  page: number;
  pageSize: number;
}

export interface SemiFinishedShortageRow {
  customer: string;
  productCode: string;
  productName: string;
  partCode: string;
  assemblyName: string;
  unit: string;
  requiredQuantity: number;
  inventoryQuantity: number;
  shortageQuantity: number;
}

export interface SemiFinishedShortageResult {
  items: SemiFinishedShortageRow[];
  total: number;
  page: number;
  pageSize: number;
}

const base = "/semi-finished-shortage-analysis";

export const semiFinishedShortageAnalysisApi = {
  list: (params: SemiFinishedShortageQuery) =>
    api.get<SemiFinishedShortageResult>(base, { params }).then(response => response.data),
  export: (params: SemiFinishedShortageQuery) =>
    api.get<Blob>(`${base}/export`, { params, responseType: "blob" }).then(response => response.data),
};
```

- [ ] **Step 4: Implement query, quantity, and download helpers**

Create `web/src/utils/semiFinishedShortageAnalysis.ts`:

```ts
import type {
  SemiFinishedShortageField,
  SemiFinishedShortageQuery,
} from "../api/semiFinishedShortageAnalysis";

export const DEFAULT_SHORTAGE_QUERY: SemiFinishedShortageQuery = {
  field: "productCode",
  keyword: undefined,
  exact: false,
  page: 1,
  pageSize: 50,
};

export function normalizeShortageQuery(input: Partial<SemiFinishedShortageQuery>): SemiFinishedShortageQuery {
  const allowed: SemiFinishedShortageField[] = ["productCode", "productName", "customer", "partCode"];
  return {
    field: allowed.includes(input.field as SemiFinishedShortageField)
      ? input.field as SemiFinishedShortageField
      : "productCode",
    keyword: input.keyword?.trim() || undefined,
    exact: input.exact === true,
    page: Math.max(1, Math.trunc(input.page ?? 1)),
    pageSize: Math.min(200, Math.max(1, Math.trunc(input.pageSize ?? 50))),
  };
}

export function formatShortageQuantity(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value ?? 0);
}

export function downloadShortageExport(blob: Blob): void {
  if (blob.size === 0) throw new Error("导出文件为空");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "半成品欠料分析表.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: Run API/helper tests**

Run:

```powershell
npm --prefix web test -- semiFinishedShortageAnalysisApi.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the frontend data layer**

```powershell
git add web/src/api/semiFinishedShortageAnalysis.ts web/src/utils/semiFinishedShortageAnalysis.ts web/src/__tests__/semiFinishedShortageAnalysisApi.test.ts
git commit -m "feat: add semi-finished shortage web API"
```

---

### Task 4: Unified report page, route, and menu

**Files:**
- Create: `web/src/pages/semi/SemiFinishedShortageAnalysisPage.tsx`
- Create: `web/src/__tests__/semiFinishedShortageAnalysisPage.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/nav/menuTree.tsx`

**Interfaces:**
- Consumes: Task 3 API/helpers, `usePerms()`, `can(...)`, `printTable(...)`, React Router `useNavigate()`.
- Produces: the `/semi-finished-shortage-analysis` page and the real “半成品欠料分析表” menu entry.

- [ ] **Step 1: Write the failing page/source tests**

Create `semiFinishedShortageAnalysisPage.test.tsx`. Mock `semiFinishedShortageAnalysisApi`, `PermissionContext`, `react-router-dom`, `printTable`, Ant Design controls, and icons using the compact component-capture pattern already used by `semiFinishedLabelOrderPage.test.ts`. The tests must assert these concrete behaviors:

```ts
describe("SemiFinishedShortageAnalysisPage", () => {
  it("registers the real route and menu under semi-finished warehouse", () => {
    expect(appSource).toContain('path="semi-finished-shortage-analysis"');
    expect(appSource).toContain("<SemiFinishedShortageAnalysisPage />");
    expect(menuSource).toContain(
      'M("半成品欠料分析表", "/semi-finished-shortage-analysis", "半成品欠料分析表")',
    );
  });

  it("loads the default contains query and renders all nine columns", async () => {
    pageMock.list.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 50 });
    await mountPage();
    expect(pageMock.list).toHaveBeenCalledWith({
      field: "productCode", keyword: undefined, exact: false, page: 1, pageSize: 50,
    });
    expect(pageMock.table.columns?.map(column => column.title)).toEqual([
      "客户", "产品货号", "产品名称", "配件编号", "产品装配名称", "单位",
      "需求数量", "库存数量", "欠料数量",
    ]);
  });

  it("sends exact true for 精确查询 and resets to page one", async () => {
    await mountPage();
    pageMock.selects[0].onChange?.("partCode");
    pageMock.search.onChange?.({ target: { value: " SFS-A1 " } });
    pageMock.button("精确查询").onClick?.();
    await settle();
    expect(pageMock.list).toHaveBeenLastCalledWith({
      field: "partCode", keyword: "SFS-A1", exact: true, page: 1, pageSize: 50,
    });
  });

  it("uses server pagination and keeps the active filter", async () => {
    await mountPage();
    pageMock.table.pagination?.onChange?.(2, 50);
    await settle();
    expect(pageMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 50 }));
  });

  it("gates export and print with 打印 permission", async () => {
    pageMock.perms = { 半成品欠料分析表: { 打开: true, 打印: false } };
    await mountPage();
    expect(pageMock.button("导出EXCEL").disabled).toBe(true);
    expect(pageMock.button("打印").disabled).toBe(true);
  });

  it("exports through the backend and prints the visible report", async () => {
    pageMock.export.mockResolvedValue(new Blob(["csv"]));
    await mountPage();
    pageMock.button("导出EXCEL").onClick?.();
    pageMock.button("打印").onClick?.();
    await settle();
    expect(pageMock.export).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    expect(pageMock.download).toHaveBeenCalled();
    expect(pageMock.print).toHaveBeenCalledWith("半成品欠料分析表", expect.any(Array), expect.any(Array));
  });

  it("closes through router navigation and shows access denied without 打开", async () => {
    await mountPage();
    pageMock.button("关闭").onClick?.();
    expect(pageMock.navigate).toHaveBeenCalledWith(-1);

    pageMock.perms = { 半成品欠料分析表: { 打开: false } };
    await remountPage();
    expect(container.textContent).toContain("无权访问该页面");
  });
});
```

Define `row` with every Task 3 field, including `requiredQuantity: 15`, `inventoryQuantity: 6`, `shortageQuantity: 9`. The mock table must expose `columns`, `dataSource`, and `pagination`; the mock controls must expose their latest props so each assertion drives the actual page handlers.

- [ ] **Step 2: Run the page test and verify the page/route are missing**

Run:

```powershell
npm --prefix web test -- semiFinishedShortageAnalysisPage.test.tsx
```

Expected: FAIL because the page module, route, and real menu entry do not exist.

- [ ] **Step 3: Implement the unified report page**

Create `SemiFinishedShortageAnalysisPage.tsx` with this component structure and exact behavior:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, Select, Space, Table, Tag, message } from "antd";
import { CloseOutlined, ExportOutlined, PrinterOutlined, SearchOutlined, TableOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router-dom";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import {
  semiFinishedShortageAnalysisApi,
  type SemiFinishedShortageField,
  type SemiFinishedShortageQuery,
  type SemiFinishedShortageRow,
} from "../../api/semiFinishedShortageAnalysis";
import {
  DEFAULT_SHORTAGE_QUERY,
  downloadShortageExport,
  formatShortageQuantity,
  normalizeShortageQuery,
} from "../../utils/semiFinishedShortageAnalysis";
import { printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "半成品欠料分析表";
const fieldOptions = [
  { value: "productCode", label: "产品货号" },
  { value: "productName", label: "产品名称" },
  { value: "customer", label: "客户" },
  { value: "partCode", label: "配件编号" },
] satisfies { value: SemiFinishedShortageField; label: string }[];

export default function SemiFinishedShortageAnalysisPage() {
  const permissions = usePerms();
  const navigate = useNavigate();
  const canOpen = can(permissions, MENU, "打开");
  const canPrint = can(permissions, MENU, "打印");
  const [query, setQuery] = useState<SemiFinishedShortageQuery>(DEFAULT_SHORTAGE_QUERY);
  const [rows, setRows] = useState<SemiFinishedShortageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  const load = useCallback(async (next: SemiFinishedShortageQuery) => {
    if (!canOpen) return;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const normalized = normalizeShortageQuery(next);
      const result = await semiFinishedShortageAnalysisApi.list(normalized);
      if (version !== requestVersion.current) return;
      setRows(result.items);
      setTotal(result.total);
    } catch {
      if (version === requestVersion.current) message.error("加载半成品欠料分析表失败");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [canOpen]);

  useEffect(() => {
    if (canOpen) void load(DEFAULT_SHORTAGE_QUERY);
    return () => { requestVersion.current += 1; };
  }, [canOpen, load]);

  const runQuery = (exact: boolean) => {
    const next = normalizeShortageQuery({ ...query, exact, page: 1 });
    setQuery(next);
    void load(next);
  };

  const columns = useMemo<ColumnsType<SemiFinishedShortageRow>>(() => [
    { title: "客户", dataIndex: "customer", width: 140 },
    { title: "产品货号", dataIndex: "productCode", width: 150 },
    { title: "产品名称", dataIndex: "productName", width: 180 },
    { title: "配件编号", dataIndex: "partCode", width: 140 },
    { title: "产品装配名称", dataIndex: "assemblyName", width: 200 },
    { title: "单位", dataIndex: "unit", width: 90 },
    { title: "需求数量", dataIndex: "requiredQuantity", width: 120, align: "right", render: formatShortageQuantity },
    { title: "库存数量", dataIndex: "inventoryQuantity", width: 120, align: "right", render: formatShortageQuantity },
    {
      title: "欠料数量", dataIndex: "shortageQuantity", width: 120, align: "right",
      render: (value: number) => <Tag color="error">{formatShortageQuantity(value)}</Tag>,
    },
  ], []);

  const exportColumns = useMemo<ExportCol[]>(() => [
    { title: "客户", key: "customer" }, { title: "产品货号", key: "productCode" },
    { title: "产品名称", key: "productName" }, { title: "配件编号", key: "partCode" },
    { title: "产品装配名称", key: "assemblyName" }, { title: "单位", key: "unit" },
    { title: "需求数量", key: "requiredQuantity", fmt: value => formatShortageQuantity(Number(value ?? 0)) },
    { title: "库存数量", key: "inventoryQuantity", fmt: value => formatShortageQuantity(Number(value ?? 0)) },
    { title: "欠料数量", key: "shortageQuantity", fmt: value => formatShortageQuantity(Number(value ?? 0)) },
  ], []);

  if (!canOpen) return <Card variant="borderless"><div style={{ padding: 24, color: "#8c8c8c" }}>无权访问该页面</div></Card>;

  return (
    <Card
      title="半成品欠料分析表"
      variant="borderless"
      extra={<Space wrap>
        <Tag color="blue">记录 {total}</Tag>
        <Button icon={<TableOutlined />} disabled>表格设置</Button>
        <Button icon={<ExportOutlined />} disabled={!canPrint || loading || total === 0} onClick={async () => {
          try { downloadShortageExport(await semiFinishedShortageAnalysisApi.export(query)); }
          catch { message.error("导出半成品欠料分析表失败"); }
        }}>导出EXCEL</Button>
        <Button icon={<PrinterOutlined />} disabled={!canPrint || loading || rows.length === 0}
          onClick={() => printTable("半成品欠料分析表", exportColumns, rows as unknown as Record<string, unknown>[])}>打印</Button>
        <Button danger icon={<CloseOutlined />} onClick={() => navigate(-1)}>关闭</Button>
      </Space>}
    >
      <Space wrap style={{ width: "100%", marginBottom: 16 }}>
        <span>请选择条件:</span>
        <Select value={query.field} options={fieldOptions} style={{ width: 150 }}
          onChange={field => setQuery(current => ({ ...current, field }))} />
        <Input.Search allowClear value={query.keyword ?? ""} placeholder="请输入关键字" style={{ width: 260 }}
          loading={loading} onChange={event => setQuery(current => ({ ...current, keyword: event.target.value }))}
          onSearch={() => runQuery(false)} />
        <Button type="primary" icon={<SearchOutlined />} disabled={loading} onClick={() => runQuery(false)}>查询</Button>
        <Button icon={<SearchOutlined />} disabled={loading} onClick={() => runQuery(true)}>精确查询</Button>
      </Space>
      <Table<SemiFinishedShortageRow>
        rowKey={row => `${row.customer}-${row.productCode}-${row.partCode}`}
        size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} locale={{ emptyText: "暂无欠料数据" }}
        pagination={{
          current: query.page, pageSize: query.pageSize, total,
          showTotal: value => `共 ${value} 条`, showSizeChanger: false,
          onChange: (page, pageSize) => {
            const next = normalizeShortageQuery({ ...query, page, pageSize });
            setQuery(next); void load(next);
          },
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Register route and menu**

Add the import and route in `web/src/App.tsx` beside the other semi-finished pages:

```tsx
import SemiFinishedShortageAnalysisPage from "./pages/semi/SemiFinishedShortageAnalysisPage";
```

```tsx
<Route path="semi-finished-shortage-analysis" element={<SemiFinishedShortageAnalysisPage />} />
```

Replace the placeholder in `web/src/nav/menuTree.tsx` with:

```tsx
M("半成品欠料分析表", "/semi-finished-shortage-analysis", "半成品欠料分析表"),
```

- [ ] **Step 5: Run focused frontend tests and build**

Run:

```powershell
npm --prefix web test -- semiFinishedShortageAnalysisPage.test.tsx semiFinishedShortageAnalysisApi.test.ts
npm --prefix web run build
```

Expected: focused tests PASS and Vite production build completes without TypeScript errors.

- [ ] **Step 6: Commit the user-facing page**

```powershell
git add web/src/pages/semi/SemiFinishedShortageAnalysisPage.tsx web/src/__tests__/semiFinishedShortageAnalysisPage.test.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat: add semi-finished shortage report page"
```

---

### Task 5: Full verification and local runtime refresh

**Files:**
- Verify only; fix failures only in files listed in the File Map.

**Interfaces:**
- Consumes: all Tasks 1-4.
- Produces: tested backend, tested frontend, working hidden local services, and browser-verified page.

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --no-restore
npm --prefix web test
npm --prefix web run build
git diff --check
```

Expected: backend tests PASS or database-only tests SKIP for missing `ERP_TEST_DB`; all Vitest tests PASS; frontend build succeeds; `git diff --check` prints no errors.

- [ ] **Step 2: Verify the registered contracts in source**

Run:

```powershell
rg -n '半成品欠料分析表|semi-finished-shortage-analysis' src/ErpApi web/src tests/ErpApi.Tests
```

Expected: matches exist in MenuCatalog, controller, route, menu, API, page, and tests; no match points to `_todo` for this menu.

- [ ] **Step 3: Refresh frontend and backend as hidden processes**

Use the repository's existing hidden service launcher or the current approved Windows hidden-process pattern. Confirm backend port `5000` and frontend port `5173` are listening after refresh:

```powershell
Get-NetTCPConnection -LocalPort 5000,5173 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
```

Expected: one listener on each port; closing a terminal window does not stop either listener.

- [ ] **Step 4: Browser-verify the modern page**

Open `http://localhost:5173/semi-finished-shortage-analysis` in the in-app browser and verify at desktop width:

- The selected navigation item is under “半成品仓库”.
- The page uses the same modern Card/toolbar/table styling as existing ERP pages.
- The title, record count, field selector, keyword input, query, exact query, table settings, export, print, and close controls are visible without overlap.
- The table contains the nine required columns in the specified order and supports horizontal scrolling.
- Empty data retains the header and shows “暂无欠料数据”.
- With suitable test data, every row satisfies `欠料数量 = 需求数量 - 库存数量` and `欠料数量 > 0`.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required corrections in this feature's files, stage only those corrected files and commit:

```powershell
git add src/ErpApi/Features/Warehouse/Semi/ShortageAnalysis tests/ErpApi.Tests/SemiFinishedShortageServiceDbTests.cs tests/ErpApi.Tests/SemiFinishedShortageControllerTests.cs web/src/api/semiFinishedShortageAnalysis.ts web/src/utils/semiFinishedShortageAnalysis.ts web/src/pages/semi/SemiFinishedShortageAnalysisPage.tsx web/src/__tests__/semiFinishedShortageAnalysisApi.test.ts web/src/__tests__/semiFinishedShortageAnalysisPage.test.tsx web/src/App.tsx web/src/nav/menuTree.tsx src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs
git commit -m "fix: verify semi-finished shortage analysis"
```

If no correction was needed, do not create an empty commit.
