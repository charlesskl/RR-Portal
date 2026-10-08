# 原料入仓单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ⑪原料仓库 新增「原料入仓单」全屏主从录入单(供应商头 + 带价明细),镜像原料采购订单,审核纯锁定不动库存,支持从已审核采购订单(YCD)调入明细。

**Architecture:** 后端新 feature 目录 `Features/Plastics/PlasticRawMaterialReceipt/`(DTOs + Service + Controller),用 Dapper 原生 SQL(无 EF 实体、无迁移)。审核走通用 `IPostingEngine`(只翻审核位,不动库存)。库存台账整体延后。前端克隆采购订单页三件(api/LineTable/Page)加 产地/每包重量 列 + 订单调入。

**Tech Stack:** ASP.NET Core 8 + Dapper + SQL Server(LocalDB);React + TypeScript + Ant Design;xUnit(后端 DbTests)+ Vitest(前端)。

**镜像源(照抄修改)**:
- SQL:`db/32_raw_material_purchase_order.sql`
- 后端:`src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseOrder/*`(DTOs/Service/Controller)
- 测试:`tests/ErpApi.Tests/PlasticRawMaterialPurchaseOrderServiceDbTests.cs`
- 前端:`web/src/api/plasticRawMaterialPurchaseOrder.ts`、`web/src/pages/plastics/PlasticRawMaterialPurchaseOrder{LineTable,Page}.tsx`

**命名对照**:DocType/表名=`原料入仓单`/`原料入仓明细单`;前缀=`YRC`;路由=`/plastic-raw-material-receipt`;api base=`/plastic-raw-material-receipt`;C# 命名空间/类前缀=`PlasticRawMaterialReceipt`;TS 类型前缀=`RMR`。

---

## Task 1: 数据库 + 白名单 + 菜单 + DI(地基)

**Files:**
- Create: `db/33_raw_material_receipt.sql`
- Create: `db/seed_raw_material_receipt_perms.sql`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs`(在 `["原料采购订单"] = "单号",` 行后加一行)
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`(在 `new("原料仓库","原料采购订单"),` 行后加一行)
- Modify: `src/ErpApi/Program.cs`(在第 56 行 PurchaseOrderService 注册后加一行)
- Modify: `web/src/nav/menuTree.tsx:127`(把占位 `M("原料入仓单")` 换成带路由三参)

- [ ] **Step 1: 建表 SQL**

创建 `db/33_raw_material_receipt.sql`:

```sql
-- 原料入仓单(原料仓库·实物入库)·头 + 明细。v1 审核纯锁定不动库存(库存台账延后)。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料入仓单]', N'U') IS NULL
CREATE TABLE [原料入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [日期] datetime NULL,
    [电脑单号] nvarchar(40) NULL,
    [订单单号] nvarchar(20) NULL,
    [单价类型] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料入仓明细单]', N'U') IS NULL
CREATE TABLE [原料入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [单价类型] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 权限种子 SQL**

创建 `db/seed_raw_material_receipt_perms.sql`:

```sql
-- 开发用:给 admin 授予 原料入仓单 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料入仓单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料入仓单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 过账白名单加一行**

在 `src/ErpApi/Engines/Posting/PostableDocuments.cs` 中,把:

```csharp
            ["原料采购订单"] = "单号",
```

改为:

```csharp
            ["原料采购订单"] = "单号",
            ["原料入仓单"] = "单号",
```

- [ ] **Step 4: MenuCatalog 加一行**

在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 中,把:

```csharp
        new("原料仓库","原料采购订单"),
```

改为:

```csharp
        new("原料仓库","原料采购订单"),
        new("原料仓库","原料入仓单"),
```

- [ ] **Step 5: DI 注册**

在 `src/ErpApi/Program.cs` 第 56 行:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder.PlasticRawMaterialPurchaseOrderService>();
```

其后加一行:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialReceipt.PlasticRawMaterialReceiptService>();
```

- [ ] **Step 6: 前端菜单占位换成路由**

在 `web/src/nav/menuTree.tsx:127`,把 `M("原料入仓单")` 换成 `M("原料入仓单", "/plastic-raw-material-receipt", "原料入仓单")`。该行原文:

```tsx
    M("原料采购进度表"), M("原料出库进度表"), M("原料入仓单"), M("原料退仓单"),
```

改为:

```tsx
    M("原料采购进度表"), M("原料出库进度表"), M("原料入仓单", "/plastic-raw-material-receipt", "原料入仓单"), M("原料退仓单"),
```

- [ ] **Step 7: 建库应用两个 SQL**

DB 用 LocalDB,库名 `erp`(开发)与 `erp_test`(测试)。新 SQL 直接用 sqlcmd 应用到两个库(若 LocalDB 停止态先 `SqlLocalDB start MSSQLLocalDB`):
```
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/33_raw_material_receipt.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp_test -i db/33_raw_material_receipt.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -d erp -i db/seed_raw_material_receipt_perms.sql
```
Expected: 无错(表创建;seed 仅需 dev 库 `erp`,1 row affected)。建表 SQL 两库都要跑(测试用 `erp_test`)。

- [ ] **Step 8: 后端编译确认地基不破坏**

Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo`
Expected: Build succeeded(此时 Program.cs 引用的 `PlasticRawMaterialReceiptService` 尚不存在会报错 —— 若报 CS0234/找不到类型,允许,Task 2 建好后再编译;**本步仅验证 SQL/白名单/菜单三处语法**。可先跳过编译,留到 Task 2 末尾统一编译)。

- [ ] **Step 9: Commit**

```bash
git add db/33_raw_material_receipt.sql db/seed_raw_material_receipt_perms.sql src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Features/Admin/MenuCatalog.cs src/ErpApi/Program.cs web/src/nav/menuTree.tsx
git commit -m "feat(原料入仓单): 建表+过账白名单+菜单+DI+前端路由占位落地"
```

---

## Task 2: 后端 DTOs + Service

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptService.cs`

- [ ] **Step 1: DTOs**

创建 `PlasticRawMaterialReceiptDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialReceipt;

public sealed class PlasticRawMaterialReceiptHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 单价类型 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialReceiptLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialReceiptDetailDto
{
    public PlasticRawMaterialReceiptHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialReceiptLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialReceiptCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 产地 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialReceiptCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 单价类型 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialReceiptCreateLineDto> 明细 { get; set; } = new();
}
```

- [ ] **Step 2: Service**

创建 `PlasticRawMaterialReceiptService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialReceipt;

// 原料入仓单(原料仓库·实物入库)。v1 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存;库存台账延后)。
public sealed class PlasticRawMaterialReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料入仓单";
    public const string Prefix = "YRC";   // 原料入仓单号 = YRC + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料入仓单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料入仓单]([单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@供应商编号,@供应商名称,@日期,@电脑单号,@订单单号,@单价类型,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.供应商编号, dto.供应商名称, 日期 = now, dto.电脑单号, dto.订单单号, dto.单价类型,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料入仓明细单]([单号],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@原料编号,@原料名称,@产地,@每包重量,@单价类型,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单价类型, l.单位, l.数量, l.单价,
                      金额 = l.数量 * (l.单价 ?? 0m), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialReceiptHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialReceiptHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料入仓单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注]
FROM [原料入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialReceiptLineDto>()).AsList();
        return new PlasticRawMaterialReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo`
Expected: Build succeeded(0 error)。

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptDtos.cs src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptService.cs
git commit -m "feat(原料入仓单): 后端 DTOs + Service(YRC·数量/金额SUM·审核纯锁定)"
```

---

## Task 3: 后端 Controller

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptController.cs`

- [ ] **Step 1: Controller**

创建 `PlasticRawMaterialReceiptController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialReceipt;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-receipt")]
public sealed class PlasticRawMaterialReceiptController(
    PlasticRawMaterialReceiptService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料入仓单";
    private const string Table = "原料入仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private Task<bool> CanPrice() => perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await CanPrice())
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await CanPrice())
        {
            if (d.单头 is not null) d.单头.金额 = null;
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticRawMaterialReceiptCreateDto dto)
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

- [ ] **Step 2: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -nologo`
Expected: Build succeeded(0 error)。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialReceipt/PlasticRawMaterialReceiptController.cs
git commit -m "feat(原料入仓单): Controller(9位授权+审核走过账引擎+带价脱敏)"
```

---

## Task 4: 后端测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialReceiptServiceDbTests.cs`

- [ ] **Step 1: 写测试(镜像 PO 测试,数量/金额/单价类型/审核/删除)**

创建 `tests/ErpApi.Tests/PlasticRawMaterialReceiptServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [原料编号]=N'YRC-PM'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [供应商名称]=N'YRC测试供应商'");
    }

    private static PlasticRawMaterialReceiptCreateDto MakeDto() => new()
    {
        供应商编号 = "S01",
        供应商名称 = "YRC测试供应商",
        单价类型 = "格式HK$/Lb",
        明细 =
        {
            new() { 原料编号 = "YRC-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单价类型 = "含税", 单位 = "kg", 数量 = 5, 单价 = 3 },
            new() { 原料编号 = "YRC-PM", 原料名称 = "ABS粒", 产地 = "台湾", 每包重量 = 25, 单价类型 = "含税", 单位 = "kg", 数量 = 3, 单价 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_and_amount()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YRC", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(24m, d.单头!.金额);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("YRC-PM", d.明细[0].原料编号);
            Assert.Equal("台湾", d.明细[0].产地);
            Assert.Equal(25m, d.明细[0].每包重量);
            Assert.Equal("含税", d.明细[0].单价类型);
            Assert.Equal(15m, d.明细[0].金额);
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
            Assert.True(await engine.ApproveAsync("原料入仓单", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料入仓单] WHERE [单号]=@单号", new { 单号 });
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
            Assert.True(await engine.ApproveAsync("原料入仓单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```

- [ ] **Step 2: 跑本文件测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticRawMaterialReceiptServiceDbTests" -nologo`
Expected: Passed! 3 个测试全过(若 LocalDB 未起,先 `SqlLocalDB start MSSQLLocalDB`)。

- [ ] **Step 3: 全量后端测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo`
Expected: Passed(总数 = 之前 412 + 3 = 415)。

- [ ] **Step 4: Commit**

```bash
git add tests/ErpApi.Tests/PlasticRawMaterialReceiptServiceDbTests.cs
git commit -m "test(原料入仓单): create数量8/金额24/产地/每包重量/approve/delete已审核抛错"
```

---

## Task 5: 前端 api + LineTable

**Files:**
- Create: `web/src/api/plasticRawMaterialReceipt.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialReceiptLineTable.tsx`

- [ ] **Step 1: api**

创建 `web/src/api/plasticRawMaterialReceipt.ts`:

```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface RMRLine {
  id?: number;
  原料编号?: string; 原料名称?: string; 产地?: string; 每包重量?: number | null; 单价类型?: string;
  单位?: string; 数量?: number; 单价?: number | null; 金额?: number | null; 备注?: string;
}
export interface RMRHeader {
  id: number; 单号?: string; 供应商编号?: string; 供应商名称?: string; 日期?: string;
  电脑单号?: string; 订单单号?: string; 单价类型?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
}
export interface RMRDetail { 单头?: RMRHeader; 明细: RMRLine[] }

const enc = encodeURIComponent;
const base = "/plastic-raw-material-receipt";
export const plasticRawMaterialReceiptApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<RMRHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<RMRDetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: LineTable(加 产地/每包重量 列,订货数量→数量)**

创建 `web/src/pages/plastics/PlasticRawMaterialReceiptLineTable.tsx`:

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Select, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import PlasticRawMaterialPicker from "./PlasticRawMaterialPicker";
import type { PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";
import type { RMRLine } from "../../api/plasticRawMaterialReceipt";

// 原料入仓明细可编辑行:原料编号🔍|原料名称只读|产地|每包重量|单价类型(下拉)|单位|数量|单价|金额|备注|删除。带价 hidePrice。
export default function PlasticRawMaterialReceiptLineTable({ value, onChange, readOnly, hidePrice }: {
  value: RMRLine[];
  onChange: Dispatch<SetStateAction<RMRLine[]>>;
  readOnly?: boolean;
  hidePrice?: boolean;
}) {
  const setLine = (i: number, patch: Partial<RMRLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticRawMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      原料编号: row.物料编号 ?? undefined, 原料名称: row.物料名称 ?? undefined,
      单位: row.单位 ?? undefined, 单价: row.单价 ?? undefined,
    });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;
  const lineAmt = (r: RMRLine) => Number(r.数量 ?? 0) * Number(r.单价 ?? 0);

  const columns: ColumnsType<RMRLine> = [
    { title: "原料编号", dataIndex: "原料编号", width: 150, render: (_, r, i) =>
      <Input style={{ width: 128 }} value={r.原料编号 ?? ""} disabled={readOnly} onChange={e => setLine(i, { 原料编号: e.target.value })}
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setMatPickFor(i)} />} /> },
    { title: "原料名称", dataIndex: "原料名称", width: 150, render: (v: string) => ro(v) },
    { title: "产地", dataIndex: "产地", width: 100, render: (_, r, i) => txt(r.产地, s => setLine(i, { 产地: s }), 88) },
    { title: "每包重量", dataIndex: "每包重量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.每包重量 ?? undefined} onChange={n => setLine(i, { 每包重量: n === null ? null : Number(n) })} /> },
    { title: "单价类型", dataIndex: "单价类型", width: 100, render: (_, r, i) =>
      <Select style={{ width: 88 }} disabled={readOnly} value={r.单价类型} onChange={v => setLine(i, { 单价类型: v })}
        options={[{ value: "含税" }, { value: "未税" }]} /> },
    { title: "单位", dataIndex: "单位", width: 70, render: (_, r, i) => txt(r.单位, s => setLine(i, { 单位: s }), 58) },
    { title: "数量", dataIndex: "数量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    ...(hidePrice ? [] : [
      { title: "单价", dataIndex: "单价", width: 100, render: (_: unknown, r: RMRLine, i: number) => <InputNumber min={0} precision={4} style={{ width: 88 }} disabled={readOnly} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
      { title: "金额", dataIndex: "_amt", width: 100, align: "right" as const, render: (_: unknown, r: RMRLine) => lineAmt(r).toFixed(2) },
    ]),
    { title: "备注", dataIndex: "备注", width: 130, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: RMRLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: RMRLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0, 单价类型: "含税" }])}>加一行</Button>}
      <PlasticRawMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: tsc 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 0 error(Page 尚未建、路由未连,本步只验证 api + LineTable 两文件类型无误;若报「未使用」放到 Task 6 一起消)。

- [ ] **Step 4: Commit**

```bash
git add web/src/api/plasticRawMaterialReceipt.ts web/src/pages/plastics/PlasticRawMaterialReceiptLineTable.tsx
git commit -m "feat(原料入仓单): 前端 api + LineTable(产地/每包重量列·数量)"
```

---

## Task 6: 前端 Page(含订单调入)+ 路由

**Files:**
- Create: `web/src/pages/plastics/PlasticRawMaterialReceiptPage.tsx`
- Modify: `web/src/App.tsx`(import + Route,镜像 PO 的 63/166 行)

- [ ] **Step 1: Page**

创建 `web/src/pages/plastics/PlasticRawMaterialReceiptPage.tsx`。相较 PO 页的差异:表头加 电脑单号/订单单号(带调入 🔍)/单价类型;订单调入用内联 Modal 复用 `plasticRawMaterialPurchaseOrderApi`;合计口径改用 `数量`。

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { plasticRawMaterialReceiptApi, type RMRHeader, type RMRLine } from "../../api/plasticRawMaterialReceipt";
import { plasticRawMaterialPurchaseOrderApi, type RMPOHeader } from "../../api/plasticRawMaterialPurchaseOrder";
import SupplierPicker from "./SupplierPicker";
import PlasticRawMaterialReceiptLineTable from "./PlasticRawMaterialReceiptLineTable";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "原料入仓单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticRawMaterialReceiptPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<RMRLine[]>([]);
  const [rows, setRows] = useState<RMRHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supOpen, setSupOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orders, setOrders] = useState<RMPOHeader[]>([]);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticRawMaterialReceiptApi.list(1, 50, "")).items); }
    catch { message.error("加载原料入仓单失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser(), 单价类型: "格式HK$/Lb" });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticRawMaterialReceiptApi.get(单号);
      const h = d.单头 ?? {} as RMRHeader;
      form.setFieldsValue({
        供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 备注: h.备注, 操作员: h.操作员,
        日期: h.日期?.slice(0, 10), 电脑单号: h.电脑单号, 订单单号: h.订单单号, 单价类型: h.单价类型,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开原料入仓单失败"); }
  };

  // 订单调入:弹已审核原料采购订单列表
  const openOrderPicker = async () => {
    try {
      const res = await plasticRawMaterialPurchaseOrderApi.list(1, 50, "");
      setOrders(res.items.filter(o => o.审核 === "1"));
      setOrderOpen(true);
    } catch { message.error("加载原料采购订单失败"); }
  };
  const pickOrder = async (单号: string) => {
    try {
      const d = await plasticRawMaterialPurchaseOrderApi.get(单号);
      const imported: RMRLine[] = (d.明细 ?? []).map(l => ({
        原料编号: l.原料编号, 原料名称: l.原料名称, 单位: l.单位, 单价类型: l.单价类型,
        数量: Number(l.订货数量 ?? 0), 单价: l.单价 ?? undefined, 备注: l.备注,
      }));
      setLines(imported);
      form.setFieldsValue({ 订单单号: 单号 });
      setOrderOpen(false);
      message.success(`已调入采购订单 ${单号} 的 ${imported.length} 行明细`);
    } catch { message.error("调入采购订单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.原料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效明细(原料编号+数量)"); return; }
    setSaving(true);
    try {
      await plasticRawMaterialReceiptApi.create({ ...v, 明细: ok });
      message.success("原料入仓单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);
  const 金额合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listColumns: ColumnsType<RMRHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "订单单号", dataIndex: "订单单号", key: "订单单号" },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: RMRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticRawMaterialReceiptApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticRawMaterialReceiptApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该原料入仓单?" onConfirm={() => act(() => plasticRawMaterialReceiptApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const orderColumns: ColumnsType<RMPOHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => pickOrder(v)}>{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "订购日期", dataIndex: "订购日期", key: "订购日期", render: (v?: string) => v?.slice(0, 10) },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料入仓单·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`原料入仓单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="供应商名称" label="供应商" rules={[{ required: true, message: "请选供应商" }]}>
              <Input readOnly placeholder="点🔍选供应商"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setSupOpen(true)} />} />
            </Form.Item>
            <Form.Item name="供应商编号" hidden><Input /></Form.Item>
          </Col>
          <Col span={3}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={4}><Form.Item name="电脑单号" label="电脑单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}>
            <Form.Item name="订单单号" label="订单单号">
              <Input readOnly placeholder="点🔍调入采购订单"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={openOrderPicker} />} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="单价类型" label="单价类型">
              <Select disabled={readOnly} options={[{ value: "格式HK$/Lb" }, { value: "格式HK$/kg" }, { value: "格式RMB/kg" }]} />
            </Form.Item>
          </Col>
          <Col span={3}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticRawMaterialReceiptLineTable value={lines} onChange={setLines} readOnly={readOnly} hidePrice={priceHidden} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} precision={2} />
        {!priceHidden && <Statistic title="金额合计" value={金额合计} precision={2} />}
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <SupplierPicker open={supOpen}
        onPick={row => form.setFieldsValue({ 供应商编号: row.供应商编号, 供应商名称: row.供应商名称 })}
        onClose={() => setSupOpen(false)} />

      <Modal open={orderOpen} title="选择已审核原料采购订单调入明细" footer={null} width={640} onCancel={() => setOrderOpen(false)}>
        <Table rowKey="id" size="small" dataSource={orders} columns={orderColumns} pagination={{ pageSize: 8 }} />
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 2: App 路由(import + Route)**

在 `web/src/App.tsx` 第 63 行 PO 的 import 后加:

```tsx
import PlasticRawMaterialReceiptPage from "./pages/plastics/PlasticRawMaterialReceiptPage";
```

在第 166 行 PO 的 Route 后加:

```tsx
          <Route path="plastic-raw-material-receipt" element={<PlasticRawMaterialReceiptPage />} />
```

- [ ] **Step 3: tsc + 前端测试**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: tsc 0 error;vitest 全绿(54 passed,数量不变)。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/plastics/PlasticRawMaterialReceiptPage.tsx web/src/App.tsx
git commit -m "feat(原料入仓单): 录入页(供应商头+订单调入+单价类型)+路由"
```

---

## Task 7: Release 冒烟 + 终审 + worklog

**Files:**
- Create: `docs/worklogs/2026-07-01-raw-material-receipt.md`

- [ ] **Step 1: 启动后端 + 前端,HTTP 冒烟全生命周期**

用 admin 登录取 token,依次:
1. `POST /api/plastic-raw-material-receipt`(供应商头 + 2 行明细,数量 5/3、单价 3)→ 得单号 `YRC20260701001`。
2. `GET /api/plastic-raw-material-receipt/YRC20260701001` → 数量=8、金额=24、明细 2 行、产地/每包重量回显、单价类型=含税。
3. `POST .../YRC20260701001/approve` → 204;再 `GET` 审核=1。
4. `GET /api/plastic-raw-material-receipt`(列表)→ 见该单、已审核。
5. `DELETE .../YRC20260701001` → 409(已审核不能删)。
6. `POST .../YRC20260701001/unapprove` → 204;再 `DELETE` → 204。

Expected: 各步状态码/数值如上。**订单调入**在浏览器手测:开页 → 订单单号🔍 → 选一张已审核 YCD → 明细自动带入。

- [ ] **Step 2: opus 终审**

对全分支做终审(参照 PO worklog 的 7 点清单):审核纯锁定(未建/未改 LedgerUnion、未改采购分析表/库存列表)/白名单仅加一行/INSERT 列与 DTO 与 SELECT 三处对齐/数量金额 SUM、明细金额=数量×单价/路由+9位授权+带价脱敏(list 头金额、get 单价+金额)/菜单+权限+DI 齐、种子文件名未撞/前端 SupplierPicker + 原料 Picker 回填 + 订单调入映射(订货数量→数量)+ 单价类型下拉 + hidePrice 隐藏单价金额列与合计 + 门控/产地、每包重量为新增手录列/全参数化、未动采购订单及其它单据。

Expected: READY TO MERGE(有问题则回对应 Task 修)。

- [ ] **Step 3: 写 worklog + 更新 MEMORY.md**

创建 `docs/worklogs/2026-07-01-raw-material-receipt.md`(做了什么/决策/执行/测试/合并/教训/下一步),并在 `MEMORY.md` 原料链路条目后加一行指针。

- [ ] **Step 4: Commit + 合并**

```bash
git add docs/worklogs/2026-07-01-raw-material-receipt.md MEMORY.md
git commit -m "docs(worklog): 原料入仓单 2026-07-01"
git checkout master && git merge --no-ff feat-raw-material-receipt -m "Merge branch 'feat-raw-material-receipt' into master"
```

(分支名 `feat-raw-material-receipt` 在执行开始时创建。)

---

## 自查(spec 覆盖 / 一致性)

- **spec 数据库**:头 14 列 + 明细 12 列 → Task 1 Step 1 全覆盖(含 产地/每包重量/日期/电脑单号/订单单号/单价类型)。✅
- **spec 后端纯锁定**:Service 无任何库存写、Controller approve 走 posting → Task 2/3。✅ **不建 LedgerUnion、不改采购分析表/库存列表** → 全计划无该改动。✅
- **spec 从 YCD 调入**:Task 6 Step 1 `openOrderPicker`/`pickOrder` 复用 `plasticRawMaterialPurchaseOrderApi`,零新后端调入端点,映射 订货数量→数量,产地/每包重量留空。✅
- **spec 带价脱敏**:Controller list 头金额、get 单价+金额 → Task 3;前端 hidePrice 列 + 金额合计隐藏 → Task 5/6。✅
- **spec 菜单/权限/DI/前缀 YRC**:Task 1(菜单/白名单/DI/种子)+ Task 2(Prefix="YRC")。✅
- **类型一致性**:C# `PlasticRawMaterialReceipt*`、TS `RMR*`、api base `/plastic-raw-material-receipt`、路由同名、DocType/Table/Menu 均 `原料入仓单` —— 各 Task 引用一致。✅ LineTable 用 `数量`(非 订货数量),Page 合计与 save 过滤均用 `数量`。✅
- **占位符扫描**:无 TBD/TODO,所有代码步含完整代码。✅
