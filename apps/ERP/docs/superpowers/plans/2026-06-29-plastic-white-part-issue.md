# 白件领料单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑩ 发外加工「白件领料单」全屏主从录入单,审核纯锁定不动库存,镜像塑胶加工采购单去价格。

**Architecture:** 新 `Features/Plastics/PlasticWhitePartIssue/`(DTOs/Service/Controller)克隆 `PlasticProcessPurchaseOrder` 去价格、换头字段、明细加 `发外采购` 列;新两表 `白件领料单`/`白件领料明细单`;审核走现有 PostingEngine(加白名单)。前端克隆 PlasticProcessPurchaseOrderPage+LineTable 去价格,头用 EmployeePicker/胶箱数/卡板数/领料备注。

**Tech Stack:** .NET 8 + Dapper + SQL Server LocalDB;React 18 + TS + Vite + Ant Design v6;xUnit + Xunit.SkippableFact。

---

## Task 1: 建表 SQL + 过账白名单 + DI

**Files:**
- Create: `db/29_plastic_white_part_issue.sql`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs:26` (在 `["塑胶盘点单"]="单号",` 后加一行)
- Modify: `src/ErpApi/Program.cs:52` (PlasticProcessPurchaseOrderService 注册行后加一行)

- [ ] **Step 1: 写建表 SQL**

`db/29_plastic_white_part_issue.sql`:
```sql
-- 白件领料单(发外加工·白件半成品发外)·头 + 明细。审核纯锁定不动库存。EF 不迁移。
IF OBJECT_ID(N'[白件领料单]', N'U') IS NULL
CREATE TABLE [白件领料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [领料部门] nvarchar(40) NULL,
    [领料人] nvarchar(30) NULL,
    [胶箱数] decimal(18,4) NULL,
    [卡板数] decimal(18,4) NULL,
    [领料备注] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [电脑单号] nvarchar(30) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[白件领料明细单]', N'U') IS NULL
CREATE TABLE [白件领料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [发外采购] nvarchar(20) NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [模具编号] nvarchar(30) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [用料名称] nvarchar(40) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 应用 SQL 到 erp 和 erp_test 两库**

Run(PowerShell·若 `(localdb)\MSSQLLocalDB` 不解析改用命名管道,与既往一致):
```powershell
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db\29_plastic_white_part_issue.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp_test -i db\29_plastic_white_part_issue.sql
```
Expected: 两库各创建 `白件领料单` / `白件领料明细单`(无报错)。

- [ ] **Step 3: 过账白名单加白件领料单**

`PostableDocuments.cs` 在 `["塑胶盘点单"] = "单号",`(line 26)之后加:
```csharp
            ["白件领料单"] = "单号",
```

- [ ] **Step 4: DI 注册 Service**

`Program.cs` 在第 52 行 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticProcessPurchaseOrder.PlasticProcessPurchaseOrderService>();` 之后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticWhitePartIssue.PlasticWhitePartIssueService>();
```

- [ ] **Step 5: 编译确认(Service 尚未建会编译失败,Task 2 后再编译)**

跳过编译;本任务仅落 SQL/白名单/DI 行。提交。

- [ ] **Step 6: Commit**
```bash
git add db/29_plastic_white_part_issue.sql src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Program.cs
git commit -m "feat(白件领料单): 建表+过账白名单+DI"
```

---

## Task 2: 后端 DTOs + Service + Controller + 菜单/权限

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticWhitePartIssue/PlasticWhitePartIssueDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticWhitePartIssue/PlasticWhitePartIssueService.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticWhitePartIssue/PlasticWhitePartIssueController.cs`
- Create: `db/seed_plastic_white_part_issue_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs:19` (发外加工组 `new("发外加工","加工采购查询"),` 行加同组项)

- [ ] **Step 1: 写 DTOs**

`PlasticWhitePartIssueDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticWhitePartIssue;

public sealed class PlasticWhitePartIssueHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public decimal? 胶箱数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 操作员 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueLineDto
{
    public long ID { get; set; }
    public string? 发外采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueDetailDto
{
    public PlasticWhitePartIssueHeaderDto? 单头 { get; set; }
    public List<PlasticWhitePartIssueLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticWhitePartIssueCreateLineDto
{
    public string? 发外采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWhitePartIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public decimal? 胶箱数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticWhitePartIssueCreateLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticWhitePartIssueBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
}
```

- [ ] **Step 2: 写 Service**

`PlasticWhitePartIssueService.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticWhitePartIssue;

// 白件领料单(发外加工·白件半成品发外)。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动塑胶库存)。
// 明细按生产单号从塑胶共用物料表 BOM 调入(单位取塑胶物料资料;发外采购无源由用户录入)。
public sealed class PlasticWhitePartIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "白件领料单";
    public const string Prefix = "BJL";   // 白件领料单号 = BJL + yyyyMMdd + 3位流水

    public async Task<IReadOnlyList<PlasticWhitePartIssueBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticWhitePartIssueBasisRow>(@"
SELECT g.[生产单号], pm.[款号], p.[工模编号] AS 模具编号, p.[物料编号], p.[物料名称],
       p.[颜色], p.[用料名称], m.[单位]
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(PlasticWhitePartIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("白件领料单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [白件领料单]([单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[备注])
VALUES(@单号,@日期,@领料部门,@领料人,@胶箱数,@卡板数,@领料备注,@数量,@操作员,@电脑单号,'0',@备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.胶箱数, dto.卡板数, dto.领料备注,
                  数量 = 数量合计, 操作员 = user, dto.电脑单号, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [白件领料明细单]([单号],[发外采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[颜色],[用料名称],[单位],[数量],[备注])
VALUES(@单号,@发外采购,@生产单号,@款号,@物料编号,@模具编号,@物料名称,@颜色,@用料名称,@单位,@数量,@备注)",
                new { 单号, l.发外采购, l.生产单号, l.款号, l.物料编号, l.模具编号, l.物料名称, l.颜色,
                      l.用料名称, l.单位, l.数量, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticWhitePartIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [白件领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[审核人],[备注]
FROM [白件领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticWhitePartIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticWhitePartIssueHeaderDto>(items, total);
    }

    public async Task<PlasticWhitePartIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[审核人],[备注]
FROM [白件领料单] WHERE [单号]=@单号;
SELECT [ID],[发外采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[颜色],[用料名称],[单位],[数量],[备注]
FROM [白件领料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticWhitePartIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticWhitePartIssueLineDto>()).AsList();
        return new PlasticWhitePartIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [白件领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的白件领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [白件领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [白件领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: 写 Controller**

`PlasticWhitePartIssueController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticWhitePartIssue;

[ApiController]
[Authorize]
[Route("api/plastic-white-part-issue")]
public sealed class PlasticWhitePartIssueController(
    PlasticWhitePartIssueService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "白件领料单";
    private const string Table = "白件领料单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(生产单号)) return BadRequest(new { 消息 = "请提供生产单号。" });
        return Ok(await svc.BasisAsync(生产单号));
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
    public async Task<IActionResult> Create([FromBody] PlasticWhitePartIssueCreateDto dto)
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

- [ ] **Step 4: 菜单 + 权限种子**

`MenuCatalog.cs` 在 `new("发外加工","加工采购查询"),`(line 19)后加:
```csharp
        new("发外加工","白件领料单"),
```

`db/seed_plastic_white_part_issue_perms.sql`:
```sql
-- 开发用:给 admin 授予 白件领料单 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'白件领料单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'白件领料单',1,1,1,1,1,1,1,1,1);
```
应用到两库:
```powershell
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db\seed_plastic_white_part_issue_perms.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp_test -i db\seed_plastic_white_part_issue_perms.sql
```

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug`
Expected: Build succeeded(0 错误)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticWhitePartIssue/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_white_part_issue_perms.sql
git commit -m "feat(白件领料单): 后端DTOs+Service+Controller+菜单权限"
```

---

## Task 3: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticWhitePartIssueServiceDbTests.cs`

- [ ] **Step 1: 写测试**

`PlasticWhitePartIssueServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticWhitePartIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWhitePartIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWhitePartIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("IF NOT EXISTS(SELECT 1 FROM [款号总表] WHERE [款号]=N'K-BJ') INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K-BJ',N'白件领料测试款')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[日期],[计划数量]) VALUES(N'BJ-MO',N'K-BJ','2026-06-29',100)");
        c.Execute("INSERT INTO [生产制单货号]([生产单号],[货号]) VALUES(N'BJ-MO',N'H-BJ')");
        c.Execute("INSERT INTO [塑胶共用物料表]([塑胶货号],[工模编号],[物料编号],[物料名称],[颜色],[用料名称],[加工内容],[加工单价]) VALUES(N'H-BJ',N'GM-BJ',N'BJPM',N'白件A',N'白',N'用A',N'喷油',3)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'BJPM',N'白件A',N'个')");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [白件领料明细单] WHERE [物料编号]=N'BJPM'");
        c.Execute("DELETE h FROM [白件领料单] h WHERE [领料部门]=N'BJ测试部门'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'H-BJ'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'BJPM'");
        c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=N'BJ-MO'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'BJ-MO'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-BJ'");
    }

    private static PlasticWhitePartIssueCreateDto MakeDto() => new()
    {
        领料部门 = "BJ测试部门",
        领料人 = "张三",
        领料备注 = "生产领料",
        明细 =
        {
            new() { 发外采购 = "采购", 生产单号 = "BJ-MO", 款号 = "K-BJ", 模具编号 = "GM-BJ", 物料编号 = "BJPM", 物料名称 = "白件A", 颜色 = "白", 用料名称 = "用A", 单位 = "个", 数量 = 5 },
            new() { 发外采购 = "采购", 生产单号 = "BJ-MO", 款号 = "K-BJ", 模具编号 = "GM-BJ", 物料编号 = "BJPM", 物料名称 = "白件A", 颜色 = "白", 用料名称 = "用A", 单位 = "个", 数量 = 3 },
        }
    };

    [SkippableFact]
    public async Task Basis_brings_bom_then_Create_then_Get()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var basis = await Svc().BasisAsync("BJ-MO");
            var b = Assert.Single(basis);
            Assert.Equal("GM-BJ", b.模具编号);
            Assert.Equal("白件A", b.物料名称);
            Assert.Equal("K-BJ", b.款号);
            Assert.Equal("个", b.单位);

            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("BJL", 单号);

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal("张三", d.单头!.领料人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("BJPM", d.明细[0].物料编号);
            Assert.Equal("GM-BJ", d.明细[0].模具编号);
            Assert.Equal(5m, d.明细[0].数量);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("白件领料单", 单号, "tester"));

            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [白件领料单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("白件领料单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```

- [ ] **Step 2: 运行测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticWhitePartIssue"`
Expected: 3 passed(若 DB 不可用则 skipped,亦可)。

- [ ] **Step 3: 全量测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj`
Expected: 全绿(390→391)。

- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticWhitePartIssueServiceDbTests.cs
git commit -m "test(白件领料单): Service DB 测试(basis/create/get/approve/delete)"
```

---

## Task 4: 前端 api + LineTable + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticWhitePartIssue.ts`
- Create: `web/src/pages/plastics/PlasticWhitePartIssueLineTable.tsx`
- Create: `web/src/pages/plastics/PlasticWhitePartIssuePage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:116` (`M("白件领料单")` → 带路由)

- [ ] **Step 1: 写 api 客户端**

`web/src/api/plasticWhitePartIssue.ts`:
```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface WPILine {
  id?: number;
  发外采购?: string; 生产单号?: string; 款号?: string; 物料编号?: string; 模具编号?: string;
  物料名称?: string; 颜色?: string; 用料名称?: string; 单位?: string;
  数量?: number; 备注?: string;
}
export interface WPIHeader {
  id: number; 单号?: string; 日期?: string; 领料部门?: string; 领料人?: string;
  胶箱数?: number | null; 卡板数?: number | null; 领料备注?: string; 数量?: number | null;
  操作员?: string; 电脑单号?: string; 审核?: string; 审核人?: string; 备注?: string;
}
export interface WPIDetail { 单头?: WPIHeader; 明细: WPILine[] }
export interface WPIBasisRow {
  生产单号?: string; 款号?: string; 模具编号?: string; 物料编号?: string; 物料名称?: string;
  颜色?: string; 用料名称?: string; 单位?: string;
}

const enc = encodeURIComponent;
const base = "/plastic-white-part-issue";
export const plasticWhitePartIssueApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<WPIHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  basis: (生产单号: string) => api.get<WPIBasisRow[]>(`${base}/basis`, { params: { 生产单号 } }).then(r => r.data),
  get: (单号: string) => api.get<WPIDetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: 写明细可编辑表(克隆 PlasticProcessPurchaseOrderLineTable 去价格,加 发外采购,加 单位)**

`web/src/pages/plastics/PlasticWhitePartIssueLineTable.tsx`:
```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import PlasticMaterialPicker from "./PlasticMaterialPicker";
import ProductionPicker from "../materials/ProductionPicker";
import type { PlasticMaterialRow } from "../../api/plasticMaterialMaster";
import type { ProductionTrackingRow } from "../../api/productionReports";
import type { WPILine } from "../../api/plasticWhitePartIssue";

// 白件领料明细可编辑行(列序:发外采购|生产单号🔍|款号|模具编号|物料编号🔍|物料名称只读|颜色|用料名称|单位|数量|备注|删除)。无价格。
export default function PlasticWhitePartIssueLineTable({ value, onChange, readOnly }: {
  value: WPILine[];
  onChange: Dispatch<SetStateAction<WPILine[]>>;
  readOnly?: boolean;
}) {
  const setLine = (i: number, patch: Partial<WPILine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      物料编号: row.物料编号 ?? undefined, 物料名称: row.物料名称 ?? undefined,
      颜色: row.颜色 ?? undefined,
    });
  };
  const fillFromProduction = (row: ProductionTrackingRow) => {
    if (prodPickFor === null) return;
    setLine(prodPickFor, { 生产单号: row.生产单号 ?? undefined, 款号: row.款号 ?? undefined });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const pickCell = (val: string | undefined, on: (s: string) => void, onPick: () => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)}
      suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={onPick} />} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;

  const columns: ColumnsType<WPILine> = [
    { title: "发外采购", dataIndex: "发外采购", width: 110, render: (_, r, i) => txt(r.发外采购, s => setLine(i, { 发外采购: s }), 96) },
    { title: "生产单号", dataIndex: "生产单号", width: 150, render: (_, r, i) => pickCell(r.生产单号, s => setLine(i, { 生产单号: s }), () => setProdPickFor(i), 128) },
    { title: "款号", dataIndex: "款号", width: 124, render: (_, r, i) => pickCell(r.款号, s => setLine(i, { 款号: s }), () => setProdPickFor(i), 102) },
    { title: "模具编号", dataIndex: "模具编号", width: 120, render: (_, r, i) => txt(r.模具编号, s => setLine(i, { 模具编号: s }), 106) },
    { title: "物料编号", dataIndex: "物料编号", width: 140, render: (_, r, i) => pickCell(r.物料编号, s => setLine(i, { 物料编号: s }), () => setMatPickFor(i), 118) },
    { title: "物料名称", dataIndex: "物料名称", width: 140, render: (v: string) => ro(v) },
    { title: "颜色", dataIndex: "颜色", width: 80, render: (_, r, i) => txt(r.颜色, s => setLine(i, { 颜色: s }), 68) },
    { title: "用料名称", dataIndex: "用料名称", width: 130, render: (_, r, i) => txt(r.用料名称, s => setLine(i, { 用料名称: s }), 118) },
    { title: "单位", dataIndex: "单位", width: 80, render: (_, r, i) => txt(r.单位, s => setLine(i, { 单位: s }), 68) },
    { title: "数量", dataIndex: "数量", width: 92, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 80 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "备注", dataIndex: "备注", width: 130, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: WPILine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: WPILine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>}
      <PlasticMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
      <ProductionPicker open={prodPickFor !== null} onPick={fillFromProduction} onClose={() => setProdPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: 写录入页**

`web/src/pages/plastics/PlasticWhitePartIssuePage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { plasticWhitePartIssueApi, type WPIHeader, type WPILine } from "../../api/plasticWhitePartIssue";
import EmployeePicker from "../materials/EmployeePicker";
import ProductionPicker from "../materials/ProductionPicker";
import PlasticWhitePartIssueLineTable from "./PlasticWhitePartIssueLineTable";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "白件领料单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticWhitePartIssuePage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<WPILine[]>([]);
  const [rows, setRows] = useState<WPIHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticWhitePartIssueApi.list(1, 50, "")).items); }
    catch { message.error("加载白件领料单失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser(), 领料备注: "生产领料" });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const bringFromProduction = async (生产单号: string) => {
    if (!生产单号) return;
    try {
      const bom = await plasticWhitePartIssueApi.basis(生产单号);
      setLines(bom.map(b => ({
        发外采购: undefined, 生产单号: b.生产单号, 款号: b.款号, 模具编号: b.模具编号,
        物料编号: b.物料编号, 物料名称: b.物料名称, 颜色: b.颜色, 用料名称: b.用料名称, 单位: b.单位,
        数量: 0,
      })));
      message.success(`已调入生产单 ${生产单号} 的白件清单`);
    } catch { message.error("调入清单失败"); }
  };

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticWhitePartIssueApi.get(单号);
      const h = d.单头 ?? {} as WPIHeader;
      form.setFieldsValue({
        领料部门: h.领料部门, 领料人: h.领料人, 领料备注: h.领料备注, 备注: h.备注,
        日期: h.日期?.slice(0, 10), 操作员: h.操作员, 电脑单号: h.电脑单号,
        胶箱数: h.胶箱数, 卡板数: h.卡板数,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开白件领料单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细(物料编号+数量)"); return; }
    setSaving(true);
    try {
      await plasticWhitePartIssueApi.create({ ...v, 明细: ok });
      message.success("白件领料单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);

  const listColumns: ColumnsType<WPIHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "领料部门", dataIndex: "领料部门", key: "领料部门" },
    { title: "领料人", dataIndex: "领料人", key: "领料人" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: WPIHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticWhitePartIssueApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticWhitePartIssueApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该白件领料单?" onConfirm={() => act(() => plasticWhitePartIssueApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"白件领料单·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`白件领料单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button disabled={readOnly} onClick={() => setProdOpen(true)}>调入清单</Button>
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={5}><Form.Item name="领料部门" label="部门"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="领料人" label="领料人" rules={[{ required: true, message: "请选领料人" }]}>
              <Input readOnly placeholder="点🔍选人"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setEmpOpen(true)} />} />
            </Form.Item>
          </Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={3}><Form.Item name="电脑单号" label="电脑单号"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={3}><Form.Item name="胶箱数" label="胶箱数"><InputNumber min={0} precision={0} disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={3}><Form.Item name="卡板数" label="卡板数"><InputNumber min={0} precision={0} disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={4}>
            <Form.Item name="领料备注" label="领料备注">
              <Select disabled={readOnly} options={[{ value: "生产领料" }, { value: "样品领料" }, { value: "维修领料" }]} />
            </Form.Item>
          </Col>
          <Col span={14}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticWhitePartIssueLineTable value={lines} onChange={setLines} readOnly={readOnly} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} />
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <EmployeePicker open={empOpen}
        onPick={姓名 => form.setFieldValue("领料人", 姓名)}
        onClose={() => setEmpOpen(false)} />
      <ProductionPicker open={prodOpen} onPick={row => bringFromProduction(row.生产单号 ?? "")} onClose={() => setProdOpen(false)} />
    </Card>
  );
}
```

- [ ] **Step 4: 路由 + 菜单接线**

`web/src/App.tsx`:在其它 plastic 页 import 区加
```tsx
import PlasticWhitePartIssuePage from "./pages/plastics/PlasticWhitePartIssuePage";
```
在 `plastic-process-purchase-orders` 路由附近加:
```tsx
          <Route path="plastic-white-part-issue" element={<PlasticWhitePartIssuePage />} />
```

`web/src/nav/menuTree.tsx` 第 116 行 `M("白件领料单"),` 改为:
```tsx
    M("白件领料单", "/plastic-white-part-issue", "白件领料单"),
```

- [ ] **Step 5: 类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错误。
Run: `cd web && npx vitest run`
Expected: 54 passed。

- [ ] **Step 6: Commit**
```bash
git add web/src/api/plasticWhitePartIssue.ts web/src/pages/plastics/PlasticWhitePartIssueLineTable.tsx web/src/pages/plastics/PlasticWhitePartIssuePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(白件领料单): 前端 api+LineTable+录入页+路由+菜单"
```

---

## Task 5: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译(锁先按 PID Stop-Process)**

杀掉占用 `bin\Release\net8.0\ErpApi.dll` 的进程(解析 ".NET Host (PID)"),`dotnet build src/ErpApi/ErpApi.csproj -c Release`。

- [ ] **Step 2: 起后端 + 冒烟**

起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`(后台);
写 node axios 冒烟(`proxy:false`):登录 admin → 种 BOM(若需,或直接用既有 生产单号)→ `GET /api/plastic-white-part-issue/basis?生产单号=...` → `POST /api/plastic-white-part-issue`(建单)→ `POST /{单号}/approve` → `GET /{单号}` 验 审核=1。
Expected: SMOKE PASS。

- [ ] **Step 3: opus 终审**

dispatch opus reviewer 全分支 diff:验 ① 审核纯锁定不动 LedgerUnion;② 无价格脱漏(单据本就无价);③ basis JOIN 1:1;④ 白名单/DI/菜单/权限齐;⑤ 前端列序与截图一致、调入清单接通。READY TO MERGE 才合并。

- [ ] **Step 4: 合并 + 收尾**

`git checkout master && git merge --no-ff feat-plastic-white-part-issue`,删分支;写 worklog `docs/worklogs/2026-06-29-plastic-white-part-issue.md`;更新 MEMORY。重启后端 5000 + 前端 5173。
