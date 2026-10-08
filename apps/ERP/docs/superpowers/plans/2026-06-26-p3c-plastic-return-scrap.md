# 塑胶退仓(库存−)+ 塑胶报废(库存−)(塑胶模块 P3c)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照 P3a/P3b 纵切克隆两张塑胶出库单据(塑胶退仓单·STC·供应商头;塑胶报废单·SBF·报废部门/人头),接入塑胶库存 UNION 两支均 `数量*-1`,前端零新组件只加 config+路由+菜单。

**Architecture:** 每张单据「单头+物料明细」两层,Dapper 事务创建/分页/详情/删除,单号引擎生成,审核走 PostingEngine,成本保密后端剥离。单据不写库存余额——审核后由 `PlasticInventoryService` 实时 UNION 聚合。两单据均出库(−),与 P3b 退料(+)只在库存符号与单头字段不同。前端复用 P3a 建立的塑胶单据通用组件(`PlasticDocPage`/`PlasticDocConfigs`)。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,新建特性分支 `feat-plastic-return-scrap`,完成后 `--no-ff` 合并 master 并删分支。Windows PowerShell;`dotnet` 不在 PATH 时刷新:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量(shell 为空时):`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`、`$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑后端测试:仓库根 `dotnet test`;单类 `dotnet test --filter "FullyQualifiedName~PlasticReturnScrapServiceDbTests"`。前端:`npm --prefix web run test`、`npm --prefix web run build`。
- 提交规范:commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。Windows 上 git 报 LF→CRLF 警告正常。
- 镜像参考(照搬其模式):`src/ErpApi/Features/Plastics/PlasticReturn`(退料,头表 退料部门/退料人,库存+)、`PlasticReceipt`(入仓,头表 供应商,库存+)。退仓=Receipt 的供应商头 + Return 的删除/列表/库存符号;报废=Return 的部门/人头改名 报废部门/报废人。
- **P2 教训**:接审核的单据,头表必须含 `审核人/审核日期` 列,且表名进 `PostableDocuments` 白名单,否则 approve 报 500。本计划建表即含审核列、白名单同步加。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/20_plastic_return_scrap.sql` | 4 表(塑胶退仓单/明细、塑胶报废单/明细),幂等 | 新建 |
| `db/seed_plastic_return_scrap_perms.sql` | admin 授权 塑胶退仓单/塑胶报废单 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs` | 退仓 DTO(供应商头) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnService.cs` | 退仓 Dapper 事务 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnController.cs` | 退仓 REST+审核+保密 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapDtos.cs` | 报废 DTO(报废部门/人头) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapService.cs` | 报废 Dapper 事务 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapController.cs` | 报废 REST+审核+保密 | 新建 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | LedgerUnion 加 退仓−/报废− 2 支 | 改 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 白名单加 2 项 | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单加 2 项 | 改 |
| `src/ErpApi/Program.cs` | 注册 2 个 service | 改 |
| `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs` | 退仓/报废 service 测试 | 新建 |
| `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` | 加 退仓−/报废− 联动测试 | 改 |
| `web/src/pages/plastics/docs/PlasticDocConfigs.ts` | 加 2 个 config | 改 |
| `web/src/App.tsx` | 加 2 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填 塑胶退仓单/塑胶报废单 路由 | 改 |

---

## Task 1: 建表脚本 + 权限种子 + 应用到两库

**Files:**
- Create: `db/20_plastic_return_scrap.sql`, `db/seed_plastic_return_scrap_perms.sql`

- [ ] **Step 1: 写建表脚本** `db/20_plastic_return_scrap.sql`:

```sql
-- 塑胶模块 P3c:塑胶退仓单(库存−,供应商头)+ 塑胶报废单(库存−,报废部门/人头),各 头+明细。
-- 审核后由 PlasticInventoryService 实时聚合(−)。头表含审核留痕列 审核人/审核日期(P2 教训)。幂等。
IF OBJECT_ID(N'[塑胶退仓单]', N'U') IS NULL
CREATE TABLE [塑胶退仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL, [供应商名称] nvarchar(60) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶退仓明细单]', N'U') IS NULL
CREATE TABLE [塑胶退仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶报废单]', N'U') IS NULL
CREATE TABLE [塑胶报废单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [报废部门] nvarchar(30) NULL, [报废人] nvarchar(30) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶报废明细单]', N'U') IS NULL
CREATE TABLE [塑胶报废明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 写权限种子** `db/seed_plastic_return_scrap_perms.sql`:

```sql
-- 开发用:给某用户授予 塑胶退仓单 + 塑胶报废单 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶退仓单',N'塑胶报废单');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶退仓单',1,1,1,1,1,1,1,1,1),
       (@用户,N'塑胶报废单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 应用建表脚本到 ERP_DB 和 ERP_TEST_DB**

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V); if (-not $cs) { $cs = (Get-Item "env:$V").Value }
  $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  foreach ($f in "db/20_plastic_return_scrap.sql","db/seed_plastic_return_scrap_perms.sql") {
    $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path $f)); $null = $cmd.ExecuteNonQuery()
  }
  $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 4: 验证四表存在**

```powershell
$cs = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = "SELECT COUNT(*) FROM sys.tables WHERE name IN (N'塑胶退仓单',N'塑胶退仓明细单',N'塑胶报废单',N'塑胶报废明细单')"
Write-Output ("tables=" + $cmd.ExecuteScalar()); $c.Close()
```
Expected: `tables=4`。

- [ ] **Step 5: Commit**

```powershell
git add db/20_plastic_return_scrap.sql db/seed_plastic_return_scrap_perms.sql
git commit -m @'
feat(塑胶退仓报废): 建表脚本(退仓/报废 头+明细)+权限种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 塑胶退仓单 Service + DTO(供应商头,库存−)

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs`, `.../PlasticWarehouseReturnService.cs`
- Test: `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs`

- [ ] **Step 1: 写 DTO** `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticWarehouseReturn;

public sealed class PlasticWarehouseReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
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

public sealed class PlasticWarehouseReturnLineDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWarehouseReturnDetailDto
{
    public PlasticWarehouseReturnHeaderDto? 单头 { get; set; }
    public List<PlasticWarehouseReturnLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticWarehouseReturnCreateLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWarehouseReturnCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticWarehouseReturnCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的测试** Create `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs`(本任务只放退仓两个测试,报废在 Task 3 追加):

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReturnScrapServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService WhReturnSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task WarehouseReturn_Create_Get_金额_Delete_with_STC_prefix()
    {
        using var c = fx.Open();
        var 单号 = await WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            明细 = [ new PlasticWarehouseReturnCreateLineDto { 物料编号 = "STCPM01", 物料名称 = "ABS粒", 单位 = "kg", 数量 = 4, 单价 = 7 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STC", 单号);
            var d = await WhReturnSvc().GetAsync(单号);
            Assert.Equal(4m, d!.单头!.数量);
            Assert.Equal(28m, d.单头!.金额);
            Assert.Equal("宏达塑料", d.单头!.供应商名称);
            Assert.Single(d.明细);
            Assert.True(await WhReturnSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task WarehouseReturn_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => WhReturnSvc().CreateAsync(new PlasticWarehouseReturnCreateDto { 仓库 = "", 明细 = [ new PlasticWarehouseReturnCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReturnScrapServiceDbTests"`
Expected: FAIL(编译错误 PlasticWarehouseReturnService 不存在)。

- [ ] **Step 4: 写 Service** `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticWarehouseReturn;

// 塑胶退仓单(库存−,退回供应商出仓)。两层:塑胶退仓单 + 塑胶退仓明细单。审核后由 PlasticInventoryService 实时聚合(−)。
public sealed class PlasticWarehouseReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶退仓单";
    public const string Prefix = "STC";

    public async Task<string> CreateAsync(PlasticWarehouseReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶退仓单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶退仓单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色, l.仓位号, l.单位, l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticWarehouseReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticWarehouseReturnHeaderDto>()).AsList();
        return new PagedResult<PlasticWarehouseReturnHeaderDto>(items, total);
    }

    public async Task<PlasticWarehouseReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶退仓单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticWarehouseReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticWarehouseReturnLineDto>()).AsList();
        return new PlasticWarehouseReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶退仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶退仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReturnScrapServiceDbTests"`
Expected: PASS 2 个。

- [ ] **Step 6: Commit**

```powershell
git add src/ErpApi/Features/Plastics/PlasticWarehouseReturn tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs
git commit -m @'
feat(塑胶退仓报废): 塑胶退仓单 service+DTO(STC·供应商头·库存−)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 塑胶报废单 Service + DTO(报废部门/人头,库存−)

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapDtos.cs`, `.../PlasticScrapService.cs`
- Modify(追加测试): `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs`

- [ ] **Step 1: 写 DTO** `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticScrap;

public sealed class PlasticScrapHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticScrapLineDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticScrapDetailDto
{
    public PlasticScrapHeaderDto? 单头 { get; set; }
    public List<PlasticScrapLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticScrapCreateLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticScrapCreateDto
{
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticScrapCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 追加失败测试** 在 `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs` 顶部 using 区加 `using ErpApi.Features.Plastics.PlasticScrap;`,在类内(`WhReturnSvc()` 之后)加字段与两个测试方法:

```csharp
    private PlasticScrapService ScrapSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Scrap_Create_Get_金额_Delete_with_SBF_prefix()
    {
        using var c = fx.Open();
        var 单号 = await ScrapSvc().CreateAsync(new PlasticScrapCreateDto
        {
            报废部门 = "注塑车间", 报废人 = "王五", 仓库 = "塑胶仓",
            明细 = [ new PlasticScrapCreateLineDto { 物料编号 = "SBFPM01", 物料名称 = "PP粒", 单位 = "kg", 数量 = 5, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SBF", 单号);
            var d = await ScrapSvc().GetAsync(单号);
            Assert.Equal(5m, d!.单头!.数量);
            Assert.Equal(30m, d.单头!.金额);
            Assert.Equal("王五", d.单头!.报废人);
            Assert.Single(d.明细);
            Assert.True(await ScrapSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶报废明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶报废单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Scrap_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => ScrapSvc().CreateAsync(new PlasticScrapCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => ScrapSvc().CreateAsync(new PlasticScrapCreateDto { 仓库 = "", 明细 = [ new PlasticScrapCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReturnScrapServiceDbTests"`
Expected: FAIL(编译错误 PlasticScrapService 不存在)。

- [ ] **Step 4: 写 Service** `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticScrap;

// 塑胶报废单(库存−)。两层:塑胶报废单 + 塑胶报废明细单。审核后由 PlasticInventoryService 实时聚合(−)。
public sealed class PlasticScrapService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶报废单";
    public const string Prefix = "SBF";

    public async Task<string> CreateAsync(PlasticScrapCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶报废单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶报废单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶报废单]([单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@报废部门,@报废人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.报废部门, dto.报废人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶报废明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色, l.仓位号, l.单位, l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticScrapHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶报废单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [报废人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶报废单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [报废人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticScrapHeaderDto>()).AsList();
        return new PagedResult<PlasticScrapHeaderDto>(items, total);
    }

    public async Task<PlasticScrapDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶报废单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶报废明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticScrapHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticScrapLineDto>()).AsList();
        return new PlasticScrapDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶报废单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶报废单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶报废明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶报废单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReturnScrapServiceDbTests"`
Expected: PASS 4 个(退仓 2 + 报废 2)。

- [ ] **Step 6: Commit**

```powershell
git add src/ErpApi/Features/Plastics/PlasticScrap tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs
git commit -m @'
feat(塑胶退仓报废): 塑胶报废单 service+DTO(SBF·报废部门人头·库存−)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 两 Controller + 注册 + 过账白名单 + 菜单目录 + 库存联动

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnController.cs`, `.../PlasticScrap/PlasticScrapController.cs`
- Modify: `src/ErpApi/Program.cs`, `src/ErpApi/Engines/Posting/PostableDocuments.cs`, `src/ErpApi/Features/Admin/MenuCatalog.cs`, `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`
- Test: `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs`

- [ ] **Step 1: 写退仓 Controller** `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticWarehouseReturn;

[ApiController]
[Authorize]
[Route("api/plastic-warehouse-returns")]
public sealed class PlasticWarehouseReturnController(
    PlasticWarehouseReturnService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶退仓单";
    private const string Table = "塑胶退仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价)) foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) { if (d.单头 is not null) d.单头.金额 = null; foreach (var l in d.明细) { l.单价 = null; l.金额 = null; } }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticWarehouseReturnCreateDto dto)
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

- [ ] **Step 2: 写报废 Controller** `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticScrap;

[ApiController]
[Authorize]
[Route("api/plastic-scraps")]
public sealed class PlasticScrapController(
    PlasticScrapService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶报废单";
    private const string Table = "塑胶报废单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价)) foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) { if (d.单头 is not null) d.单头.金额 = null; foreach (var l in d.明细) { l.单价 = null; l.金额 = null; } }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticScrapCreateDto dto)
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

- [ ] **Step 3: Program.cs 注册** 在 `src/ErpApi/Program.cs` 现有 `PlasticReturnService` 注册行(`AddScoped<...PlasticReturn.PlasticReturnService>();`)之后追加:

```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticWarehouseReturn.PlasticWarehouseReturnService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticScrap.PlasticScrapService>();
```

- [ ] **Step 4: 过账白名单** 在 `src/ErpApi/Engines/Posting/PostableDocuments.cs` 的 `["塑胶退料单"] = "单号",` 之后追加:

```csharp
            ["塑胶退仓单"] = "单号",
            ["塑胶报废单"] = "单号",
```

- [ ] **Step 5: 菜单目录** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶仓储","塑胶退料单"),` 之后追加:

```csharp
        new("塑胶仓储","塑胶退仓单"),
        new("塑胶仓储","塑胶报废单"),
```

- [ ] **Step 6: 库存 LedgerUnion 加两支(−)** 在 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` 的 `LedgerUnion` 常量末尾(塑胶退料明细单那段之后)追加两段 UNION,并更新顶部注释。

把 `LedgerUnion` 常量改为(在原退料段后追加退仓、报废两段):

```csharp
    private const string LedgerUnion = @"
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";
```

并把该常量上方注释改为:

```csharp
// 塑胶库存(口径=塑胶):入仓(+) / 领料(−) / 退料(+) / 退仓(−) / 报废(−) [后续阶段加 盘点±]。仅审核='1',按 物料编号×仓库 汇总。
```

- [ ] **Step 7: 加库存联动测试** 在 `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` 的 `Issue_minus_and_Return_plus_after_approve` 测试方法之后(类闭合 `}` 之前)追加:

```csharp
    [SkippableFact]
    public async Task WarehouseReturn_minus_and_Scrap_minus_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRWS01'");
            c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶退仓单] WHERE [单号]=N'STCWS01'");
            c.Execute("DELETE FROM [塑胶报废明细单] WHERE [物料编号]=N'SWSPM01'; DELETE FROM [塑胶报废单] WHERE [单号]=N'SBFWS01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRWS01',N'塑胶仓',N'SWSPM01',100)");
        c.Execute("INSERT INTO [塑胶退仓单]([单号],[仓库],[审核]) VALUES(N'STCWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶退仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'STCWS01',N'塑胶仓',N'SWSPM01',20)");
        c.Execute("INSERT INTO [塑胶报废单]([单号],[仓库],[审核]) VALUES(N'SBFWS01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶报废明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SBFWS01',N'塑胶仓',N'SWSPM01',10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRWS01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SWSPM01", null));
            await engine.ApproveAsync("塑胶退仓单", "STCWS01", "t");
            Assert.Equal(80m, await Svc().StockOfAsync("SWSPM01", null));
            await engine.ApproveAsync("塑胶报废单", "SBFWS01", "t");
            Assert.Equal(70m, await Svc().StockOfAsync("SWSPM01", null));
        }
        finally { Clean(); }
    }
```

- [ ] **Step 8: 跑库存测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticInventoryServiceDbTests"`
Expected: PASS 3 个(原 2 + 新 1)。新测试证明退仓/报废两 − 支与审核过账正确(100→80→70)。

- [ ] **Step 9: 全量后端回归**

Run: `dotnet test`
Expected: 全部 PASS(后端 347 → 约 351)。

- [ ] **Step 10: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs
git commit -m @'
feat(塑胶退仓报废): 两Controller+DI注册+过账白名单+菜单+库存LedgerUnion两支(−)+联动测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 前端 config + 路由 + 菜单(零新组件)

复用 P3a 塑胶单据通用组件。只改 3 个文件。

**Files:**
- Modify: `web/src/pages/plastics/docs/PlasticDocConfigs.ts`, `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: 加两个 config** 在 `web/src/pages/plastics/docs/PlasticDocConfigs.ts` 的 `PLASTIC_DOC_CONFIGS` 对象内,`"plastic-returns"` config 之后追加:

```typescript
  "plastic-warehouse-returns": {
    resource: "plastic-warehouse-returns", menu: "塑胶退仓单", title: "塑胶退仓",
    headerFields: [
      { name: "供应商编号", label: "供应商编号" }, { name: "供应商名称", label: "供应商名称" },
      { name: "仓库", label: "仓库", required: true }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "供应商名称", label: "供应商" }, { name: "仓库", label: "仓库" }],
  },
  "plastic-scraps": {
    resource: "plastic-scraps", menu: "塑胶报废单", title: "塑胶报废",
    headerFields: [
      { name: "报废部门", label: "报废部门" }, { name: "报废人", label: "报废人" },
      { name: "仓库", label: "仓库", required: true }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "报废人", label: "报废人" }, { name: "仓库", label: "仓库" }],
  },
```

- [ ] **Step 2: 加两条路由** 在 `web/src/App.tsx` 的 `plastic-returns` 路由行之后追加:

```tsx
          <Route path="plastic-warehouse-returns" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-warehouse-returns"]} />} />
          <Route path="plastic-scraps" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-scraps"]} />} />
```

- [ ] **Step 3: 填菜单路由** 在 `web/src/nav/menuTree.tsx` 的 ⑧ 塑胶仓库组:把 `M("塑胶退仓单")` 改为 `M("塑胶退仓单", "/plastic-warehouse-returns", "塑胶退仓单")`,把 `M("塑胶报废单")` 改为 `M("塑胶报废单", "/plastic-scraps", "塑胶报废单")`。

改后第 100–101 行附近应为:

```tsx
    M("塑胶入仓单", "/plastic-receipts", "塑胶入仓单"), M("塑胶退仓单", "/plastic-warehouse-returns", "塑胶退仓单"), M("塑胶领料单", "/plastic-issues", "塑胶领料单"), M("塑胶退料单", "/plastic-returns", "塑胶退料单"),
    M("塑胶报废单", "/plastic-scraps", "塑胶报废单"), M("塑胶盘点单"),
```

- [ ] **Step 4: 前端测试 + 类型检查 + 构建**

Run: `npm --prefix web run test`
Expected: PASS(54,无回归)。

Run: `npm --prefix web run build`
Expected: tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/pages/plastics/docs/PlasticDocConfigs.ts web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶退仓报废): 前端config+路由+菜单(复用塑胶单据通用组件,零新组件)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 冒烟联动 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟库存联动(本地 API)**

启动后端(`dotnet run --project src/ErpApi`,端口 5000),用 .NET HttpClient(`UseProxy=false`)或 Node axios(不走系统代理)脚本以 admin 登录,验证全链:
1. 建塑胶入仓单 100 → approve;
2. 建塑胶退仓单(STC,供应商头)20 → approve;
3. 建塑胶报废单(SBF,报废部门/人头)10 → approve;
4. `GET /api/plastic-inventory?keyword=<物料编号>` → 库存数量 = 70。
确认 STC/SBF 单号前缀、审核即过账、符号正确。

Expected: 入仓100 → 退仓80 → 报废70,库存查询返回 70。

- [ ] **Step 2: opus 全分支终审**

派 opus 子代理对 `feat-plastic-return-scrap` 全分支 diff 终审:确认退仓只用退仓表/报废只用报废表(无交叉污染)、前缀 STC/SBF 正确、两支库存符号均 −、白名单/审核列/菜单/DI 齐全、前端 config 字段与后端 DTO 一致。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-return-scrap -m @'
Merge branch 'feat-plastic-return-scrap' into master

塑胶退仓(STC·库存−)+塑胶报废(SBF·库存−)P3c

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-return-scrap
```

- [ ] **Step 4: 写 worklog** Create `docs/worklogs/2026-06-26-plastic-return-scrap.md`,记录:做了什么(退仓 STC/报废 SBF 两出库单据·库存 UNION 加 2 支 −)、执行(subagent-driven + opus 终审)、测试(后端约 351 / 前端 54)、冒烟(100→80→70)、合并 commit、下一步(P3d 塑胶盘点 盈亏±)。

- [ ] **Step 5: 更新 MEMORY.md** 在 `erp-plastic-module-p0-0625.md` 索引行追加 P3c 摘要,下一步改为「P3d 塑胶盘点」。Commit worklog + 记忆。

```powershell
git add docs/worklogs/2026-06-26-plastic-return-scrap.md
git commit -m @'
docs(worklog): 塑胶退仓+塑胶报废 P3c 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:退仓(STC·供应商头·−)=Task 2;报废(SBF·报废部门人头·−)=Task 3;库存两支=Task 4 Step 6;白名单/菜单/DI=Task 4;前端 config/路由/菜单=Task 5;测试=Task 2/3/4;冒烟/终审/合并/worklog=Task 6。无遗漏。
- **类型一致**:DTO 类名 `PlasticWarehouseReturnCreateDto`/`...CreateLineDto`/`...HeaderDto`/`...LineDto`/`...DetailDto` 与 Service/Controller/测试引用一致;报废同理 `PlasticScrap*`。Service 方法 `CreateAsync/ListAsync/GetAsync/DeleteAsync` 与 Controller 调用一致。
- **无占位**:每步含完整代码/命令/预期。
- **符号正确**:退仓/报废库存均 `数量*-1`(出库),与 P3b 退料(+)区分。
- **前缀**:退仓 STC、报废 SBF,与 DocType 常量、测试 `Assert.StartsWith` 一致。
