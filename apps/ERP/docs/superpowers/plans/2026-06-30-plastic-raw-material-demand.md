# 原料生产需求表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑪ 原料仓库「原料生产需求表」全屏主从录入单,审核纯锁定不动库存,镜像白件领料单去价格、换头/明细字段。

**Architecture:** 新两表 `原料生产需求表`/`原料生产需求明细单`;新 `Features/Plastics/PlasticRawMaterialDemand/`(DTOs/Service/Controller)克隆 PlasticWhitePartIssue;审核走现有 PostingEngine(加白名单)。前端克隆 白件领料单页 + 新 PlasticRawMaterialPicker。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 建表 SQL + 过账白名单 + DI

**Files:**
- Create: `db/31_plastic_raw_material_demand.sql`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs` (加白名单行)
- Modify: `src/ErpApi/Program.cs` (DI 占位行·Service 待 Task2 建)

- [ ] **Step 1: 建表 SQL**

`db/31_plastic_raw_material_demand.sql`:
```sql
-- 原料生产需求表(原料仓库·生产领料需求计划)·头 + 明细。审核纯锁定不动库存。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料生产需求表]', N'U') IS NULL
CREATE TABLE [原料生产需求表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [啤机生产单号] nvarchar(50) NULL,
    [开单日期] datetime NULL,
    [制单人] nvarchar(30) NULL,
    [领料备注] nvarchar(30) NULL,
    [生产车间] nvarchar(40) NULL,
    [操作员] nvarchar(20) NULL,
    [数量KG] decimal(18,4) NULL,
    [数量包] decimal(18,4) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料生产需求明细单]', N'U') IS NULL
CREATE TABLE [原料生产需求明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [每包重量] decimal(18,4) NULL,
    [单位] nvarchar(20) NULL,
    [需求数量KG] decimal(18,4) NULL,
    [需求数量包] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 应用 SQL 两库**

PowerShell(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,再 `SqlLocalDB info MSSQLLocalDB` 取 `np:\\.\pipe\...`):
```
sqlcmd -S "<pipe>" -d erp -i D:\WebpageERP\db\31_plastic_raw_material_demand.sql
sqlcmd -S "<pipe>" -d erp_test -i D:\WebpageERP\db\31_plastic_raw_material_demand.sql
```

- [ ] **Step 3: 过账白名单**

`PostableDocuments.cs` 在 `["白件领料单"] = "单号",` 之后加:
```csharp
            ["原料生产需求表"] = "单号",
```

- [ ] **Step 4: DI 注册(类待 Task2 建·此时不编译)**

`Program.cs` 在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticWhitePartIssue.PlasticWhitePartIssueService>();` 后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialDemand.PlasticRawMaterialDemandService>();
```
(此时 Service 类不存在,**不要编译**——Task2 后再编译。)

- [ ] **Step 5: Commit**
```bash
git add db/31_plastic_raw_material_demand.sql src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Program.cs
git commit -m "feat(原料生产需求表): 建表+过账白名单+DI"
```

---

## Task 2: 后端 DTOs + Service + Controller + 菜单/权限

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialDemand/PlasticRawMaterialDemandDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialDemand/PlasticRawMaterialDemandService.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialDemand/PlasticRawMaterialDemandController.cs`
- Create: `db/seed_plastic_raw_material_demand_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (原料仓库组加项)

- [ ] **Step 1: DTOs**

`PlasticRawMaterialDemandDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

public sealed class PlasticRawMaterialDemandHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 啤机生产单号 { get; set; }
    public DateTime? 开单日期 { get; set; }
    public string? 制单人 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 操作员 { get; set; }
    public decimal? 数量KG { get; set; }
    public decimal? 数量包 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 需求数量KG { get; set; }
    public decimal 需求数量包 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandDetailDto
{
    public PlasticRawMaterialDemandHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialDemandLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialDemandCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 每包重量 { get; set; }
    public string? 单位 { get; set; }
    public decimal 需求数量KG { get; set; }
    public decimal 需求数量包 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialDemandCreateDto
{
    public string? 啤机生产单号 { get; set; }
    public string? 制单人 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 生产车间 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialDemandCreateLineDto> 明细 { get; set; } = new();
}
```

- [ ] **Step 2: Service**

`PlasticRawMaterialDemandService.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

// 原料生产需求表(原料仓库·生产领料需求计划)。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动任何库存)。
public sealed class PlasticRawMaterialDemandService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料生产需求表";
    public const string Prefix = "YLX";   // 原料生产需求单号 = YLX + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialDemandCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料生产需求表至少要有一行明细");
        var kg = dto.明细.Sum(l => l.需求数量KG);
        var bags = dto.明细.Sum(l => l.需求数量包);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料生产需求表]([单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[备注])
VALUES(@单号,@啤机生产单号,@开单日期,@制单人,@领料备注,@生产车间,@操作员,@数量KG,@数量包,'0',@备注)",
            new { 单号, dto.啤机生产单号, 开单日期 = now, dto.制单人, dto.领料备注, dto.生产车间,
                  操作员 = user, 数量KG = kg, 数量包 = bags, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料生产需求明细单]([单号],[原料编号],[原料名称],[每包重量],[单位],[需求数量KG],[需求数量包],[备注])
VALUES(@单号,@原料编号,@原料名称,@每包重量,@单位,@需求数量KG,@需求数量包,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.每包重量, l.单位, l.需求数量KG, l.需求数量包, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialDemandHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料生产需求表] WHERE @kw IS NULL OR [单号] LIKE @kw OR [啤机生产单号] LIKE @kw OR [制单人] LIKE @kw;
SELECT [ID],[单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[审核人],[备注]
FROM [原料生产需求表] WHERE @kw IS NULL OR [单号] LIKE @kw OR [啤机生产单号] LIKE @kw OR [制单人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialDemandHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialDemandHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialDemandDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[审核人],[备注]
FROM [原料生产需求表] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[每包重量],[单位],[需求数量KG],[需求数量包],[备注]
FROM [原料生产需求明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialDemandHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialDemandLineDto>()).AsList();
        return new PlasticRawMaterialDemandDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料生产需求表] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料生产需求表不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料生产需求明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料生产需求表] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```
注:`PagedResult`/`IDocumentNumberGenerator.NextAsync` 用法照搬 `../PlasticWhitePartIssue/PlasticWhitePartIssueService.cs`(含 `using ErpApi.Features.MasterData;` 取 PagedResult)。

- [ ] **Step 3: Controller**

`PlasticRawMaterialDemandController.cs`(镜像 PlasticWhitePartIssueController·无价格脱敏):
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-demand")]
public sealed class PlasticRawMaterialDemandController(
    PlasticRawMaterialDemandService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料生产需求表";
    private const string Table = "原料生产需求表";
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
    public async Task<IActionResult> Create([FromBody] PlasticRawMaterialDemandCreateDto dto)
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

`MenuCatalog.cs` 的 `All` 加(原料仓库组·找 "原料仓库" 相关或就近加):
```csharp
        new("原料仓库","原料生产需求表"),
```
（若 MenuCatalog 无 "原料仓库" 既有项,新增该组首项即可·组名以 menuTree 的 "原料仓库" 为准。）

`db/seed_plastic_raw_material_demand_perms.sql`（**确认此文件名未被占用**·与既有 db/seed_*.sql 不重名）:
```sql
-- 开发用:给 admin 授予 原料生产需求表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料生产需求表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料生产需求表',1,1,1,1,1,1,1,1,1);
```
应用两库(同 Task1 命名管道)。

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug` → Build succeeded(0 错误)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialDemand/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_raw_material_demand_perms.sql
git commit -m "feat(原料生产需求表): 后端DTOs+Service+Controller+菜单权限"
```

---

## Task 3: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialDemandServiceDbTests.cs`

- [ ] **Step 1: 写测试**(镜像 PlasticWhitePartIssueServiceDbTests)

```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialDemand;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialDemandServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialDemandService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [原料编号]=N'RMD-PM'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [生产车间]=N'RMD测试车间'");
    }

    private static PlasticRawMaterialDemandCreateDto MakeDto() => new()
    {
        啤机生产单号 = "PJ-RMD",
        制单人 = "张三",
        领料备注 = "生产领料",
        生产车间 = "RMD测试车间",
        明细 =
        {
            new() { 原料编号 = "RMD-PM", 原料名称 = "ABS粒", 每包重量 = 25, 单位 = "kg", 需求数量KG = 5, 需求数量包 = 1 },
            new() { 原料编号 = "RMD-PM", 原料名称 = "ABS粒", 每包重量 = 25, 单位 = "kg", 需求数量KG = 3, 需求数量包 = 1 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_kg_and_bags()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YLX", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量KG);
            Assert.Equal(2m, d.单头!.数量包);
            Assert.Equal("张三", d.单头!.制单人);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("RMD-PM", d.明细[0].原料编号);
            Assert.Equal(5m, d.明细[0].需求数量KG);
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
            Assert.True(await engine.ApproveAsync("原料生产需求表", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料生产需求表] WHERE [单号]=@单号", new { 单号 });
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
            Assert.True(await engine.ApproveAsync("原料生产需求表", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```
注:`DbFixture`/`fx.Open()`/`PostingEngine(Factory(), new AuditLogger())` 用法以 `PlasticWhitePartIssueServiceDbTests.cs` 为准。

- [ ] **Step 2: 跑本测试** → `dotnet test ... --filter "FullyQualifiedName~PlasticRawMaterialDemand"`(3 passed)。
- [ ] **Step 3: 全量** → `dotnet test ...`(404→407)。
- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticRawMaterialDemandServiceDbTests.cs
git commit -m "test(原料生产需求表): create求和/approve/delete已审核抛错"
```

---

## Task 4: 前端 picker + api + LineTable + Page + 路由 + 菜单

**Files:**
- Create: `web/src/pages/plastics/PlasticRawMaterialPicker.tsx`
- Create: `web/src/api/plasticRawMaterialDemand.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialDemandLineTable.tsx`
- Create: `web/src/pages/plastics/PlasticRawMaterialDemandPage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:126` (`M("原料生产需求表")` → 带路由)

- [ ] **Step 1: PlasticRawMaterialPicker**(克隆 PlasticMaterialPicker over plasticRawMaterialMasterApi)

`web/src/pages/plastics/PlasticRawMaterialPicker.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Input, message, Modal, Table } from "antd";
import { plasticRawMaterialMasterApi, type PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";

// 塑胶原料选择器:可搜索 塑胶原料资料,点行返回该原料。
export default function PlasticRawMaterialPicker({ open, onPick, onClose }: {
  open: boolean;
  onPick: (row: PlasticRawMaterialRow) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticRawMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await plasticRawMaterialMasterApi.list(undefined, keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载塑胶原料列表失败"); }
    finally { setLoading(false); }
  }, [keyword]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setPage(1); load(1); } }, [open]);
  useEffect(() => { if (!open) { setKeyword(""); setPage(1); setRows([]); } }, [open]);

  const search = () => { setPage(1); load(1); };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "商品名称", dataIndex: "商品名称", width: 120 },
    { title: "单位", dataIndex: "单位", width: 60 },
  ];

  return (
    <Modal title="选择塑胶原料" open={open} onCancel={onClose} footer={null} width={820}>
      <div style={{ marginBottom: 12 }}>
        <Input.Search placeholder="物料编号/名称/规格/商品名称" allowClear style={{ width: 300 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={search} />
      </div>
      <Table size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns} scroll={{ x: true, y: 380 }}
        pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
          onChange: p => { setPage(p); load(p); }, showTotal: t => `共 ${t} 条` }}
        onRow={r => ({ onClick: () => { onPick(r); onClose(); }, style: { cursor: "pointer" } })} />
    </Modal>
  );
}
```

- [ ] **Step 2: api 客户端**

`web/src/api/plasticRawMaterialDemand.ts`:
```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface RMDLine {
  id?: number;
  原料编号?: string; 原料名称?: string; 每包重量?: number | null; 单位?: string;
  需求数量KG?: number; 需求数量包?: number; 备注?: string;
}
export interface RMDHeader {
  id: number; 单号?: string; 啤机生产单号?: string; 开单日期?: string; 制单人?: string;
  领料备注?: string; 生产车间?: string; 操作员?: string;
  数量KG?: number | null; 数量包?: number | null; 审核?: string; 审核人?: string; 备注?: string;
}
export interface RMDDetail { 单头?: RMDHeader; 明细: RMDLine[] }

const enc = encodeURIComponent;
const base = "/plastic-raw-material-demand";
export const plasticRawMaterialDemandApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<RMDHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<RMDDetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 3: LineTable**(克隆 PlasticWhitePartIssueLineTable·原料编号🔍 PlasticRawMaterialPicker)

`web/src/pages/plastics/PlasticRawMaterialDemandLineTable.tsx`:
```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import PlasticRawMaterialPicker from "./PlasticRawMaterialPicker";
import type { PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";
import type { RMDLine } from "../../api/plasticRawMaterialDemand";

// 原料生产需求明细可编辑行:原料编号🔍|原料名称只读|每包重量|单位|需求数量KG|需求数量包|备注|删除。
export default function PlasticRawMaterialDemandLineTable({ value, onChange, readOnly }: {
  value: RMDLine[];
  onChange: Dispatch<SetStateAction<RMDLine[]>>;
  readOnly?: boolean;
}) {
  const setLine = (i: number, patch: Partial<RMDLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticRawMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      原料编号: row.物料编号 ?? undefined, 原料名称: row.物料名称 ?? undefined, 单位: row.单位 ?? undefined,
    });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;

  const columns: ColumnsType<RMDLine> = [
    { title: "原料编号", dataIndex: "原料编号", width: 150, render: (_, r, i) =>
      <Input style={{ width: 128 }} value={r.原料编号 ?? ""} disabled={readOnly} onChange={e => setLine(i, { 原料编号: e.target.value })}
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setMatPickFor(i)} />} /> },
    { title: "原料名称", dataIndex: "原料名称", width: 150, render: (v: string) => ro(v) },
    { title: "每包重量", dataIndex: "每包重量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.每包重量 ?? 0} onChange={n => setLine(i, { 每包重量: Number(n ?? 0) })} /> },
    { title: "单位", dataIndex: "单位", width: 80, render: (_, r, i) => txt(r.单位, s => setLine(i, { 单位: s }), 68) },
    { title: "需求数量(KG)", dataIndex: "需求数量KG", width: 120, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 100 }} disabled={readOnly} value={r.需求数量KG ?? 0} onChange={n => setLine(i, { 需求数量KG: Number(n ?? 0) })} /> },
    { title: "需求数量(包)", dataIndex: "需求数量包", width: 120, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 100 }} disabled={readOnly} value={r.需求数量包 ?? 0} onChange={n => setLine(i, { 需求数量包: Number(n ?? 0) })} /> },
    { title: "备注", dataIndex: "备注", width: 140, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 126) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: RMDLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: RMDLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 需求数量KG: 0, 需求数量包: 0 }])}>加一行</Button>}
      <PlasticRawMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Page**(克隆 PlasticWhitePartIssuePage·头换字段·双汇总)

`web/src/pages/plastics/PlasticRawMaterialDemandPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { plasticRawMaterialDemandApi, type RMDHeader, type RMDLine } from "../../api/plasticRawMaterialDemand";
import EmployeePicker from "../materials/EmployeePicker";
import PlasticRawMaterialDemandLineTable from "./PlasticRawMaterialDemandLineTable";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "原料生产需求表";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticRawMaterialDemandPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<RMDLine[]>([]);
  const [rows, setRows] = useState<RMDHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticRawMaterialDemandApi.list(1, 50, "")).items); }
    catch { message.error("加载原料生产需求表失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 开单日期: today(), 操作员: currentUser(), 领料备注: "生产领料" });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticRawMaterialDemandApi.get(单号);
      const h = d.单头 ?? {} as RMDHeader;
      form.setFieldsValue({
        啤机生产单号: h.啤机生产单号, 制单人: h.制单人, 领料备注: h.领料备注, 生产车间: h.生产车间, 备注: h.备注,
        开单日期: h.开单日期?.slice(0, 10), 操作员: h.操作员,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开原料生产需求表失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.原料编号 && (Number(l.需求数量KG) > 0 || Number(l.需求数量包) > 0));
    if (ok.length === 0) { message.error("请至少录入一行有效明细(原料编号+需求数量)"); return; }
    setSaving(true);
    try {
      await plasticRawMaterialDemandApi.create({ ...v, 明细: ok });
      message.success("原料生产需求表已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 合计KG = lines.reduce((s, l) => s + Number(l.需求数量KG ?? 0), 0);
  const 合计包 = lines.reduce((s, l) => s + Number(l.需求数量包 ?? 0), 0);

  const listColumns: ColumnsType<RMDHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "啤机生产单号", dataIndex: "啤机生产单号", key: "啤机生产单号" },
    { title: "制单人", dataIndex: "制单人", key: "制单人" },
    { title: "生产车间", dataIndex: "生产车间", key: "生产车间" },
    { title: "数量KG", dataIndex: "数量KG", key: "数量KG" },
    { title: "数量包", dataIndex: "数量包", key: "数量包" },
    { title: "日期", dataIndex: "开单日期", key: "开单日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: RMDHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticRawMaterialDemandApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticRawMaterialDemandApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该原料生产需求表?" onConfirm={() => act(() => plasticRawMaterialDemandApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料生产需求表·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`原料生产需求表${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={6}><Form.Item name="啤机生产单号" label="啤机生产单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="开单日期" label="开单日期"><Input disabled /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="制单人" label="制单人" rules={[{ required: true, message: "请选制单人" }]}>
              <Input readOnly placeholder="点🔍选人"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setEmpOpen(true)} />} />
            </Form.Item>
          </Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="领料备注" label="领料备注">
              <Select disabled={readOnly} options={[{ value: "生产领料" }, { value: "样品领料" }, { value: "维修领料" }]} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={6}><Form.Item name="生产车间" label="生产车间"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={18}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticRawMaterialDemandLineTable value={lines} onChange={setLines} readOnly={readOnly} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="需求数量(KG)合计" value={合计KG} precision={2} />
        <Statistic title="需求数量(包)合计" value={合计包} precision={2} />
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <EmployeePicker open={empOpen} onPick={姓名 => form.setFieldValue("制单人", 姓名)} onClose={() => setEmpOpen(false)} />
    </Card>
  );
}
```

- [ ] **Step 5: 路由 + 菜单**

`App.tsx`:import `PlasticRawMaterialDemandPage`;在 plastics 录入页路由附近加 `<Route path="plastic-raw-material-demand" element={<PlasticRawMaterialDemandPage />} />`。

`menuTree.tsx` line126 `M("原料生产需求表"),` → `M("原料生产需求表", "/plastic-raw-material-demand", "原料生产需求表"),`。

- [ ] **Step 6: 类型检查 + 测试** → `cd web && npx tsc --noEmit`(0)；`npx vitest run`(54)。
- [ ] **Step 7: Commit**
```bash
git add web/src/pages/plastics/PlasticRawMaterialPicker.tsx web/src/api/plasticRawMaterialDemand.ts web/src/pages/plastics/PlasticRawMaterialDemandLineTable.tsx web/src/pages/plastics/PlasticRawMaterialDemandPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(原料生产需求表): 前端 picker+api+LineTable+录入页+路由+菜单"
```

---

## Task 5: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:登录 → POST 建(2 明细·需求KG 5+3/需求包 1+1)→ approve → GET 验 审核=1/数量KG=8/数量包=2/明细2。清理(DELETE 测试单)。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① 审核纯锁定不动任何库存(无 LedgerUnion 改动)·PostableDocuments 仅加一行;② INSERT 列与表一致·数量KG/包 SUM;③ DeleteAsync 已审核抛错;④ 前缀 YLX;⑤ 菜单/权限(**种子文件名未撞**)/DI/路由/menuTree 齐;⑥ 前端 picker 回填原料编号/名称/单位·双汇总·制单人必填·审核/删除门控;⑦ 全参数化。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-30-plastic-raw-material-demand.md`;更新 MEMORY。
