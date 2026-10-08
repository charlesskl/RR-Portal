# 原料出库单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ⑪原料仓库 新增「原料出库单」(生产领料出库·无价)全屏录入单,支持从已审核原料生产需求表(YLX)调入清单。

**Architecture:** 后端新 feature 目录 Dapper(无 EF 实体·审核走通用 IPostingEngine 纯锁定不动库存·库存台账延后)。前端克隆原料退库表页 + 加「啤机外发单号」列 + 「调入清单」Modal(从 YLX 需求表复用 api)。

**Tech Stack:** ASP.NET Core 8 + Dapper + SQL Server LocalDB(库 `erp`/`erp_test`);React + TS + antd;xUnit + Vitest。

**命名对照**:DocType/表名=`原料出库单`/`原料出库明细单`;**菜单权限名=`原料出库表`**(与 menuTree 占位一致);前缀=`YCK`;路由/base=`/plastic-raw-material-stock-issue`;C# 命名空间/类前缀=`PlasticRawMaterialStockIssue`;TS 类型前缀=`RSI`。

**镜像源**:`原料退库表`(`PlasticRawMaterialStockReturn*` 后端 + 前端·无价领料侧结构);调入源 `原料生产需求表`(`plasticRawMaterialDemandApi`·`RMDHeader`{啤机生产单号/开单日期/生产车间/领料备注}·`RMDLine`{原料编号/原料名称/每包重量/单位/需求数量包})。EmployeePicker 在 `web/src/pages/materials/EmployeePicker.tsx`(onPick 姓名 string)。

**与退库表关键差异**:①头 生产车间/领料备注/制单人(非部门/退料人);②明细多 `啤机外发单号` 列;③有「调入清单」(从 YLX);④前缀 YCK;⑤Menu(原料出库表)≠ Table(原料出库单)。

---

## Task 1: 建表 + 白名单 + 菜单 + DI + 前端路由

**Files:**
- Create: `db/37_raw_material_stock_issue.sql`
- Create: `db/seed_raw_material_stock_issue_perms.sql`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Modify: `src/ErpApi/Program.cs`
- Modify: `web/src/nav/menuTree.tsx:128`

- [ ] **Step 1: 建表 SQL** — 创建 `db/37_raw_material_stock_issue.sql`:

```sql
-- 原料出库单(原料仓库·生产领料出库)·头 + 明细。无价。v1 审核纯锁定不动库存(库存台账延后)。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料出库单]', N'U') IS NULL
CREATE TABLE [原料出库单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产车间] nvarchar(40) NULL,
    [日期] datetime NULL,
    [电脑单号] nvarchar(40) NULL,
    [领料备注] nvarchar(30) NULL,
    [制单人] nvarchar(30) NULL,
    [操作员] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料出库明细单]', N'U') IS NULL
CREATE TABLE [原料出库明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [啤机生产单号] nvarchar(50) NULL,
    [开单日期] datetime NULL,
    [啤机外发单号] nvarchar(50) NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 权限种子 SQL** — 创建 `db/seed_raw_material_stock_issue_perms.sql`:

```sql
-- 开发用:给 admin 授予 原料出库表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料出库表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料出库表',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 过账白名单** — 在 `src/ErpApi/Engines/Posting/PostableDocuments.cs`,把 `["原料退库表"] = "单号",` 改为:

```csharp
            ["原料退库表"] = "单号",
            ["原料出库单"] = "单号",
```

- [ ] **Step 4: MenuCatalog** — 在 `src/ErpApi/Features/Admin/MenuCatalog.cs`,把 `new("原料仓库","原料退库表"),` 改为:

```csharp
        new("原料仓库","原料退库表"),
        new("原料仓库","原料出库表"),
```

- [ ] **Step 5: DI 注册** — 在 `src/ErpApi/Program.cs` 中 `PlasticRawMaterialStockReturnService` 注册行后加:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialStockIssue.PlasticRawMaterialStockIssueService>();
```

- [ ] **Step 6: 前端菜单占位换路由** — 在 `web/src/nav/menuTree.tsx:128`,把 `M("原料出库表")` 换成 `M("原料出库表", "/plastic-raw-material-stock-issue", "原料出库表")`。该行现为:

```tsx
    M("原料出库表"), M("原料退库表", "/plastic-raw-material-stock-return", "原料退库表"), M("原料盘点单"),
```

改为:

```tsx
    M("原料出库表", "/plastic-raw-material-stock-issue", "原料出库表"), M("原料退库表", "/plastic-raw-material-stock-return", "原料退库表"), M("原料盘点单"),
```

- [ ] **Step 7: 应用 SQL 到两库** — 若 LocalDB 停止先 `SqlLocalDB start MSSQLLocalDB`(默认连接串失败时用 `SqlLocalDB info MSSQLLocalDB` 拿命名管道 `np:\\.\pipe\...` 在 PowerShell 里用 `-S` 指定):

```
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/37_raw_material_stock_issue.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp_test -i db/37_raw_material_stock_issue.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/seed_raw_material_stock_issue_perms.sql
```
验证:`sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -Q "SELECT OBJECT_ID(N'[原料出库单]'), OBJECT_ID(N'[原料出库明细单]')"` 两列非 NULL。seed 只需 dev 库 `erp`。

- [ ] **Step 8: 不要 dotnet build**(Step 5 引用的 Service 在 Task 2 才建,现编译必失败,属预期)。重读 3 个改动 C# 文件确认逗号/命名空间。

- [ ] **Step 9: Commit**

```bash
git add db/37_raw_material_stock_issue.sql db/seed_raw_material_stock_issue_perms.sql src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Features/Admin/MenuCatalog.cs src/ErpApi/Program.cs web/src/nav/menuTree.tsx
git commit -m "feat(原料出库单): 建表+过账白名单+菜单+DI+前端路由占位落地"
```

---

## Task 2: 后端 DTOs + Service

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueService.cs`

- [ ] **Step 1: DTOs** — 创建 `PlasticRawMaterialStockIssueDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

public sealed class PlasticRawMaterialStockIssueHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 生产车间 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 操作员 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueLineDto
{
    public long ID { get; set; }
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueDetailDto
{
    public PlasticRawMaterialStockIssueHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialStockIssueLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialStockIssueCreateLineDto
{
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 啤机外发单号 { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialStockIssueCreateDto
{
    public string? 生产车间 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 制单人 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialStockIssueCreateLineDto> 明细 { get; set; } = new();
}
```

- [ ] **Step 2: Service** — 创建 `PlasticRawMaterialStockIssueService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

// 原料出库单(原料仓库·生产领料出库)。无价。v1 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存;库存台账延后)。
public sealed class PlasticRawMaterialStockIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料出库单";
    public const string Prefix = "YCK";   // 原料出库单号 = YCK + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialStockIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料出库单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料出库单]([单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[备注])
VALUES(@单号,@生产车间,@日期,@电脑单号,@领料备注,@制单人,@操作员,@数量,'0',@备注)",
            new { 单号, dto.生产车间, 日期 = now, dto.电脑单号, dto.领料备注, dto.制单人, 操作员 = user, 数量 = 数量合计, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料出库明细单]([单号],[啤机生产单号],[开单日期],[啤机外发单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[数量],[备注])
VALUES(@单号,@啤机生产单号,@开单日期,@啤机外发单号,@原料编号,@原料名称,@产地,@每包重量,@单位,@数量,@备注)",
                new { 单号, l.啤机生产单号, l.开单日期, l.啤机外发单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单位, l.数量, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialStockIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料出库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [生产车间] LIKE @kw OR [制单人] LIKE @kw;
SELECT [ID],[单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[审核人],[备注]
FROM [原料出库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [生产车间] LIKE @kw OR [制单人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialStockIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialStockIssueHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialStockIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[审核人],[备注]
FROM [原料出库单] WHERE [单号]=@单号;
SELECT [ID],[啤机生产单号],[开单日期],[啤机外发单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[数量],[备注]
FROM [原料出库明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialStockIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialStockIssueLineDto>()).AsList();
        return new PlasticRawMaterialStockIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料出库单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料出库单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料出库明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料出库单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: 编译** — Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo` → 0 errors。(后端 dev server 若占 bin 锁先 `taskkill //F //IM dotnet.exe`。)

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueDtos.cs src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueService.cs
git commit -m "feat(原料出库单): 后端 DTOs + Service(YCK·数量SUM·无价·审核纯锁定)"
```

---

## Task 3: 后端 Controller(Menu≠Table·无脱敏)

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueController.cs`

- [ ] **Step 1: Controller** — 创建 `PlasticRawMaterialStockIssueController.cs`(注意 `Menu="原料出库表"`、`Table="原料出库单"`):

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-stock-issue")]
public sealed class PlasticRawMaterialStockIssueController(
    PlasticRawMaterialStockIssueService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料出库表";   // 菜单权限名(与 menuTree 占位一致)
    private const string Table = "原料出库单";  // 过账用表名
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
    public async Task<IActionResult> Create([FromBody] PlasticRawMaterialStockIssueCreateDto dto)
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

- [ ] **Step 2: 编译** — Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo` → 0 errors。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialStockIssue/PlasticRawMaterialStockIssueController.cs
git commit -m "feat(原料出库单): Controller(菜单原料出库表/表原料出库单·审核走过账·无价无脱敏)"
```

---

## Task 4: 后端测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialStockIssueServiceDbTests.cs`

- [ ] **Step 1: 写测试** — 创建 `tests/ErpApi.Tests/PlasticRawMaterialStockIssueServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialStockIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialStockIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料出库明细单] WHERE [原料编号]=N'YCK-PM'");
        c.Execute("DELETE FROM [原料出库单] WHERE [生产车间]=N'YCK测试车间'");
    }

    private static PlasticRawMaterialStockIssueCreateDto MakeDto() => new()
    {
        生产车间 = "YCK测试车间",
        领料备注 = "生产领料",
        制单人 = "王五",
        电脑单号 = "PC-YCK",
        明细 =
        {
            new() { 啤机生产单号 = "PPJ001", 开单日期 = new DateTime(2026, 7, 1), 啤机外发单号 = "WF001", 原料编号 = "YCK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 5 },
            new() { 啤机生产单号 = "PPJ001", 开单日期 = new DateTime(2026, 7, 1), 啤机外发单号 = "WF001", 原料编号 = "YCK-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单位 = "kg", 数量 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YCK", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal("YCK测试车间", d.单头!.生产车间);
            Assert.Equal("王五", d.单头!.制单人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("PPJ001", d.明细[0].啤机生产单号);
            Assert.Equal("WF001", d.明细[0].啤机外发单号);
            Assert.Equal("YCK-PM", d.明细[0].原料编号);
            Assert.Equal("台湾", d.明细[0].产地);
            Assert.Equal(25m, d.明细[0].每包重量);
            Assert.Equal(new DateTime(2026, 7, 1), d.明细[0].开单日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料出库单", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料出库单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料出库单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```

- [ ] **Step 2: 跑本文件测试** — LocalDB 停止先 `SqlLocalDB start MSSQLLocalDB`;表已存在(Task 1)。Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticRawMaterialStockIssueServiceDbTests" -nologo` → Passed! 3 tests(须真跑真过,不 skip;若 skip 报 DONE_WITH_CONCERNS)。若 FAIL 疑为 Service SQL 列错位,报 BLOCKED 附详情,勿自行改 Service。

- [ ] **Step 3: 全量后端测试** — Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo` → 全过,总数 = 之前 421 + 3 = 424(报实际计数)。

- [ ] **Step 4: Commit**

```bash
git add tests/ErpApi.Tests/PlasticRawMaterialStockIssueServiceDbTests.cs
git commit -m "test(原料出库单): create数量8/生产车间/制单人/啤机外发单号/产地/开单日期/approve/delete已审核抛错"
```

---

## Task 5: 前端 api + LineTable

**Files:**
- Create: `web/src/api/plasticRawMaterialStockIssue.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialStockIssueLineTable.tsx`

- [ ] **Step 1: api** — 创建 `web/src/api/plasticRawMaterialStockIssue.ts`:

```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface RSILine {
  id?: number;
  啤机生产单号?: string; 开单日期?: string; 啤机外发单号?: string; 原料编号?: string; 原料名称?: string;
  产地?: string; 每包重量?: number | null; 单位?: string; 数量?: number; 备注?: string;
}
export interface RSIHeader {
  id: number; 单号?: string; 生产车间?: string; 日期?: string; 电脑单号?: string;
  领料备注?: string; 制单人?: string; 操作员?: string; 数量?: number | null; 审核?: string; 审核人?: string; 备注?: string;
}
export interface RSIDetail { 单头?: RSIHeader; 明细: RSILine[] }

const enc = encodeURIComponent;
const base = "/plastic-raw-material-stock-issue";
export const plasticRawMaterialStockIssueApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<RSIHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<RSIDetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: LineTable**(啤机生产单号/开单日期/**啤机外发单号**/原料🔍带出·无价)— 创建 `web/src/pages/plastics/PlasticRawMaterialStockIssueLineTable.tsx`:

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, DatePicker, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import PlasticRawMaterialPicker from "./PlasticRawMaterialPicker";
import type { PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";
import type { RSILine } from "../../api/plasticRawMaterialStockIssue";

// 原料出库明细可编辑行:啤机生产单号|开单日期|啤机外发单号|原料编号🔍|原料名称只读|产地|每包重量|单位|数量|备注|删除。无价。
export default function PlasticRawMaterialStockIssueLineTable({ value, onChange, readOnly }: {
  value: RSILine[];
  onChange: Dispatch<SetStateAction<RSILine[]>>;
  readOnly?: boolean;
}) {
  const setLine = (i: number, patch: Partial<RSILine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticRawMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      原料编号: row.物料编号 ?? undefined, 原料名称: row.物料名称 ?? undefined,
      产地: row.产地 ?? undefined, 每包重量: row.每包重量 ?? undefined, 单位: row.单位 ?? undefined,
    });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;

  const columns: ColumnsType<RSILine> = [
    { title: "啤机生产单号", dataIndex: "啤机生产单号", width: 140, render: (_, r, i) => txt(r.啤机生产单号, s => setLine(i, { 啤机生产单号: s }), 128) },
    { title: "开单日期", dataIndex: "开单日期", width: 130, render: (_, r, i) =>
      <DatePicker style={{ width: 118 }} disabled={readOnly} value={r.开单日期 ? dayjs(r.开单日期) : undefined}
        onChange={d => setLine(i, { 开单日期: d ? d.format("YYYY-MM-DD") : undefined })} /> },
    { title: "啤机外发单号", dataIndex: "啤机外发单号", width: 140, render: (_, r, i) => txt(r.啤机外发单号, s => setLine(i, { 啤机外发单号: s }), 128) },
    { title: "原料编号", dataIndex: "原料编号", width: 150, render: (_, r, i) =>
      <Input style={{ width: 128 }} value={r.原料编号 ?? ""} disabled={readOnly} onChange={e => setLine(i, { 原料编号: e.target.value })}
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setMatPickFor(i)} />} /> },
    { title: "原料名称", dataIndex: "原料名称", width: 150, render: (v: string) => ro(v) },
    { title: "产地", dataIndex: "产地", width: 100, render: (_, r, i) => txt(r.产地, s => setLine(i, { 产地: s }), 88) },
    { title: "每包重量", dataIndex: "每包重量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.每包重量 ?? undefined} onChange={n => setLine(i, { 每包重量: n === null ? null : Number(n) })} /> },
    { title: "单位", dataIndex: "单位", width: 70, render: (_, r, i) => txt(r.单位, s => setLine(i, { 单位: s }), 58) },
    { title: "数量", dataIndex: "数量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "备注", dataIndex: "备注", width: 130, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: RSILine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: RSILine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>}
      <PlasticRawMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: 类型检查** — Run: `cd web && npx tsc --noEmit` → 0 errors。

- [ ] **Step 4: Commit**

```bash
git add web/src/api/plasticRawMaterialStockIssue.ts web/src/pages/plastics/PlasticRawMaterialStockIssueLineTable.tsx
git commit -m "feat(原料出库单): 前端 api + LineTable(啤机外发单号列/开单日期/产地·无价)"
```

---

## Task 6: 前端 Page(含调入清单)+ 路由

**Files:**
- Create: `web/src/pages/plastics/PlasticRawMaterialStockIssuePage.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Page** — 创建 `web/src/pages/plastics/PlasticRawMaterialStockIssuePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { plasticRawMaterialStockIssueApi, type RSIHeader, type RSILine } from "../../api/plasticRawMaterialStockIssue";
import { plasticRawMaterialDemandApi, type RMDHeader } from "../../api/plasticRawMaterialDemand";
import EmployeePicker from "../materials/EmployeePicker";
import PlasticRawMaterialStockIssueLineTable from "./PlasticRawMaterialStockIssueLineTable";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "原料出库表";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticRawMaterialStockIssuePage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<RSILine[]>([]);
  const [rows, setRows] = useState<RSIHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const [demandOpen, setDemandOpen] = useState(false);
  const [demands, setDemands] = useState<RMDHeader[]>([]);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticRawMaterialStockIssueApi.list(1, 50, "")).items); }
    catch { message.error("加载原料出库单失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser(), 领料备注: "生产领料" });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticRawMaterialStockIssueApi.get(单号);
      const h = d.单头 ?? {} as RSIHeader;
      form.setFieldsValue({
        生产车间: h.生产车间, 领料备注: h.领料备注, 制单人: h.制单人, 电脑单号: h.电脑单号, 备注: h.备注, 操作员: h.操作员,
        日期: h.日期?.slice(0, 10),
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开原料出库单失败"); }
  };

  // 调入清单:弹已审核原料生产需求表
  const openDemandPicker = async () => {
    try {
      const res = await plasticRawMaterialDemandApi.list(1, 50, "");
      setDemands(res.items.filter(o => o.审核 === "1"));
      setDemandOpen(true);
    } catch { message.error("加载原料生产需求表失败"); }
  };
  const pickDemand = async (单号: string) => {
    try {
      const d = await plasticRawMaterialDemandApi.get(单号);
      const h = d.单头 ?? {} as RMDHeader;
      const imported: RSILine[] = (d.明细 ?? []).map(l => ({
        啤机生产单号: h.啤机生产单号, 开单日期: h.开单日期?.slice(0, 10), 啤机外发单号: undefined,
        原料编号: l.原料编号, 原料名称: l.原料名称, 每包重量: l.每包重量 ?? undefined,
        单位: l.单位, 数量: Number(l.需求数量包 ?? 0),
      }));
      setLines(imported);
      form.setFieldsValue({ 生产车间: h.生产车间, 领料备注: h.领料备注 });
      setDemandOpen(false);
      message.success(`已调入需求表 ${单号} 的 ${imported.length} 行明细`);
    } catch { message.error("调入需求表失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.原料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效明细(原料编号+数量)"); return; }
    setSaving(true);
    try {
      await plasticRawMaterialStockIssueApi.create({ ...v, 明细: ok });
      message.success("原料出库单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);

  const listColumns: ColumnsType<RSIHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "生产车间", dataIndex: "生产车间", key: "生产车间" },
    { title: "制单人", dataIndex: "制单人", key: "制单人" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: RSIHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticRawMaterialStockIssueApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticRawMaterialStockIssueApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该原料出库单?" onConfirm={() => act(() => plasticRawMaterialStockIssueApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const demandColumns: ColumnsType<RMDHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => pickDemand(v)}>{v}</a> },
    { title: "啤机生产单号", dataIndex: "啤机生产单号", key: "啤机生产单号" },
    { title: "生产车间", dataIndex: "生产车间", key: "生产车间" },
    { title: "数量KG", dataIndex: "数量KG", key: "数量KG" },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料出库表·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`原料出库单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {!readOnly && <Button onClick={openDemandPicker}>调入清单</Button>}
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={6}><Form.Item name="生产车间" label="生产车间"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="制单人" label="制单人" rules={[{ required: true, message: "请选制单人" }]}>
              <Input readOnly placeholder="点🔍选人"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setEmpOpen(true)} />} />
            </Form.Item>
          </Col>
          <Col span={4}><Form.Item name="电脑单号" label="电脑单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="领料备注" label="领料备注">
              <Select disabled={readOnly} options={[{ value: "生产领料" }, { value: "样品领料" }, { value: "维修领料" }]} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={14}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticRawMaterialStockIssueLineTable value={lines} onChange={setLines} readOnly={readOnly} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} precision={2} />
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <EmployeePicker open={empOpen} onPick={姓名 => form.setFieldValue("制单人", 姓名)} onClose={() => setEmpOpen(false)} />

      <Modal open={demandOpen} title="选择已审核原料生产需求表调入明细" footer={null} width={680} onCancel={() => setDemandOpen(false)}>
        <Table rowKey="id" size="small" dataSource={demands} columns={demandColumns} pagination={{ pageSize: 8 }} />
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 2: App 路由** — 在 `web/src/App.tsx` 中 `PlasticRawMaterialStockReturnPage` 的 import 后加:

```tsx
import PlasticRawMaterialStockIssuePage from "./pages/plastics/PlasticRawMaterialStockIssuePage";
```

在 `<Route path="plastic-raw-material-stock-return" ...>` 行后加:

```tsx
          <Route path="plastic-raw-material-stock-issue" element={<PlasticRawMaterialStockIssuePage />} />
```

- [ ] **Step 3: 类型检查 + 前端测试** — Run: `cd web && npx tsc --noEmit && npx vitest run` → tsc 0 errors;vitest 全绿(54 passed 不变)。若 tsc 报错:核对 `RMDHeader`(啤机生产单号/开单日期/生产车间/领料备注/审核)、`RMDLine`(原料编号/原料名称/每包重量/单位/需求数量包)见 `plasticRawMaterialDemand.ts`;`EmployeePicker` 默认导出 + onPick 姓名 string;`RSIHeader`/`RSILine` 字段。只改真实类型错,汇报偏差。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/plastics/PlasticRawMaterialStockIssuePage.tsx web/src/App.tsx
git commit -m "feat(原料出库单): 录入页(生产车间/制单人EmployeePicker+调入清单从YLX)+路由"
```

---

## Task 7: Release 冒烟 + 终审 + worklog + 合并

**Files:**
- Create: `docs/worklogs/2026-07-01-raw-material-stock-issue.md`

- [ ] **Step 1: HTTP 冒烟全生命周期** — 启动后端(env `ERP_DB`·`--urls http://localhost:5000`),admin 登录取 token。**坑(沿用前几单)**:Git Bash 内联 Chinese JSON 被 shell 编码打乱 → 用 Write 写 UTF-8 payload 文件 `--data-binary @file`;nginx 代理拦 localhost → `export no_proxy=localhost,127.0.0.1`(勿用会被 glob 展开的 `--noproxy *`)。依次:
1. `POST /api/plastic-raw-material-stock-issue`(生产车间 + 制单人 + 2 行明细,数量 5/3)→ 单号 `YCK20260701001`。
2. `GET .../YCK20260701001` → 数量=8、生产车间/制单人回显、明细 2 行、啤机生产单号/开单日期/啤机外发单号/产地/每包重量回显。
3. `POST .../approve` → 204;`GET` 审核=1。
4. `GET`(列表)→ 见该单、已审核。
5. `DELETE` → 409(已审核不能删)。
6. `POST .../unapprove` → 204;`DELETE` → 204。

**调入清单**在浏览器手测:开页 → 调入清单 → 选一张已审核 YLX → 明细带入(数量=需求包·啤机生产单号/开单日期填入)+ 头带出生产车间/领料备注。冒烟后停后端、清临时文件。

- [ ] **Step 2: opus 终审** — 对全分支终审:①审核纯锁定(未建/未改 LedgerUnion)②五处列对齐(INSERT↔@参↔表列↔SELECT↔DTO·含 啤机生产单号/开单日期/啤机外发单号/产地/每包重量)③数量 SUM④无价(后端无 CanPrice、前端无价列)⑤Menu(原料出库表)≠Table(原料出库单)正确·白名单用 原料出库单/权限用 原料出库表⑥菜单/DI/种子⑦前端 EmployeePicker 制单人 + 选料带出 + DatePicker 行内 + 啤机外发单号列 + 调入清单映射(数量=需求包·啤机生产单号/开单日期从需求头·头带生产车间/领料备注)+ 门控⑧路由+类型一致⑨仅动允许文件。Expected: READY TO MERGE。

- [ ] **Step 3: worklog + MEMORY.md** — 创建 `docs/worklogs/2026-07-01-raw-material-stock-issue.md`,并在外部记忆 `C:\Users\DELL\.claude\projects\D--WebpageERP\memory\MEMORY.md`(非仓库文件·单独 Write/Edit 不 git add)加一行指针。

- [ ] **Step 4: Commit + 合并**

```bash
git add docs/worklogs/2026-07-01-raw-material-stock-issue.md docs/superpowers/plans/2026-07-01-raw-material-stock-issue.md
git commit -m "docs(worklog): 原料出库单 2026-07-01"
git checkout master && git merge --no-ff feat-raw-material-stock-issue -m "Merge branch 'feat-raw-material-stock-issue' into master"
git branch -d feat-raw-material-stock-issue
```

(分支 `feat-raw-material-stock-issue` 在执行开始时从 master 创建。)

---

## 自查(spec 覆盖 / 一致性)

- **spec 数据库**:头 12 列 + 明细 11 列 → Task 1 Step 1 全覆盖(生产车间/领料备注/制单人;啤机生产单号/开单日期/啤机外发单号/产地/每包重量)。✅
- **spec 无价**:DTO/Service 无单价金额(Task 2);Controller 无 CanPrice(Task 3);LineTable 无价列(Task 5);Page 底部仅数量合计(Task 6)。✅
- **spec 审核纯锁定**:Service 无库存写,approve 走 posting(Task 2/3);未建/未改 LedgerUnion。✅
- **spec Menu≠Table**:Controller `Menu="原料出库表"`/`Table="原料出库单"`(Task 3);白名单键 `原料出库单`(Task 1 Step 3)、菜单/种子用 `原料出库表`(Task 1 Step 2/4)。✅
- **spec 调入清单从 YLX**:Task 6 `openDemandPicker`/`pickDemand` 复用 `plasticRawMaterialDemandApi`(过滤 审核='1' → get),映射 数量=需求数量包、啤机生产单号/开单日期取自需求头 `h.啤机生产单号`/`h.开单日期`、头带 生产车间/领料备注,啤机外发单号/产地留空,零新后端。✅
- **spec 前缀 YCK / 菜单 / DI / 种子**:Task 1 + Task 2(Prefix="YCK")。✅
- **spec EmployeePicker 制单人 + DatePicker 开单日期 + 啤机外发单号列**:Task 6 EmployeePicker(onPick 姓名);Task 5 LineTable DatePicker 行内(dayjs)+ 啤机外发单号 文本列。✅
- **类型一致性**:C# `PlasticRawMaterialStockIssue*`、TS `RSI*`、api base `/plastic-raw-material-stock-issue`、路由同名、DocType/Table `原料出库单`、Menu `原料出库表`。LineTable/Page 用 `数量`。开单日期前端 string ↔ 后端 DateTime?。调入源 `RMDHeader`/`RMDLine` 字段(啤机生产单号/开单日期/生产车间/领料备注·原料编号/名称/每包重量/单位/需求数量包)均存在于 `plasticRawMaterialDemand.ts`。✅
- **占位符扫描**:无 TBD/TODO,所有代码步含完整代码。✅
