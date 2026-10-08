# 采购退仓单（采购入仓单镜像）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增采购退仓单（把已采购入仓物料退回供应商），镜像采购入仓单（两层单据+Dapper事务+审核+月结锁+脱敏+订单选择器），库存方向为减（−）。

**Architecture:** 后端镜像 `PurchaseReceipt`→`PurchaseReturn`（Service/Controller/Dtos，路由 `/api/purchase-returns`，前缀 CT），`MaterialInventoryService` 加 采购退仓(−) 分支；给 `采购退仓明细单` 加 `订单单号` 列（让复用的订单选择器留痕）。前端纯配置：`materialDocConfigs` 加 `purchase-returns`（`orderPicker:true`）+ 菜单。依据 `docs/superpowers/specs/2026-06-12-purchase-return-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test), xUnit + Xunit.SkippableFact + WebApplicationFactory, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-purchase-return`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 环境变量：`$env:ERP_DB`/`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY` = `[Environment]::GetEnvironmentVariable("名","User")`。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~PurchaseReturnServiceDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。后端测试若 ErpApi.dll 被 5000 端口 dev server 占用→先停该进程再编译。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像模板（照搬其模式）：`src/ErpApi/Features/Materials/PurchaseReceipt/`（Service/Controller/Dtos）。共享 `MaterialDocLineDto`（已含 订单单号/生产单号/款号）。测试种子 `tests/ErpApi.Tests/P3TestData.cs`（`Seed`/`Cleanup`：供应商 `P3S01`、物料 `P3M01`(单价10)/`P3M02`(单价0.5)，仓库常量 `P3TestData.仓库`="物料仓"）。
- `采购退仓单` 已在过账白名单（`PostableDocuments`，单号列「单号」），无需改白名单。

### 表结构（`db/01_rebuild_schema.sql`）
- `采购退仓单`：ID, 单号, 入仓单号, 日期, 供应商编号, 供应商名称, 仓库, 数量, 金额, 操作员, 审核, 备注（无付款方式）。
- `采购退仓明细单`：ID, 单号, 入仓单号, 生产单号, 款号, …, 日期, 供应商编号/名称, 仓库, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, 数量, 单价, 金额, 备注（**无 订单单号，Task 1 加**）。

---

## 文件结构

```
db/13_purchase_return.sql              新:采购退仓明细单 加 订单单号 列(幂等)
db/run-db.ps1                          改:加载 11/12/13
db/seed_purchase_return_perms.sql      新:admin 授权 采购退仓单

src/ErpApi/Features/Materials/PurchaseReturn/
├─ PurchaseReturnDtos.cs               新
├─ PurchaseReturnService.cs            新
└─ PurchaseReturnController.cs         新
src/ErpApi/Program.cs                  改:注册 PurchaseReturnService
src/ErpApi/Engines/Inventory/MaterialInventoryService.cs  改:加 采购退仓(−)
src/ErpApi/Features/Admin/MenuCatalog.cs 改:加 ("物料管理","采购退仓单")

tests/ErpApi.Tests/
├─ PurchaseReturnServiceDbTests.cs     新
├─ PurchaseReturnStockDbTests.cs       新:退仓扣库存
└─ PurchaseReturnApiTests.cs           新:权限/生命周期/脱敏

web/src/pages/materials/materialDocConfigs.ts  改:加 purchase-returns
web/src/nav/menuTree.tsx               改:采购退仓单→/materials/purchase-returns
```

---

## Task 1: DB 改表（加订单单号列）+ 运行脚本 + 菜单目录 + 权限种子

**Files:**
- Create: `db/13_purchase_return.sql`, `db/seed_purchase_return_perms.sql`
- Modify: `db/run-db.ps1`, `src/ErpApi/Features/Admin/MenuCatalog.cs`

- [ ] **Step 1: 写 13 脚本**

Create `db/13_purchase_return.sql`:

```sql
-- 采购退仓单复用采购入仓的订单选择器：给 采购退仓明细单 加 订单单号 列以留痕(幂等)。
SET XACT_ABORT ON;
IF COL_LENGTH(N'采购退仓明细单', N'订单单号') IS NULL
    ALTER TABLE [采购退仓明细单] ADD [订单单号] nvarchar(20) NULL;
```

- [ ] **Step 2: run-db.ps1 加载 11/12/13**

修改 `db/run-db.ps1`，把最后一行 `(Join-Path $dir "10b_p5_material_cost.sql")` 改为续上 11/12/13（补齐既有遗漏的 11/12，并加 13）：

```powershell
  (Join-Path $dir "10b_p5_material_cost.sql") `
  (Join-Path $dir "11_mo_tracking.sql") `
  (Join-Path $dir "12_purchase_order.sql") `
  (Join-Path $dir "13_purchase_return.sql")
```

- [ ] **Step 3: 在两库执行 13**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/13_purchase_return.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/13_purchase_return.sql
```
验收：`SELECT COL_LENGTH('采购退仓明细单','订单单号')` 两库都应非 NULL（=40）。

- [ ] **Step 4: 权限种子**

Create `db/seed_purchase_return_perms.sql`:

```sql
-- 开发用:给 admin 授予 采购退仓单 菜单权限。在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'采购退仓单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'采购退仓单',1,1,1,1,1,1,1,1,1);
```

在两库执行（让 admin 能用页面）：

```powershell
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_purchase_return_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_purchase_return_perms.sql
```

- [ ] **Step 5: MenuCatalog 加采购退仓单**

在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的物料管理那行，把 `new("物料管理","采购入仓单")` 之后追加 `new("物料管理","采购退仓单")`。改后该行为：

```csharp
        new("物料管理","采购订单"), new("物料管理","采购入仓单"), new("物料管理","采购退仓单"), new("物料管理","领料单"), new("物料管理","退料单"), new("物料管理","物料库存"),
```

- [ ] **Step 6: 编译确认 + 提交**

Run: `dotnet build src/ErpApi`
Expected: 成功

```powershell
git add db/13_purchase_return.sql db/run-db.ps1 db/seed_purchase_return_perms.sql src/ErpApi/Features/Admin/MenuCatalog.cs
git commit -m @'
feat(采购管理): 采购退仓单 改表(明细加订单单号列)+run-db补11/12/13+权限种子+菜单目录

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 DTO + Service + DbTest

**Files:**
- Create: `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnDtos.cs`, `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/PurchaseReturnServiceDbTests.cs`

- [ ] **Step 1: 写 DTO**

Create `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnDtos.cs`:

```csharp
using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.PurchaseReturn;

public sealed class PurchaseReturnCreateDto
{
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PurchaseReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PurchaseReturnDetailDto
{
    public PurchaseReturnHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的 DbTest**

Create `tests/ErpApi.Tests/PurchaseReturnServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static PurchaseReturnCreateDto Dto() => new()
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商", 仓库 = P3TestData.仓库,
        明细 =
        [
            new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10, 订单单号 = "PR_PO1" },
            new MaterialDocLineDto { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5m },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_totals_and_order_no()
    {
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CT", 单号);
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(1100m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购退仓明细单] WHERE [单号]=@单号", new { 单号 }));
            // 订单选择器留痕：明细 订单单号 持久化
            Assert.Equal("PR_PO1", c.ExecuteScalar<string>(
                "SELECT [订单单号] FROM [采购退仓明细单] WHERE [单号]=@单号 AND [物料编号]='P3M01'", new { 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 单号);
            Assert.Equal(1, page.Total);
            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);

            c.Execute("UPDATE [采购退仓单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [采购退仓单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购退仓明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.False(await Svc().DeleteAsync("CT不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnServiceDbTests"`
Expected: FAIL（`PurchaseReturnService` 不存在）

- [ ] **Step 4: 实现 Service**

Create `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.PurchaseReturn;

// 采购退仓单（把已采购入仓物料退回供应商）。两层：采购退仓单 + 采购退仓明细单。
// 单据不写库存余额——审核后由 MaterialInventoryService 实时聚合(采购退仓为 − 方向)。
public sealed class PurchaseReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "采购退仓单";
    public const string Prefix = "CT";   // 采购退仓单号 = CT + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PurchaseReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("采购退仓单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("采购退仓单必须指定仓库");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [采购退仓单]([单号],[入仓单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@入仓单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.入仓单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购退仓明细单]([单号],[入仓单号],[订单单号],[生产单号],[款号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@入仓单号,@订单单号,@生产单号,@款号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, dto.入仓单号, l.订单单号, l.生产单号, l.款号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PurchaseReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [采购退仓单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [入仓单号] LIKE @kw OR [供应商编号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[入仓单号],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [采购退仓单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [入仓单号] LIKE @kw OR [供应商编号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PurchaseReturnHeaderDto>()).AsList();
        return new PagedResult<PurchaseReturnHeaderDto>(items, total);
    }

    public async Task<PurchaseReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[入仓单号],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [采购退仓单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注]
FROM [采购退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PurchaseReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new PurchaseReturnDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；FK 顺序 明细→单头
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的采购退仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [采购退仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [采购退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `PurchaseOrderService` 注册行（`builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseOrder.PurchaseOrderService>();`）之后追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseReturn.PurchaseReturnService>();
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnServiceDbTests"`
Expected: PASS 3 个

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnDtos.cs src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/PurchaseReturnServiceDbTests.cs
git commit -m @'
feat(采购管理): 采购退仓单服务(单头+明细Dapper事务,前缀CT,留痕订单单号)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 后端 Controller + API 测试

**Files:**
- Create: `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnController.cs`
- Test: `tests/ErpApi.Tests/PurchaseReturnApiTests.cs`

- [ ] **Step 1: 写失败的 API 测试**

Create `tests/ErpApi.Tests/PurchaseReturnApiTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReturnApiTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    private void SeedPerms(string user,
        bool open = true, bool save = false, bool del = false,
        bool price = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'采购退仓单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,N'采购退仓单',@open,@save,@del,@price,@approve,@unapprove)",
            new { user, open, save, del, price, approve, unapprove });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static object Body() => new
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商", 仓库 = P3TestData.仓库,
        明细 = new[]
        {
            new { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10 },
            new { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5 },
        }
    };

    [SkippableFact]
    public async Task Create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("prviewer", open: true, save: false);
        var resp = await Client(app, "prviewer").PostAsJsonAsync("/api/purchase-returns", Body());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("prfull", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "prfull");
        var create = await client.PostAsJsonAsync("/api/purchase-returns", Body());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-returns/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/purchase-returns/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-returns/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/purchase-returns/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@n", new { n = 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Detail_masks_price_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("preditor", open: true, save: true, price: true);
        var editor = Client(app, "preditor");
        var create = await editor.PostAsJsonAsync("/api/purchase-returns", Body());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            SeedPerms("prnoprice", open: true, price: false);
            var viewer = Client(app, "prnoprice");
            var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/purchase-returns/{单号}");
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("单头").GetProperty("金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("明细")[0].GetProperty("单价").ValueKind);
            var d2 = await editor.GetFromJsonAsync<JsonElement>($"/api/purchase-returns/{单号}");
            Assert.Equal(10m, d2.GetProperty("明细")[0].GetProperty("单价").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购退仓单] WHERE [单号]=@n", new { n = 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnApiTests"`
Expected: FAIL（/api/purchase-returns 404）

- [ ] **Step 3: 实现 Controller**

Create `src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnController.cs`（镜像 PurchaseReceiptController）:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.PurchaseReturn;

[ApiController]
[Authorize]
[Route("api/purchase-returns")]
public sealed class PurchaseReturnController(
    PurchaseReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "采购退仓单";
    private const string Table = "采购退仓单";
    private const string 口径 = "物料";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    private static void MaskDetail(PurchaseReturnDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PurchaseReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "关联数据不存在(供应商/款号/生产单号)。" }); }
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

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnApiTests"`
Expected: PASS 3 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseReturn/PurchaseReturnController.cs tests/ErpApi.Tests/PurchaseReturnApiTests.cs
git commit -m @'
feat(采购管理): 采购退仓单REST接口(月结锁+审核过账+成本脱敏+审计)+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 库存引擎加采购退仓(−) + DbTest

**Files:**
- Modify: `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs`
- Test: `tests/ErpApi.Tests/PurchaseReturnStockDbTests.cs`

- [ ] **Step 1: 写失败的库存 DbTest**

Create `tests/ErpApi.Tests/PurchaseReturnStockDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReturnStockDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialInventoryService Svc() => new(Factory());

    // 采购入仓 100(已审核) − 采购退仓 20(已审核) = 80
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'PRT01',N'退仓料',N'规R',N'米',10)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PRTRK1',N'退仓库','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTRK1',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',100)");
        c.Execute("INSERT INTO [采购退仓单]([单号],[仓库],[审核]) VALUES(N'PRTTC1',N'退仓库','1')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTTC1',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',20)");
        // 未审核退仓 999 不计
        c.Execute("INSERT INTO [采购退仓单]([单号],[仓库],[审核]) VALUES(N'PRTTC9',N'退仓库','0')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PRTTC9',N'退仓库',N'PRT01',N'退仓料',N'规R',N'米',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'PRT01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PRTRK1'");
        c.Execute("DELETE FROM [采购退仓明细单] WHERE [物料编号]=N'PRT01'");
        c.Execute("DELETE FROM [采购退仓单] WHERE [单号] IN (N'PRTTC1',N'PRTTC9')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PRT01'");
    }

    [SkippableFact]
    public async Task PurchaseReturn_subtracts_stock_only_when_approved()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 入100 − 退20 = 80（未审核退仓 999 不计）
            Assert.Equal(80m, await Svc().StockOfAsync("PRT01", null));
            var rows = await Svc().ListAsync(仓库: "退仓库", keyword: "PRT01");
            var row = Assert.Single(rows);
            Assert.Equal(80m, row.库存数量);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnStockDbTests"`
Expected: FAIL（采购退仓未计入 → 库存=100 而非 80）

- [ ] **Step 3: 引擎加采购退仓(−)**

在 `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs` 的 `LedgerUnion` 常量末尾（领料那段之后）追加第 4 支，并更新顶部注释：

```csharp
// 算法1（物料口径）：物料库存 = 采购入仓(+) + 退料(+) − 领料(−) − 采购退仓(−)，仅审核='1'，按 物料编号×仓库 汇总。
```

`LedgerUnion` 字符串末尾（`领料明细单` 那段 `WHERE ISNULL(h.[审核],'0')='1'` 之后）追加：

```sql
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [采购退仓明细单] d JOIN [采购退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReturnStockDbTests"`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS（既有 MaterialInventoryDbTests/ProductionService 缺料计算等仍绿——新增分支只影响有采购退仓数据的物料）

```powershell
git add src/ErpApi/Engines/Inventory/MaterialInventoryService.cs tests/ErpApi.Tests/PurchaseReturnStockDbTests.cs
git commit -m @'
feat(采购管理): 物料库存引擎加采购退仓(−)分支(已审核退仓扣库存)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 前端配置 + 菜单 + 验证

**Files:**
- Modify: `web/src/pages/materials/materialDocConfigs.ts`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: materialDocConfigs 加 purchase-returns**

在 `web/src/pages/materials/materialDocConfigs.ts` 的 `MATERIAL_DOC_CONFIGS` 对象里，`material-returns` 之后追加：

```typescript
  "purchase-returns": {
    resource: "purchase-returns", menu: "采购退仓单", title: "采购退仓", orderPicker: true,
    headerFields: [
      { name: "入仓单号", label: "入仓单号" }, { name: "供应商编号", label: "供应商编号" },
      { name: "供应商名称", label: "供应商名称" }, { name: "仓库", label: "仓库", required: true },
      { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "供应商名称", label: "供应商" }, { name: "仓库", label: "仓库" }],
  },
```

- [ ] **Step 2: menuTree 接路由**

在 `web/src/nav/menuTree.tsx` 把 `M("采购退仓单")`（当前无路由）改为：

```tsx
    M("采购退仓单", "/materials/purchase-returns", "采购退仓单"),
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误）

- [ ] **Step 4: 前端单测回归**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/pages/materials/materialDocConfigs.ts web/src/nav/menuTree.tsx
git commit -m @'
feat(采购管理): 采购退仓单前端接入(materialDocConfigs配置+菜单/materials/purchase-returns,订单选择器随orderPicker启用)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173：浏览器 admin/admin123 → 仓库管理/采购管理 → 采购退仓单 → 新建：录入行点「选订单」可弹选择器；填仓库+物料+数量 → 保存 → 审核 → 到物料库存查该物料,数量应被退仓扣减。领料/退料/采购入仓 不受影响。

---

## Self-Review

- **Spec 覆盖**：改表加订单单号列+菜单目录+权限种子 → Task1；DTO/Service(前缀CT,留痕订单号) → Task2；Controller(月结锁/审核/脱敏) → Task3；库存(−) → Task4；前端配置+菜单(orderPicker) → Task5。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：`PurchaseReturnCreateDto/HeaderDto/DetailDto`(Task2) 与 Controller(Task3) 引用一致；Service 用共享 `MaterialDocLineDto`(已含订单单号)；前端配置 `purchase-returns`/menu「采购退仓单」与后端路由 `/api/purchase-returns`、权限菜单一致。✓
- **关键坑**：①Task1 先加 订单单号 列,Task2 服务才能 INSERT 该列(顺序不能反)；②run-db.ps1 顺带补了遗漏的 11/12；③库存方向 −,仅审核='1' 计入；④P3TestData 提供 供应商P3S01/物料P3M01·P3M02,服务/API 测试复用;⑤入仓单号/订单单号 无 FK(订单单号是Task1新列、入仓单号是引用串),物料编号用 P3M01/P3M02 满足物料 FK；⑥菜单路由 `/materials/purchase-returns` 走 MaterialDocRouter(:doc=purchase-returns),无需改 App.tsx。✓
- **范围**：一张镜像单据 + 库存(−) + 配置接入,聚焦。✓
