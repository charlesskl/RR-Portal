# 物料盘点单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照「半成品盘点」(SemiStocktake) 镜像出物料盘点单——选仓库带出物料账面库存做底稿，录实盘数，审核后「盈亏数量」调整物料库存（盘盈+/盘亏−）。

**Architecture:** 后端新增 `Features/Materials/MaterialStocktake/` 三件套，镜像 `Features/Warehouse/Semi/SemiStocktake*`，把库存源 `IInventorySummaryService.SemiFinishedAsync` 换成 `IMaterialInventoryService.ListAsync`、字段 `颜色`→`单位`。库存引擎 `MaterialInventoryService.LedgerUnion` 追加一支 `盘点明细单 的 盈亏数量`(CAST decimal，审核='1')。表已存在零迁移。前端独立盘点页镜像 `SemiStocktakePage`，专用路由 `/materials/material-stocktake`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test), xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，分支 `feat-material-stocktake`（建特性分支→合并 master）。
- `dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试需环境变量（PowerShell）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`、`$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 后端单类测试：`dotnet test --filter "FullyQualifiedName~MaterialStocktakeServiceDbTests"`；全量 `dotnet test`。前端：`npm --prefix web run test -- --run`、`npm --prefix web run build`。
- **跑后端测试/建库前停掉运行中的 ErpApi**（占 `bin/Debug/ErpApi.exe` 锁）。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- **范本（照抄其模式）**：`src/ErpApi/Features/Warehouse/Semi/SemiStocktakeService.cs`、`SemiStocktakeController.cs`、`SemiDtos.cs`(盘点段)、前端 `web/src/pages/warehouse/SemiStocktakePage.tsx`、`web/src/api/semi.ts`(semiStocktakeApi)、测试 `tests/ErpApi.Tests/SemiStocktakeServiceDbTests.cs`。
- **已有件**：`IMaterialInventoryService`（`ListAsync(string? 仓库, string? keyword)`→`IReadOnlyList<MaterialStockRow>`，行字段 物料编号/物料名称/规格/单位/仓库/库存数量；`StockOfAsync(物料编号, scope)`→decimal）；`IDocumentNumberGenerator`/`IPostingEngine`/`IPermissionService`/`IAuditLogger`/`PeriodLockService`；`PagedResult<T>`(ns `ErpApi.Features.MasterData`)；测试 `DbFixture`、`P3TestData`(`P3TestData.仓库="物料仓"`、`Seed`/`Cleanup`)。
- **表已存在**：`[盘点单]`/`[盘点明细单]`（`db/01_rebuild_schema.sql:2157`，数量列 `系统数量/盘点数量/盈亏数量` 为 `real`，审核留痕列已由 03 补）；过账白名单已含 `["盘点单"]="单号"`。

---

## Task 1: 后端 DTOs

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeDtos.cs`

镜像 `SemiDtos.cs` 盘点段，字段 `颜色`→`单位`。

- [ ] **Step 1: 写 DTOs**

```csharp
namespace ErpApi.Features.Materials.MaterialStocktake;

public sealed class MaterialStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
}

public sealed class MaterialStocktakeLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}

public sealed class MaterialStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<MaterialStocktakeLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class MaterialStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}

public sealed class MaterialStocktakeDetailDto
{
    public MaterialStocktakeHeaderDto? 单头 { get; set; }
    public List<MaterialStocktakeLineRowDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeDtos.cs
git commit -m "feat(盘点单): 后端 DTOs(Basis/Line/Create/Header/Detail)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 后端 Service（TDD）

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeService.cs`
- Test: `tests/ErpApi.Tests/MaterialStocktakeServiceDbTests.cs`

镜像 `SemiStocktakeService`：库存源换 `IMaterialInventoryService`，`DocType="盘点单"`、`Prefix="PD"`，表 盘点单/盘点明细单，字段 颜色→单位。

- [ ] **Step 1: 写失败测试**

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.MaterialStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private MaterialStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    private static void SeedStock(Microsoft.Data.SqlClient.SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'PDM01',N'盘点料',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PDRK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PDRK01',N'物料仓',N'PDM01',N'盘点料',N'规格A',N'米',100)");
    }
    private static void Cleanup(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'PDM01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] LIKE N'PD%' AND [仓库]=N'物料仓' AND [单号] NOT LIKE N'PDRK%'");
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'PDM01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PDRK01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDM01'");
    }

    [SkippableFact]
    public async Task Basis_returns_system_qty()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        try
        {
            var basis = await Svc().BasisAsync("物料仓");
            var row = Assert.Single(basis, b => b.物料编号 == "PDM01");
            Assert.Equal(100m, row.系统数量);
            Assert.Equal("米", row.单位);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_computes_盈亏_and_GetReadsBack()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");
            Assert.StartsWith("PD", pd);
            Assert.Equal(-20m, c.ExecuteScalar<decimal>(
                "SELECT CAST([盈亏数量] AS decimal(18,4)) FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }));
            var detail = await Svc().GetAsync(pd);
            var line = Assert.Single(detail!.明细);
            Assert.Equal(100m, line.系统数量);
            Assert.Equal(80m, line.盘点数量);
            Assert.Equal(-20m, line.盈亏数量);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new MaterialStocktakeCreateDto { 仓库 = "物料仓", 明细 = [] }, "tester"));
    }

    [SkippableFact]
    public async Task Create_rejects_blank_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new MaterialStocktakeCreateDto { 仓库 = "", 明细 = [ new MaterialStocktakeLineDto { 物料编号 = "PDM01", 系统数量 = 1, 盘点数量 = 1 } ] }, "tester"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialStocktakeServiceDbTests"`
Expected: 编译失败（`MaterialStocktakeService` 不存在）。

- [ ] **Step 3: 写 Service**

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.MaterialStocktake;

// 物料盘点（盈亏）。两层：盘点单 + 盘点明细单(单号串联)。审核位仅在单头。
// BasisAsync 从 MaterialInventoryService.ListAsync 取系统数量；盈亏=盘点−系统；审核后盈亏入库存(库存引擎)。
// 数量列为 real，服务端传 decimal(SQL 隐式转)；读回 CAST decimal。
public sealed class MaterialStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IMaterialInventoryService inventory)
{
    public const string DocType = "盘点单";
    public const string Prefix = "PD";

    public async Task<IReadOnlyList<MaterialStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.ListAsync(仓库, null);
        return inv.Select(r => new MaterialStocktakeBasisRow
        {
            物料编号 = r.物料编号, 物料名称 = r.物料名称, 规格 = r.规格, 单位 = r.单位, 系统数量 = r.库存数量
        }).ToList();
    }

    public async Task<string> CreateAsync(MaterialStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("盘点单至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[系统数量],[盘点数量],[盈亏数量])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@单位,@系统数量,@盘点数量,@盈亏数量)",
                new
                {
                    单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.单位,
                    l.系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - l.系统数量
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<MaterialStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialStocktakeHeaderDto>()).AsList();
        return new PagedResult<MaterialStocktakeHeaderDto>(items, total);
    }

    public async Task<MaterialStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[单位],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量
FROM [盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialStocktakeLineRowDto>()).AsList();
        return new MaterialStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialStocktakeServiceDbTests"`
Expected: 4 passed（设了 ERP_TEST_DB）。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeService.cs tests/ErpApi.Tests/MaterialStocktakeServiceDbTests.cs
git commit -m "feat(盘点单): 后端 Service(底稿/建单盈亏/列表/详情/删除)+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 库存引擎追加盘点分支（TDD）

**Files:**
- Modify: `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs:6,25`
- Test: `tests/ErpApi.Tests/MaterialInventoryDbTests.cs`（新增方法）

盘点明细单的 `盈亏数量`(CAST decimal) 计入（审核='1'）。

- [ ] **Step 1: 在库存测试里加失败测试**

在 `tests/ErpApi.Tests/MaterialInventoryDbTests.cs` 类最后一个 `}` 之前追加：

```csharp
    [SkippableFact]
    public async Task StockOf_applies_approved_盘点盈亏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'P3PD01')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'P3M01',N'P3面料',N'米')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'米',100)");
        // 盘点：系统100 盘成80 → 盈亏 -20，审核后库存 = 80
        c.Execute("INSERT INTO [盘点单]([单号],[仓库],[审核]) VALUES(N'P3PD01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [盘点明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[系统数量],[盘点数量],[盈亏数量])
                    VALUES(N'P3PD01',N'物料仓',N'P3M01',N'P3面料',N'米',100,80,-20)");
        var stock = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(80m, stock);   // 入100 + 盘亏(-20) = 80
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] IN (N'P3PD01')");
        Cleanup(c);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests.StockOf_applies_approved_盘点盈亏"`
Expected: FAIL（断言 80 ≠ 100，引擎还没算盘点）。

- [ ] **Step 3: 给 LedgerUnion 追加盘点分支**

`MaterialInventoryService.cs` 的 `LedgerUnion` 字符串当前末段是报废分支：
```csharp
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [报废明细单] d JOIN [报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";
```
把它结尾 `'1'";` 改成 `'1'` 续接盘点分支并以 `";` 收尾，即变为：
```csharp
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [报废明细单] d JOIN [报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], CAST(d.[盈亏数量] AS decimal(18,4))
    FROM [盘点明细单] d JOIN [盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";
```
同时把第6行注释改为：
```csharp
// 算法1（物料口径）：物料库存 = 采购入仓(+) + 退料(+) − 领料(−) − 采购退仓(−) − 报废(−) ± 盘点盈亏(±)，仅审核='1'，按 物料编号×仓库 汇总。
```

- [ ] **Step 4: 跑全部库存测试确认通过、不回归**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`
Expected: 全绿（新盘点断言 80；原有 75/报废 80 等断言不受影响，其种子不含盘点单）。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Engines/Inventory/MaterialInventoryService.cs tests/ErpApi.Tests/MaterialInventoryDbTests.cs
git commit -m "feat(盘点单): 库存引擎加盘点盈亏分支(CAST盈亏数量,只认已审核)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 后端 Controller + DI

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeController.cs`
- Modify: `src/ErpApi/Program.cs`（报废注册行后追加盘点）

镜像 `SemiStocktakeController`：路由 `api/material-stocktakes`，`Menu=Table="盘点单"`、`口径="物料"`。

- [ ] **Step 1: 写 Controller**

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.MaterialStocktake;

// 物料盘点 REST。审核/反审核仅翻单头审核位——盘点明细单无审核列，库存引擎按单头JOIN过滤审核。盘点无单价保密。
[ApiController]
[Authorize]
[Route("api/material-stocktakes")]
public sealed class MaterialStocktakeController(
    MaterialStocktakeService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "盘点单";
    private const string Table = "盘点单";
    private const string 口径 = "物料";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "仓库")] string 仓库)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.BasisAsync(仓库));
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MaterialStocktakeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 2: DI 注册**

`src/ErpApi/Program.cs` 找到报废注册行 `builder.Services.AddScoped<ErpApi.Features.Materials.MaterialScrap.MaterialScrapService>();`，在其**下面**加：
```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialStocktake.MaterialStocktakeService>();
```

- [ ] **Step 3: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeController.cs src/ErpApi/Program.cs
git commit -m "feat(盘点单): 后端 Controller(底稿/REST/审核)+DI注册

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 权限目录 + 种子

**Files:**
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs:15`
- Create: `db/seed_stocktake_perms.sql`

- [ ] **Step 1: MenuCatalog 加盘点单**

`MenuCatalog.cs:15` 物料管理组里，把 `new("物料管理","报废单"),` 后插入 `new("物料管理","盘点单"),`，即该行含：
```csharp
..., new("物料管理","退料单"), new("物料管理","报废单"), new("物料管理","盘点单"), new("物料管理","物料库存"),
```

- [ ] **Step 2: 写权限种子 `db/seed_stocktake_perms.sql`**

```sql
-- 开发用：给某用户授予 盘点单 菜单的 9 位权限。
-- 用法：把 @用户 改成你的登录名，在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'盘点单');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'盘点单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 给 admin 授权（开发库 + 测试库）**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
dotnet run --project tools/DbDeploy -- ([Environment]::GetEnvironmentVariable("ERP_DB","User")) db/seed_stocktake_perms.sql
dotnet run --project tools/DbDeploy -- ([Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")) db/seed_stocktake_perms.sql
```
Expected: 各影响 1 行。

- [ ] **Step 4: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj`
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_stocktake_perms.sql
git commit -m "feat(盘点单): 权限目录(物料管理/盘点单)+权限种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 前端 — api + 盘点页 + 路由 + 菜单

**Files:**
- Create: `web/src/api/materialStocktake.ts`
- Create: `web/src/pages/materials/MaterialStocktakePage.tsx`
- Modify: `web/src/App.tsx`（import + route）
- Modify: `web/src/nav/menuTree.tsx:77`（库存盘点单补路径）

镜像 `web/src/api/semi.ts`(semiStocktakeApi) 与 `web/src/pages/warehouse/SemiStocktakePage.tsx`，字段 颜色→单位，菜单名 盘点单。

- [ ] **Step 1: 写 api**

```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface MSBasisRow { 物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string; 系统数量: number }
export interface MSLine { 物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string; 系统数量: number; 盘点数量: number }
export interface MSCreate { 仓库: string; 备注?: string; 明细: MSLine[] }
export interface MSHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 审核?: string; 备注?: string }

const enc = encodeURIComponent;
export const materialStocktakeApi = {
  basis: (仓库: string) => api.get<MSBasisRow[]>("/material-stocktakes/basis", { params: { 仓库 } }).then(r => r.data),
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<MSHeader>>("/material-stocktakes", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: MSCreate) => api.post<{ 单号: string }>("/material-stocktakes", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/material-stocktakes/${enc(单号)}`),
  approve: (单号: string) => api.post(`/material-stocktakes/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/material-stocktakes/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: 写盘点页**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, message } from "antd";
import { materialStocktakeApi, type MSBasisRow, type MSHeader, type MSLine } from "../../api/materialStocktake";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "盘点单";
interface BasisRow extends MSBasisRow { 盘点数量?: number }

export default function MaterialStocktakePage() {
  const perms = usePerms();
  const [仓库, set仓库] = useState("");
  const [basis, setBasis] = useState<BasisRow[]>([]);
  const [rows, setRows] = useState<MSHeader[]>([]);
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    try { setRows((await materialStocktakeApi.list(1, 50, 仓库)).items); }
    catch { message.error("加载盘点单失败"); }
  }, [仓库]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const loadBasis = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    try { const b = await materialStocktakeApi.basis(仓库); setBasis(b.map(x => ({ ...x, 盘点数量: x.系统数量 }))); }
    catch { message.error("加载库存基准失败"); }
  };
  const setQty = (i: number, val: number) =>
    setBasis(prev => prev.map((b, j) => (j === i ? { ...b, 盘点数量: val } : b)));

  const submit = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    const 明细: MSLine[] = basis.map(b => ({
      物料编号: b.物料编号, 物料名称: b.物料名称, 规格: b.规格, 单位: b.单位,
      系统数量: b.系统数量, 盘点数量: Number(b.盘点数量 ?? b.系统数量),
    }));
    if (明细.length === 0) { message.error("无库存可盘点"); return; }
    setSaving(true);
    try {
      await materialStocktakeApi.create({ 仓库, 明细 });
      message.success("盘点单已创建"); setBasis([]); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建盘点单失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const basisColumns = [
    { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" }, { title: "单位", dataIndex: "单位" },
    { title: "系统数量", dataIndex: "系统数量" },
    { title: "盘点数量", key: "盘点数量", render: (_: unknown, r: BasisRow, i: number) =>
      <InputNumber min={0} precision={2} value={r.盘点数量 ?? 0} onChange={n => setQty(i, Number(n ?? 0))} /> },
    { title: "盈亏", key: "盈亏", render: (_: unknown, r: BasisRow) => Number(r.盘点数量 ?? r.系统数量) - r.系统数量 },
  ];
  const listColumns = [
    { title: "盘点单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: MSHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => materialStocktakeApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => materialStocktakeApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该盘点单?" onConfirm={() => act(() => materialStocktakeApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="物料盘点" variant="borderless"
      extra={
        <Space>
          <Input placeholder="仓库" value={仓库} onChange={e => set仓库(e.target.value)} style={{ width: 140 }} />
          <Button onClick={loadBasis}>带出库存</Button>
        </Space>
      }>
      {can(perms, MENU, "保存") && basis.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={basis} columns={basisColumns} />
          <Space style={{ marginTop: 12 }}>
            <Button type="primary" loading={saving} onClick={submit}>提交盘点</Button>
          </Space>
        </div>
      )}
      <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
    </Card>
  );
}
```

- [ ] **Step 3: 注册路由 `web/src/App.tsx`**

在 import 区（与其它页 import 一起）加：
```tsx
import MaterialStocktakePage from "./pages/materials/MaterialStocktakePage";
```
在 `<Route path="semi-stocktakes" element={<SemiStocktakePage />} />` 同级路由组里加一行：
```tsx
          <Route path="materials/material-stocktake" element={<MaterialStocktakePage />} />
```

- [ ] **Step 4: 菜单补路径 `web/src/nav/menuTree.tsx:77`**

把 `M("库存盘点单"),` 改为：
```tsx
    M("库存盘点单", "/materials/material-stocktake", "盘点单"),
```

- [ ] **Step 5: 前端测试 + 构建**

Run: `npm --prefix web run test -- --run`
Expected: 现有 42 测试不回归。
Run: `npm --prefix web run build`
Expected: tsc 无错，构建成功。

- [ ] **Step 6: Commit**

```bash
git add web/src/api/materialStocktake.ts web/src/pages/materials/MaterialStocktakePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(盘点单): 前端 api+物料盘点页(镜像半成品盘点)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 端到端验证 + 合并

**Files:** 无（验证 + 收尾）

- [ ] **Step 1: 后端全量测试**

先停 ErpApi。Run: `dotnet test`
Expected: 全绿（含新增 MaterialStocktake 4 测 + 库存盘点 1 测；约 302 通过）。

- [ ] **Step 2: 起后端 + 前端，puppeteer 冒烟**

起后端 5000（Release，env：ERP_DB/ERP_JWT_KEY/ASPNETCORE_URLS）、前端 5173。写 `tmp/shot/stocktake-e2e.cjs`（参照 `tmp/shot/return-form.cjs`）：登录 admin/admin123 → 开 `/materials/material-stocktake` → 在「仓库」输入框填 `物料仓` → 点「带出库存」→ 截图 + 抓底稿表头文字。
Expected：页面可见「物料盘点」标题、底稿列含 `系统数量/盘点数量/盈亏`；列表区可见盘点单列。

- [ ] **Step 3: 库存方向核对（脚本或浏览器）**

选一个 `物料仓` 有库存的物料，带出底稿（系统数量=N）→ 把盘点数量改成 N−5 → 提交 → 审核 → 打开「物料库存」查该物料，确认库存=N−5（盘亏 −5 生效）；反审核后恢复 N。

- [ ] **Step 4: 合并 master**

```bash
git checkout master
git merge --no-ff feat-material-stocktake -m "Merge branch 'feat-material-stocktake' into master"
git branch -d feat-material-stocktake
```

- [ ] **Step 5: 收尾**

更新记忆（物料盘点已建，盈亏入库存，镜像半成品盘点）；重启 5000/5173（见 [[restart-servers-after-plan]]）。

---

## 自查（写完计划回看 spec）

- **Spec 覆盖**：库存盈亏机制(T3)✓、底稿带出(T2 BasisAsync)✓、后端三件套(T1/T2/T4)✓、权限目录+种子(T5)✓、前端独立盘点页+专用路由(T6)✓、无价格列(DTO/页均无单价金额)✓、颜色/货号留空(DTO 用 单位 不含 颜色/物料类别)✓、测试(T2/T3/T7)✓、零 DB 迁移(无建表任务)✓。无遗漏。
- **占位符扫描**：无 TBD/TODO；每步含完整代码/命令/期望输出。
- **类型一致**：后端 `MaterialStocktakeBasisRow/LineDto/CreateDto/HeaderDto/LineRowDto/DetailDto`、`MaterialStocktakeService`(DocType=盘点单,Prefix=PD,注入 IMaterialInventoryService)、`MaterialStocktakeController`(Menu=Table=盘点单,口径=物料,路由 material-stocktakes) 跨任务一致；BasisAsync 用 `r.库存数量`/`r.单位`（MaterialStockRow 字段）；前端 `MSBasisRow/MSLine/MSCreate/MSHeader`、`materialStocktakeApi`、路由 `/materials/material-stocktake`、菜单 perm `盘点单` 与后端 Menu 一致。
```
