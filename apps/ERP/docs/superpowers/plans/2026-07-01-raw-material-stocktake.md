# 原料盘点单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ⑪原料仓库 新增「原料盘点单」(以实盘校准账面库存)全屏录入单;审核时把 `塑胶原料资料.[库存]` 校准为盘点数量。

**Architecture:** 后端新 feature 目录 Dapper。**审核逻辑独特**:不走通用 IPostingEngine,Service 自建 `ApproveAsync`(一个事务里翻审核位 + `UPDATE 塑胶原料资料 SET 库存=盘点数量`),`UnapproveAsync` 仅翻审核位不回滚。前端专用盘点页(逐行选料带出系统数量=当前库存,盈亏=盘点−系统)。

**Tech Stack:** ASP.NET Core 8 + Dapper + SQL Server LocalDB(库 `erp`/`erp_test`);React + TS + antd;xUnit + Vitest。

**命名对照**:DocType/表名=`原料盘点单`/`原料盘点明细单`;前缀=`YPD`;路由/base=`/plastic-raw-material-stocktake`;C# 命名空间/类前缀=`PlasticRawMaterialStocktake`;TS 类型前缀=`RST`。

**镜像源**:`塑胶盘点`(`PlasticStocktake*`·头/明细/盈亏结构)。**关键差异**:①无仓库;②系统数量选料带出(非 basis);③**审核自建事务写库存**(塑胶盘点走 posting 靠 LedgerUnion,原料盘点无台账故直接 UPDATE 静态列);④明细加 产地/每包重量;⑤**不入 PostableDocuments 白名单**(审核不走通用引擎)。

---

## Task 1: 建表 + 菜单 + DI + 前端路由(**不改白名单**)

**Files:**
- Create: `db/38_raw_material_stocktake.sql`
- Create: `db/seed_raw_material_stocktake_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Modify: `src/ErpApi/Program.cs`
- Modify: `web/src/nav/menuTree.tsx:128`

**注意**:本单审核走 Service 自建事务、不经通用 IPostingEngine,故**不需要**改 `PostableDocuments.cs`。

- [ ] **Step 1: 建表 SQL** — 创建 `db/38_raw_material_stocktake.sql`:

```sql
-- 原料盘点单(原料仓库·以实盘校准账面)·头 + 明细。审核时 UPDATE 塑胶原料资料.库存=盘点数量。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料盘点单]', N'U') IS NULL
CREATE TABLE [原料盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [电脑单号] nvarchar(40) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料盘点明细单]', N'U') IS NULL
CREATE TABLE [原料盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [单位] nvarchar(20) NULL,
    [系统数量] decimal(18,4) NULL,
    [盘点数量] decimal(18,4) NULL,
    [盈亏数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 权限种子 SQL** — 创建 `db/seed_raw_material_stocktake_perms.sql`:

```sql
-- 开发用:给 admin 授予 原料盘点单 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料盘点单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料盘点单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: MenuCatalog** — 在 `src/ErpApi/Features/Admin/MenuCatalog.cs`,把 `new("原料仓库","原料出库表"),` 改为:

```csharp
        new("原料仓库","原料出库表"),
        new("原料仓库","原料盘点单"),
```

- [ ] **Step 4: DI 注册** — 在 `src/ErpApi/Program.cs` 中 `PlasticRawMaterialStockIssueService` 注册行后加:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialStocktake.PlasticRawMaterialStocktakeService>();
```

- [ ] **Step 5: 前端菜单占位换路由** — 在 `web/src/nav/menuTree.tsx:128`,把 `M("原料盘点单")` 换成 `M("原料盘点单", "/plastic-raw-material-stocktake", "原料盘点单")`。该行现为:

```tsx
    M("原料出库表", "/plastic-raw-material-stock-issue", "原料出库表"), M("原料退库表", "/plastic-raw-material-stock-return", "原料退库表"), M("原料盘点单"),
```

改为:

```tsx
    M("原料出库表", "/plastic-raw-material-stock-issue", "原料出库表"), M("原料退库表", "/plastic-raw-material-stock-return", "原料退库表"), M("原料盘点单", "/plastic-raw-material-stocktake", "原料盘点单"),
```

- [ ] **Step 6: 应用 SQL 到两库** — 若 LocalDB 停止先 `SqlLocalDB start MSSQLLocalDB`(默认连接串失败时用 `SqlLocalDB info MSSQLLocalDB` 拿命名管道 `np:\\.\pipe\...` 在 PowerShell 里用 `-S` 指定):

```
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/38_raw_material_stocktake.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp_test -i db/38_raw_material_stocktake.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/seed_raw_material_stocktake_perms.sql
```
验证:`sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -Q "SELECT OBJECT_ID(N'[原料盘点单]'), OBJECT_ID(N'[原料盘点明细单]')"` 两列非 NULL。seed 只需 dev 库 `erp`。

- [ ] **Step 7: 不要 dotnet build**(Step 4 引用的 Service 在 Task 2 才建,现编译必失败,属预期)。重读 2 个改动 C# 文件确认逗号/命名空间。

- [ ] **Step 8: Commit**

```bash
git add db/38_raw_material_stocktake.sql db/seed_raw_material_stocktake_perms.sql src/ErpApi/Features/Admin/MenuCatalog.cs src/ErpApi/Program.cs web/src/nav/menuTree.tsx
git commit -m "feat(原料盘点单): 建表+菜单+DI+前端路由占位落地(审核自建不入白名单)"
```

---

## Task 2: 后端 DTOs + Service(含自建审核写库存)

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeService.cs`

- [ ] **Step 1: DTOs** — 创建 `PlasticRawMaterialStocktakeDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialStocktake;

public sealed class PlasticRawMaterialStocktakeHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeDetailDto
{
    public PlasticRawMaterialStocktakeHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialStocktakeLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStocktakeCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStocktakeCreateDto
{
    public string? 电脑单号 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialStocktakeCreateLineDto> 明细 { get; set; } = new();
}
```

- [ ] **Step 2: Service** — 创建 `PlasticRawMaterialStocktakeService.cs`(注意 `ApproveAsync` 自建事务写库存):

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStocktake;

// 原料盘点单(原料仓库·以实盘校准账面)。审核 = 自建事务:翻审核位 + UPDATE 塑胶原料资料.库存=盘点数量(按原料编号)。
// 反审核仅翻审核位=0,不回滚库存。不走通用 IPostingEngine(需在同事务写库存)。
public sealed class PlasticRawMaterialStocktakeService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料盘点单";
    public const string Prefix = "YPD";   // 原料盘点单号 = YPD + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料盘点单至少要有一行明细");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料盘点单]([单号],[日期],[电脑单号],[操作员],[审核],[备注])
VALUES(@单号,@日期,@电脑单号,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.电脑单号, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料盘点明细单]([单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[系统数量],[盘点数量],[盈亏数量],[备注])
VALUES(@单号,@原料编号,@原料名称,@产地,@每包重量,@单位,@系统数量,@盘点数量,@盈亏数量,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单位, l.系统数量, l.盘点数量,
                      盈亏数量 = l.盘点数量 - l.系统数量, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[电脑单号],[操作员],[审核],[审核人],[备注]
FROM [原料盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialStocktakeHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialStocktakeHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[电脑单号],[操作员],[审核],[审核人],[备注]
FROM [原料盘点单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[产地],[每包重量],[单位],[系统数量],[盘点数量],[盈亏数量],[备注]
FROM [原料盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialStocktakeLineDto>()).AsList();
        return new PlasticRawMaterialStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    // 审核:一个事务里翻审核位 + 把每行 盘点数量 写回 塑胶原料资料.库存(按原料编号校准账面)。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [原料盘点单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync(@"
UPDATE m SET m.[库存] = d.[盘点数量]
FROM [塑胶原料资料] m
JOIN [原料盘点明细单] d ON d.[原料编号] = m.[物料编号]
WHERE d.[单号] = @单号 AND d.[原料编号] IS NOT NULL", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 反审核:仅翻审核位=0,不回滚库存(盘前值不可知)。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [原料盘点单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: 编译** — Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo` → 0 errors。(后端 dev server 若占 bin 锁先 `taskkill //F //IM dotnet.exe`。)

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeDtos.cs src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeService.cs
git commit -m "feat(原料盘点单): 后端 DTOs + Service(YPD·自建审核 UPDATE塑胶原料资料.库存=盘点数量·反审核不回滚)"
```

---

## Task 3: 后端 Controller(审核调 svc 自建·不走 posting)

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeController.cs`

- [ ] **Step 1: Controller** — 创建 `PlasticRawMaterialStocktakeController.cs`(**Approve/Unapprove 调 svc,不注入 IPostingEngine**):

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStocktake;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-stocktake")]
public sealed class PlasticRawMaterialStocktakeController(
    PlasticRawMaterialStocktakeService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料盘点单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

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
    public async Task<IActionResult> Create([FromBody] PlasticRawMaterialStocktakeCreateDto dto)
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
        if (!await svc.ApproveAsync(单号, CurrentUser)) return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await svc.UnapproveAsync(单号, CurrentUser)) return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 2: 编译** — Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo` → 0 errors。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialStocktake/PlasticRawMaterialStocktakeController.cs
git commit -m "feat(原料盘点单): Controller(9位授权·审核调svc自建写库存·不走通用引擎)"
```

---

## Task 4: 后端测试(验证审核校准库存)

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialStocktakeServiceDbTests.cs`

- [ ] **Step 1: 写测试** — 创建 `tests/ErpApi.Tests/PlasticRawMaterialStocktakeServiceDbTests.cs`(在 `塑胶原料资料` 插测试原料库存100→盘点90→审核后验证库存=90):

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticRawMaterialStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料盘点明细单] WHERE [原料编号]=N'YPD-PM'");
        c.Execute("DELETE FROM [原料盘点单] WHERE [备注]=N'YPD测试盘点'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
    }
    private static void SeedMaterial(SqlConnection c, decimal 库存)
    {
        c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[库存]) VALUES(N'YPD-PM',N'盘点测试原料',N'kg',@库存)", new { 库存 });
    }

    private static PlasticRawMaterialStocktakeCreateDto MakeDto() => new()
    {
        电脑单号 = "PC-YPD",
        备注 = "YPD测试盘点",
        明细 =
        {
            new() { 原料编号 = "YPD-PM", 原料名称 = "盘点测试原料", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 系统数量 = 100, 盘点数量 = 90 },
        }
    };

    [SkippableFact]
    public async Task Create_computes_盈亏()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YPD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Single(d!.明细);
            Assert.Equal(100m, d.明细[0].系统数量);
            Assert.Equal(90m, d.明细[0].盘点数量);
            Assert.Equal(-10m, d.明细[0].盈亏数量);
            Assert.Equal("台湾", d.明细[0].产地);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_calibrates_库存_to_盘点数量()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await Svc().ApproveAsync(单号, "tester"));
            var 库存 = c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
            Assert.Equal(90m, 库存);   // 审核把账面校准为盘点数
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Unapprove_does_not_rollback_库存()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await Svc().ApproveAsync(单号, "tester"));
            Assert.True(await Svc().UnapproveAsync(单号, "tester"));
            var 库存 = c.ExecuteScalar<decimal?>("SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-PM'");
            Assert.Equal(90m, 库存);   // 反审核不回滚,库存仍为盘点数
            var d = await Svc().GetAsync(单号);
            Assert.Equal("0", d!.单头!.审核);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c); SeedMaterial(c, 100m);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await Svc().ApproveAsync(单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```

- [ ] **Step 2: 跑本文件测试** — LocalDB 停止先 `SqlLocalDB start MSSQLLocalDB`;表已存在(Task 1)。Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticRawMaterialStocktakeServiceDbTests" -nologo` → Passed! 4 tests(须真跑真过,不 skip;若 skip 报 DONE_WITH_CONCERNS)。若 FAIL 疑为 Service SQL 问题(尤其审核 UPDATE JOIN),报 BLOCKED 附详情,勿自行改 Service。

- [ ] **Step 3: 全量后端测试** — Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo` → 全过,总数 = 之前 424 + 4 = 428(报实际计数)。

- [ ] **Step 4: Commit**

```bash
git add tests/ErpApi.Tests/PlasticRawMaterialStocktakeServiceDbTests.cs
git commit -m "test(原料盘点单): create盈亏-10/审核校准库存90/反审核不回滚/已审核删抛错"
```

---

## Task 5: 前端 api + LineTable

**Files:**
- Create: `web/src/api/plasticRawMaterialStocktake.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialStocktakeLineTable.tsx`

- [ ] **Step 1: api** — 创建 `web/src/api/plasticRawMaterialStocktake.ts`:

```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface RSTLine {
  id?: number;
  原料编号?: string; 原料名称?: string; 产地?: string; 每包重量?: number | null; 单位?: string;
  系统数量?: number; 盘点数量?: number; 盈亏数量?: number; 备注?: string;
}
export interface RSTHeader {
  id: number; 单号?: string; 日期?: string; 电脑单号?: string; 操作员?: string;
  审核?: string; 审核人?: string; 备注?: string;
}
export interface RSTDetail { 单头?: RSTHeader; 明细: RSTLine[] }

const enc = encodeURIComponent;
const base = "/plastic-raw-material-stocktake";
export const plasticRawMaterialStocktakeApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<RSTHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<RSTDetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: LineTable**(原料🔍带出系统数量=库存·盘点录入·盈亏只读计算·无价)— 创建 `web/src/pages/plastics/PlasticRawMaterialStocktakeLineTable.tsx`:

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import PlasticRawMaterialPicker from "./PlasticRawMaterialPicker";
import type { PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";
import type { RSTLine } from "../../api/plasticRawMaterialStocktake";

// 原料盘点明细可编辑行:原料编号🔍|原料名称只读|产地|每包重量|单位|系统数量只读|盘点数量|盈亏数量只读(=盘点−系统)|备注|删除。无价。
export default function PlasticRawMaterialStocktakeLineTable({ value, onChange, readOnly }: {
  value: RSTLine[];
  onChange: Dispatch<SetStateAction<RSTLine[]>>;
  readOnly?: boolean;
}) {
  const setLine = (i: number, patch: Partial<RSTLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticRawMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      原料编号: row.物料编号 ?? undefined, 原料名称: row.物料名称 ?? undefined,
      产地: row.产地 ?? undefined, 每包重量: row.每包重量 ?? undefined, 单位: row.单位 ?? undefined,
      系统数量: Number(row.库存 ?? 0),
    });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;
  const diff = (r: RSTLine) => Number(r.盘点数量 ?? 0) - Number(r.系统数量 ?? 0);

  const columns: ColumnsType<RSTLine> = [
    { title: "原料编号", dataIndex: "原料编号", width: 150, render: (_, r, i) =>
      <Input style={{ width: 128 }} value={r.原料编号 ?? ""} disabled={readOnly} onChange={e => setLine(i, { 原料编号: e.target.value })}
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setMatPickFor(i)} />} /> },
    { title: "原料名称", dataIndex: "原料名称", width: 150, render: (v: string) => ro(v) },
    { title: "产地", dataIndex: "产地", width: 100, render: (_, r, i) => txt(r.产地, s => setLine(i, { 产地: s }), 88) },
    { title: "每包重量", dataIndex: "每包重量", width: 90, render: (v?: number | null) => ro(v) },
    { title: "单位", dataIndex: "单位", width: 70, render: (v: string) => ro(v) },
    { title: "系统数量", dataIndex: "系统数量", width: 100, align: "right" as const, render: (v?: number | null) => ro(v) },
    { title: "盘点数量", dataIndex: "盘点数量", width: 110, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 96 }} disabled={readOnly} value={r.盘点数量 ?? 0} onChange={n => setLine(i, { 盘点数量: Number(n ?? 0) })} /> },
    { title: "盈亏数量", dataIndex: "_diff", width: 100, align: "right" as const, render: (_: unknown, r: RSTLine) => diff(r).toFixed(2) },
    { title: "备注", dataIndex: "备注", width: 130, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: RSTLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: RSTLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 系统数量: 0, 盘点数量: 0 }])}>加一行</Button>}
      <PlasticRawMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: 类型检查** — Run: `cd web && npx tsc --noEmit` → 0 errors。(`PlasticRawMaterialRow` 已有 `库存?`/`产地?`/`每包重量?` 字段·见 `plasticRawMaterialMaster.ts`。)

- [ ] **Step 4: Commit**

```bash
git add web/src/api/plasticRawMaterialStocktake.ts web/src/pages/plastics/PlasticRawMaterialStocktakeLineTable.tsx
git commit -m "feat(原料盘点单): 前端 api + LineTable(选料带出系统数量=库存·盈亏=盘点−系统·无价)"
```

---

## Task 6: 前端 Page + 路由

**Files:**
- Create: `web/src/pages/plastics/PlasticRawMaterialStocktakePage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Page** — 创建 `web/src/pages/plastics/PlasticRawMaterialStocktakePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { plasticRawMaterialStocktakeApi, type RSTHeader, type RSTLine } from "../../api/plasticRawMaterialStocktake";
import PlasticRawMaterialStocktakeLineTable from "./PlasticRawMaterialStocktakeLineTable";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "原料盘点单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticRawMaterialStocktakePage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<RSTLine[]>([]);
  const [rows, setRows] = useState<RSTHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticRawMaterialStocktakeApi.list(1, 50, "")).items); }
    catch { message.error("加载原料盘点单失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser() });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticRawMaterialStocktakeApi.get(单号);
      const h = d.单头 ?? {} as RSTHeader;
      form.setFieldsValue({ 电脑单号: h.电脑单号, 备注: h.备注, 操作员: h.操作员, 日期: h.日期?.slice(0, 10) });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开原料盘点单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.原料编号);
    if (ok.length === 0) { message.error("请至少录入一行有效明细(原料编号)"); return; }
    setSaving(true);
    try {
      await plasticRawMaterialStocktakeApi.create({ ...v, 明细: ok });
      message.success("原料盘点单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 系统合计 = lines.reduce((s, l) => s + Number(l.系统数量 ?? 0), 0);
  const 盘点合计 = lines.reduce((s, l) => s + Number(l.盘点数量 ?? 0), 0);
  const 盈亏合计 = 盘点合计 - 系统合计;

  const listColumns: ColumnsType<RSTHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "操作员", dataIndex: "操作员", key: "操作员" },
    { title: "备注", dataIndex: "备注", key: "备注" },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: RSTHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticRawMaterialStocktakeApi.approve(row.单号!), "已审核·库存已校准")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticRawMaterialStocktakeApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该原料盘点单?" onConfirm={() => act(() => plasticRawMaterialStocktakeApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料盘点单·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`原料盘点单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={5}><Form.Item name="电脑单号" label="电脑单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={9}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticRawMaterialStocktakeLineTable value={lines} onChange={setLines} readOnly={readOnly} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="系统数量合计" value={系统合计} precision={2} />
        <Statistic title="盘点数量合计" value={盘点合计} precision={2} />
        <Statistic title="盈亏数量合计" value={盈亏合计} precision={2} />
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: App 路由** — 在 `web/src/App.tsx` 中 `PlasticRawMaterialStockIssuePage` 的 import 后加:

```tsx
import PlasticRawMaterialStocktakePage from "./pages/plastics/PlasticRawMaterialStocktakePage";
```

在 `<Route path="plastic-raw-material-stock-issue" ...>` 行后加:

```tsx
          <Route path="plastic-raw-material-stocktake" element={<PlasticRawMaterialStocktakePage />} />
```

- [ ] **Step 3: 类型检查 + 前端测试** — Run: `cd web && npx tsc --noEmit && npx vitest run` → tsc 0 errors;vitest 全绿(54 passed 不变)。若 tsc 报错:核对 `RSTHeader`/`RSTLine` 字段;`can`/`usePerms` 导出;`PlasticRawMaterialRow.库存`。只改真实类型错,汇报偏差。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/plastics/PlasticRawMaterialStocktakePage.tsx web/src/App.tsx
git commit -m "feat(原料盘点单): 录入页(日期/电脑单号/操作员·三合计·审核校准库存)+路由"
```

---

## Task 7: Release 冒烟 + 终审 + worklog + 合并

**Files:**
- Create: `docs/worklogs/2026-07-01-raw-material-stocktake.md`

- [ ] **Step 1: HTTP 冒烟(重点验证审核校准库存)** — 启动后端(env `ERP_DB`·`--urls http://localhost:5000`),admin 登录取 token。**坑**:Write 写 UTF-8 payload 文件 `--data-binary @file`;`export no_proxy=localhost,127.0.0.1`(勿用 `--noproxy *`)。步骤:
1. 先手动在 dev 库 `erp` 插一个测试原料:`sqlcmd ... -Q "INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[库存]) VALUES(N'YPD-SMK',N'盘点冒烟原料',N'kg',100)"`(或用主数据页新建)。
2. `POST /api/plastic-raw-material-stocktake`(1 行明细:原料编号 YPD-SMK·系统数量 100·盘点数量 90)→ 单号 `YPD20260701001`。
3. `GET .../YPD20260701001` → 明细盈亏=−10、系统100/盘点90。
4. `POST .../approve` → 204;查 `SELECT [库存] FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-SMK'` → **90(已校准)**。
5. `POST .../unapprove` → 204;再查库存 → **仍 90(不回滚)**;`GET` 审核=0。
6. `DELETE` → 204。清理测试原料 `DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'YPD-SMK'`。

各步如上。冒烟后停后端、清临时文件。

- [ ] **Step 2: opus 终审** — 对全分支终审:①审核自建事务(翻审核位 + UPDATE 塑胶原料资料.库存=盘点数量·JOIN 原料编号=物料编号)②反审核不回滚库存③Create 盈亏=盘点−系统(后端算)④五处列对齐(INSERT↔@参↔表列↔SELECT↔DTO·含 系统/盘点/盈亏数量)⑤Controller 不注入 IPostingEngine、Approve/Unapprove 调 svc⑥**未入 PostableDocuments 白名单**(正确·审核不走通用引擎)⑦菜单/DI/种子·**未误改白名单**⑧前端 选料带出系统数量=库存·盈亏只读计算·三合计·门控⑨路由+类型一致⑩仅动允许文件(注意本单不改 PostableDocuments.cs)。Expected: READY TO MERGE。

- [ ] **Step 3: worklog + MEMORY.md** — 创建 `docs/worklogs/2026-07-01-raw-material-stocktake.md`,并在外部记忆 `C:\Users\DELL\.claude\projects\D--WebpageERP\memory\MEMORY.md`(非仓库文件·单独 Write/Edit 不 git add)加一行指针。

- [ ] **Step 4: Commit + 合并**

```bash
git add docs/worklogs/2026-07-01-raw-material-stocktake.md docs/superpowers/plans/2026-07-01-raw-material-stocktake.md
git commit -m "docs(worklog): 原料盘点单 2026-07-01"
git checkout master && git merge --no-ff feat-raw-material-stocktake -m "Merge branch 'feat-raw-material-stocktake' into master"
git branch -d feat-raw-material-stocktake
```

(分支 `feat-raw-material-stocktake` 在执行开始时从 master 创建。)

---

## 自查(spec 覆盖 / 一致性)

- **spec 数据库**:头 8 列 + 明细 11 列 → Task 1 Step 1 全覆盖(系统/盘点/盈亏数量)。✅
- **spec 审核校准库存**:Task 2 `ApproveAsync` 自建事务翻审核位 + `UPDATE 塑胶原料资料 SET 库存=盘点数量 JOIN 原料编号=物料编号`;`UnapproveAsync` 仅翻位不回滚。✅ Controller 调 svc 不走 posting(Task 3)。✅
- **spec 系统数量选料带出**:Task 5 `fillFromMaterial` 取 `row.库存` → 系统数量;盈亏=盘点−系统只读列。✅
- **spec 不入白名单**:Task 1 明确不改 PostableDocuments;Task 3 Controller 不注入 IPostingEngine。✅
- **spec 无价**:DTO/Service/前端 均无单价金额。✅
- **spec 前缀 YPD / 菜单 / DI / 种子**:Task 1 + Task 2(Prefix="YPD")。✅
- **测试验证库存校准**:Task 4 `Approve_calibrates_库存_to_盘点数量`(库存 100→90)+ `Unapprove_does_not_rollback_库存`(仍 90)+ 盈亏−10 + 已审删抛错。✅
- **类型一致性**:C# `PlasticRawMaterialStocktake*`、TS `RST*`、api base `/plastic-raw-material-stocktake`、路由同名、DocType/Table `原料盘点单`。LineTable/Page 用 系统数量/盘点数量/盈亏数量。`PlasticRawMaterialRow.库存` 存在。✅
- **占位符扫描**:无 TBD/TODO,所有代码步含完整代码。✅
