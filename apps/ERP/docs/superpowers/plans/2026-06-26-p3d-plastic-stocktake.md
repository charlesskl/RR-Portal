# 塑胶盘点(盈亏±)(塑胶模块 P3d)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 镜像物料 `MaterialStocktake` 实现塑胶盘点录入单(选仓→带出账面→录实盘→盈亏=盘点−系统→审核后有符号盈亏入塑胶库存 UNION 第 6 支),前端用专用页(非通用单据组件)。

**Architecture:** 两层单据(塑胶盘点单+塑胶盘点明细单·SPD单号),审核位仅在单头。Service 注入 `PlasticInventoryService` 取账面系统数量;盈亏=盘点−系统存明细;审核后由库存引擎按单头 JOIN 实时聚合。Controller 精简塑胶风格(无月结锁/审计)。盘点无单价保密。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,新建特性分支 `feat-plastic-stocktake`,完成后 `--no-ff` 合并 master 并删分支。Windows PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量(shell 为空时):`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`、`$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 后端测试:`dotnet test`;单类 `dotnet test --filter "FullyQualifiedName~PlasticStocktakeServiceDbTests"`。若后端 `dotnet run`/ErpApi.exe 在跑锁住 DLL,用 `-c Release`。前端:`npm --prefix web run test`、`npm --prefix web run build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。
- 镜像源:`src/ErpApi/Features/Materials/MaterialStocktake/`(Service/Dtos/Controller 的**录入部分**,不含 StocktakeQuery 报表方法)、`web/src/pages/materials/MaterialStocktakePage.tsx` + `web/src/api/materialStocktake.ts`。库存引擎 6 支参考 `MaterialInventoryService.cs` 的盘点支。塑胶 controller 精简风格参考 `PlasticReturnController.cs`。
- **塑胶库存 ListAsync 不返回颜色**,故 basis/明细不带颜色(明细表 DDL 保留可空颜色列对齐 schema)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/21_plastic_stocktake.sql` | 塑胶盘点单 + 塑胶盘点明细单(幂等·含审核日期) | 新建 |
| `db/seed_plastic_stocktake_perms.sql` | admin 授权 塑胶盘点单 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeDtos.cs` | basis/line/create/header/detail DTO | 新建 |
| `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeService.cs` | basis/create(盈亏)/list/get/delete | 新建 |
| `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeController.cs` | basis+CRUD+审核(精简) | 新建 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | LedgerUnion 加盘点支(第6支) | 改 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 白名单加 塑胶盘点单 | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单加 塑胶盘点单 | 改 |
| `src/ErpApi/Program.cs` | 注册 PlasticStocktakeService | 改 |
| `tests/ErpApi.Tests/PlasticStocktakeServiceDbTests.cs` | basis/盈亏/delete 测试 | 新建 |
| `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` | 加盘点联动测试 | 改 |
| `web/src/api/plasticStocktake.ts` | 盘点 API + 类型 | 新建 |
| `web/src/pages/plastics/PlasticStocktakePage.tsx` | 专用盘点页 | 新建 |
| `web/src/App.tsx` | 加 plastic-stocktakes 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填 塑胶盘点单 路由 | 改 |

---

## Task 1: 建表脚本 + 权限种子 + 应用到两库

**Files:** Create `db/21_plastic_stocktake.sql`, `db/seed_plastic_stocktake_perms.sql`

- [ ] **Step 1: 写建表脚本** `db/21_plastic_stocktake.sql`:

```sql
-- 塑胶模块 P3d:塑胶盘点单 + 塑胶盘点明细单(盈亏±)。审核后由 PlasticInventoryService 按盈亏数量实时聚合。
-- 头含审核留痕列 审核人/审核日期。数量列 decimal(免物料侧 real 的 CAST)。颜色列保留(可空)对齐其它塑胶明细表。幂等。
IF OBJECT_ID(N'[塑胶盘点单]', N'U') IS NULL
CREATE TABLE [塑胶盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [操作员] nvarchar(20) NULL, [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶盘点明细单]', N'U') IS NULL
CREATE TABLE [塑胶盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [系统数量] decimal(18,4) NULL, [盘点数量] decimal(18,4) NULL, [盈亏数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 写权限种子** `db/seed_plastic_stocktake_perms.sql`:

```sql
-- 开发用:给某用户授予 塑胶盘点单 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶盘点单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶盘点单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 应用到 ERP_DB 和 ERP_TEST_DB**(PowerShell):

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User")
  $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  foreach ($f in "db/21_plastic_stocktake.sql","db/seed_plastic_stocktake_perms.sql") {
    $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path $f)); $null = $cmd.ExecuteNonQuery()
  }
  $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 4: 验证两表存在**(PowerShell):

```powershell
$cs = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = "SELECT COUNT(*) FROM sys.tables WHERE name IN (N'塑胶盘点单',N'塑胶盘点明细单')"
Write-Output ("tables=" + $cmd.ExecuteScalar()); $c.Close()
```
Expected: `tables=2`。

- [ ] **Step 5: Commit**

```powershell
git add db/21_plastic_stocktake.sql db/seed_plastic_stocktake_perms.sql
git commit -m @'
feat(塑胶盘点): 建表脚本(盘点单+明细)+权限种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 塑胶盘点 DTO + Service(基准/盈亏/删除)

**Files:** Create `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeDtos.cs`, `.../PlasticStocktakeService.cs`; Test `tests/ErpApi.Tests/PlasticStocktakeServiceDbTests.cs`

- [ ] **Step 1: 写 DTO** `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticStocktake;

public sealed class PlasticStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public decimal 系统数量 { get; set; }
}

public sealed class PlasticStocktakeLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}

public sealed class PlasticStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<PlasticStocktakeLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticStocktakeHeaderDto
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

public sealed class PlasticStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}

public sealed class PlasticStocktakeDetailDto
{
    public PlasticStocktakeHeaderDto? 单头 { get; set; }
    public List<PlasticStocktakeLineRowDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的测试** Create `tests/ErpApi.Tests/PlasticStocktakeServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new PlasticInventoryService(Factory()));

    [SkippableFact]
    public async Task Basis_pulls_book_stock_from_inventory()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD01'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPD01',N'盘点仓','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRPD01',N'盘点仓',N'SPDPM01',N'ABS',N'规A',N'kg',100)");
        try
        {
            var basis = await Svc().BasisAsync("盘点仓");
            var row = Assert.Single(basis, b => b.物料编号 == "SPDPM01");
            Assert.Equal(100m, row.系统数量);
        }
        finally { c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPD01'"); }
    }

    [SkippableFact]
    public async Task Create_computes_盈亏_SPD_prefix_guard_then_delete()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticStocktakeCreateDto
        {
            仓库 = "盘点仓",
            明细 = [ new PlasticStocktakeLineDto { 物料编号 = "SPDPM02", 物料名称 = "PP", 单位 = "kg", 系统数量 = 100, 盘点数量 = 90 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SPD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal(100m, d!.明细[0].系统数量);
            Assert.Equal(90m, d.明细[0].盘点数量);
            Assert.Equal(-10m, d.明细[0].盈亏数量);
            // 已审核不能删
            c.Execute("UPDATE [塑胶盘点单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [塑胶盘点单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶盘点单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticStocktakeCreateDto { 仓库 = "盘点仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticStocktakeCreateDto { 仓库 = "", 明细 = [ new PlasticStocktakeLineDto { 物料编号 = "X", 系统数量 = 1, 盘点数量 = 1 } ] }, "tester"));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PlasticStocktakeServiceDbTests"`
Expected: FAIL(编译错误 PlasticStocktakeService 不存在)。

- [ ] **Step 4: 写 Service** `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticStocktake;

// 塑胶盘点(盈亏)。两层:塑胶盘点单 + 塑胶盘点明细单。审核位仅在单头。
// BasisAsync 从 PlasticInventoryService.ListAsync 取系统数量;盈亏=盘点−系统;审核后盈亏入库存(库存引擎按盈亏数量聚合)。
public sealed class PlasticStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, PlasticInventoryService inventory)
{
    public const string DocType = "塑胶盘点单";
    public const string Prefix = "SPD";

    public async Task<IReadOnlyList<PlasticStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.ListAsync(仓库, null);
        return inv.Select(r => new PlasticStocktakeBasisRow
        {
            物料编号 = r.物料编号, 物料名称 = r.物料名称, 规格 = r.规格, 单位 = r.单位, 仓位号 = r.仓位号, 系统数量 = r.库存数量
        }).ToList();
    }

    public async Task<string> CreateAsync(PlasticStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶盘点单至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶盘点单必须指定仓库");
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[仓位号],[单位],[系统数量],[盘点数量],[盈亏数量])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@仓位号,@单位,@系统数量,@盘点数量,@盈亏数量)",
                new
                {
                    单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.仓位号, l.单位,
                    l.系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - l.系统数量
                }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [塑胶盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticStocktakeHeaderDto>()).AsList();
        return new PagedResult<PlasticStocktakeHeaderDto>(items, total);
    }

    public async Task<PlasticStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [塑胶盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[仓位号],[单位],[系统数量],[盘点数量],[盈亏数量]
FROM [塑胶盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticStocktakeLineRowDto>()).AsList();
        return new PlasticStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticStocktakeServiceDbTests"`
Expected: PASS 3 个。

- [ ] **Step 6: Commit**

```powershell
git add src/ErpApi/Features/Plastics/PlasticStocktake tests/ErpApi.Tests/PlasticStocktakeServiceDbTests.cs
git commit -m @'
feat(塑胶盘点): service+DTO(SPD·基准取库存·盈亏=盘点−系统)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Controller + 注册 + 白名单 + 菜单 + 库存盘点支 + 联动测试

**Files:** Create `.../PlasticStocktakeController.cs`; Modify `Program.cs`, `PostableDocuments.cs`, `MenuCatalog.cs`, `PlasticInventoryService.cs`; Test `PlasticInventoryServiceDbTests.cs`

- [ ] **Step 1: 写 Controller** `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticStocktake;

// 塑胶盘点 REST(精简塑胶风格,无月结锁/审计)。审核仅翻单头审核位;库存引擎按单头JOIN过滤审核。盘点无单价保密。
[ApiController]
[Authorize]
[Route("api/plastic-stocktakes")]
public sealed class PlasticStocktakeController(
    PlasticStocktakeService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶盘点单";
    private const string Table = "塑胶盘点单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

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
    public async Task<IActionResult> Create([FromBody] PlasticStocktakeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 2: Program.cs 注册** 在现有 `PlasticScrapService` 注册行(`AddScoped<...PlasticScrap.PlasticScrapService>();`)之后追加:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticStocktake.PlasticStocktakeService>();
```

- [ ] **Step 3: 过账白名单** 在 `src/ErpApi/Engines/Posting/PostableDocuments.cs` 的 `["塑胶报废单"] = "单号",` 之后追加:

```csharp
            ["塑胶盘点单"] = "单号",
```

- [ ] **Step 4: 菜单目录** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶仓储","塑胶报废单"),` 之后追加:

```csharp
        new("塑胶仓储","塑胶盘点单"),
```

- [ ] **Step 5: 库存 LedgerUnion 加盘点支(第6支)** 在 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` 的 `LedgerUnion` 常量末尾(塑胶报废明细单那段之后,闭合 `";` 之前)追加:

```sql
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[盈亏数量]
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
```

并把该常量上方注释改为:

```csharp
// 塑胶库存(口径=塑胶):入仓(+) / 领料(−) / 退料(+) / 退仓(−) / 报废(−) / 盘点(±)。仅审核='1',按 物料编号×仓库 汇总。
```

- [ ] **Step 6: 加库存联动测试** 在 `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` 末尾测试方法之后(类闭合 `}` 之前)追加。文件顶部已有 `using ErpApi.Engines.Posting;`(PostingEngine/AuditLogger):

```csharp
    [SkippableFact]
    public async Task Stocktake_signed_盈亏_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SPDINV01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRPDI01'");
            c.Execute("DELETE FROM [塑胶盘点明细单] WHERE [物料编号]=N'SPDINV01'; DELETE FROM [塑胶盘点单] WHERE [单号]=N'SPDPDI01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRPDI01',N'盘点仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRPDI01',N'盘点仓',N'SPDINV01',100)");
        c.Execute("INSERT INTO [塑胶盘点单]([单号],[仓库],[审核]) VALUES(N'SPDPDI01',N'盘点仓','0')");
        c.Execute("INSERT INTO [塑胶盘点明细单]([单号],[仓库],[物料编号],[系统数量],[盘点数量],[盈亏数量]) VALUES(N'SPDPDI01',N'盘点仓',N'SPDINV01',100,90,-10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRPDI01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SPDINV01", null));
            await engine.ApproveAsync("塑胶盘点单", "SPDPDI01", "t");
            Assert.Equal(90m, await Svc().StockOfAsync("SPDINV01", null));
        }
        finally { Clean(); }
    }
```

- [ ] **Step 7: 跑库存测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticInventoryServiceDbTests"`
Expected: PASS（原有 + 新增盘点联动 100→90）。

- [ ] **Step 8: 全量后端回归**

Run: `dotnet test`
Expected: 全部 PASS(后端 352 → 约 355)。报告总数行。

- [ ] **Step 9: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs
git commit -m @'
feat(塑胶盘点): Controller+DI+白名单+菜单+库存LedgerUnion盘点支(±)+联动测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 前端专用盘点页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticStocktake.ts`, `web/src/pages/plastics/PlasticStocktakePage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: 写 API** `web/src/api/plasticStocktake.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PSBasisRow { 物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string; 仓位号?: string; 系统数量: number }
export interface PSLine { 物料编号?: string; 物料名称?: string; 规格?: string; 仓位号?: string; 单位?: string; 系统数量: number; 盘点数量: number }
export interface PSCreate { 仓库: string; 备注?: string; 明细: PSLine[] }
export interface PSHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string }

const enc = encodeURIComponent;
export const plasticStocktakeApi = {
  basis: (仓库: string) => api.get<PSBasisRow[]>("/plastic-stocktakes/basis", { params: { 仓库 } }).then(r => r.data),
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<PSHeader>>("/plastic-stocktakes", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: PSCreate) => api.post<{ 单号: string }>("/plastic-stocktakes", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/plastic-stocktakes/${enc(单号)}`),
  approve: (单号: string) => api.post(`/plastic-stocktakes/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/plastic-stocktakes/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: 写专用页** `web/src/pages/plastics/PlasticStocktakePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, message } from "antd";
import { plasticStocktakeApi, type PSBasisRow, type PSHeader, type PSLine } from "../../api/plasticStocktake";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶盘点单";
interface BasisRow extends PSBasisRow { 盘点数量?: number }

export default function PlasticStocktakePage() {
  const perms = usePerms();
  const [仓库, set仓库] = useState("");
  const [basis, setBasis] = useState<BasisRow[]>([]);
  const [rows, setRows] = useState<PSHeader[]>([]);
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    try { setRows((await plasticStocktakeApi.list(1, 50, 仓库)).items); }
    catch { message.error("加载盘点单失败"); }
  }, [仓库]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const loadBasis = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    try { const b = await plasticStocktakeApi.basis(仓库); setBasis(b.map(x => ({ ...x, 盘点数量: x.系统数量 }))); }
    catch { message.error("加载库存基准失败"); }
  };
  const setQty = (i: number, val: number) =>
    setBasis(prev => prev.map((b, j) => (j === i ? { ...b, 盘点数量: val } : b)));

  const submit = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    const 明细: PSLine[] = basis.map(b => ({
      物料编号: b.物料编号, 物料名称: b.物料名称, 规格: b.规格, 仓位号: b.仓位号, 单位: b.单位,
      系统数量: b.系统数量, 盘点数量: Number(b.盘点数量 ?? b.系统数量),
    }));
    if (明细.length === 0) { message.error("无库存可盘点"); return; }
    setSaving(true);
    try {
      await plasticStocktakeApi.create({ 仓库, 明细 });
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
    { title: "规格", dataIndex: "规格" }, { title: "仓位号", dataIndex: "仓位号" }, { title: "单位", dataIndex: "单位" },
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
      render: (_: unknown, row: PSHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticStocktakeApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticStocktakeApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该盘点单?" onConfirm={() => act(() => plasticStocktakeApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="塑胶盘点" variant="borderless"
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

- [ ] **Step 3: 加路由** 在 `web/src/App.tsx`:顶部 import 区(其它塑胶页 import 附近)加:

```tsx
import PlasticStocktakePage from "./pages/plastics/PlasticStocktakePage";
```
在 `plastic-scraps` 路由行之后加:

```tsx
          <Route path="plastic-stocktakes" element={<PlasticStocktakePage />} />
```

- [ ] **Step 4: 填菜单路由** 在 `web/src/nav/menuTree.tsx` 的 ⑧ 塑胶仓库组,把占位 `M("塑胶盘点单")` 改为:

```tsx
M("塑胶盘点单", "/plastic-stocktakes", "塑胶盘点单")
```

- [ ] **Step 5: 前端测试 + 构建**

Run: `npm --prefix web run test`
Expected: PASS(54,无回归)。

Run: `npm --prefix web run build`
Expected: tsc 干净 + 构建成功。

- [ ] **Step 6: Commit**

```powershell
git add web/src/api/plasticStocktake.ts web/src/pages/plastics/PlasticStocktakePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶盘点): 前端专用盘点页+API+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟库存联动(本地 API)**

停止旧后端(占 5000 的 ErpApi 进程),用新代码重启后端(`dotnet run --project src/ErpApi -c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env 设 `ERP_DB`/`ERP_JWT_KEY`,后台运行),待端口就绪。用 Node axios(`proxy:false`,绕系统代理 127.0.0.1:7892)脚本以 admin/admin123 登录后:
1. 建塑胶入仓单(物料 SMOKEPD,仓库 盘点仓,数量 100)→ approve;
2. `GET /api/plastic-stocktakes/basis?仓库=盘点仓` → 含 SMOKEPD 系统数量 100;
3. 建塑胶盘点单(仓库 盘点仓,明细 系统100/盘点90)→ approve;
4. `GET /api/plastic-inventory?keyword=SMOKEPD` → 库存数量 = 90;
5. 清理:反审核 + 删两单(盘点、入仓)。

Expected: basis=100、库存=90、清理后残留 0。SPD 单号正确。

- [ ] **Step 2: opus 全分支终审**

派 opus 子代理对 `feat-plastic-stocktake` 全分支 diff 终审:确认盘点支用 `盈亏数量`(有符号)、JOIN 自身两表、白名单/审核列/菜单/DI 齐全、basis 取库存正确、盈亏=盘点−系统、前端 PSLine 字段与 DTO 一致、路由/menuKey 对齐。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-stocktake -m @'
Merge branch 'feat-plastic-stocktake' into master

塑胶盘点(SPD·盈亏±·库存第6支)P3d·P3收官

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-stocktake
```

- [ ] **Step 4: 写 worklog** Create `docs/worklogs/2026-06-26-plastic-stocktake.md`,记录:做了什么(SPD 盘点录入单·basis 取库存·盈亏=盘点−系统·审核入库存第6支·专用页非通用组件)、执行(subagent-driven + opus 终审)、测试(后端约 355 / 前端 54)、冒烟(入仓100→盘点90→库存90)、合并 commit、**P3 仓库全部完成**、下一步 P4 塑胶报表。

- [ ] **Step 5: 更新 MEMORY.md** 在 `erp-plastic-module-p0-0625.md` 与索引行追加 P3d 摘要、标注 P3 收官,下一步改为「P4 塑胶报表」。Commit worklog。

```powershell
git add docs/worklogs/2026-06-26-plastic-stocktake.md
git commit -m @'
docs(worklog): 塑胶盘点 P3d·P3收官 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB(2表+审核日期+decimal)=Task1;DTO/Service(basis/盈亏/list/get/delete·SPD)=Task2;Controller(basis+CRUD+审核·精简)+白名单+菜单+DI+库存第6支=Task3;前端专用页+API+路由+菜单=Task4;冒烟/终审/合并/worklog=Task5。塑胶盘点查询报表明确不做(P4)。无遗漏。
- **类型一致**:DTO `PlasticStocktakeBasisRow/LineDto/CreateDto/HeaderDto/LineRowDto/DetailDto` 跨 Service/Controller/测试一致;Service 方法 `BasisAsync/CreateAsync/ListAsync/GetAsync/DeleteAsync`;前端 `PSBasisRow/PSLine/PSCreate/PSHeader` 与后端字段名一致(物料编号/名称/规格/仓位号/单位/系统数量/盘点数量)。
- **无占位**:每步含完整代码/命令/预期。
- **符号正确**:盘点支用 `d.[盈亏数量]`(有符号,非 `*-1`);盈亏=盘点−系统(亏为负→库存减)。
- **前缀**:SPD,与 DocType 常量、测试 `Assert.StartsWith`、冒烟一致。
- **basis 无颜色**:DTO/明细不含颜色(库存 ListAsync 无该列);明细表 DDL 保留可空颜色列对齐 schema,创建时不填。
- **精简 controller**:无 PeriodLock/audit(塑胶模块无月结),与 PlasticReturnController 一致。
