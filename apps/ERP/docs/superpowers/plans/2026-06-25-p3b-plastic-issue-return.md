# 塑胶领料 + 塑胶退料(P3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建塑胶领料单(库存−·SLL)+ 塑胶退料单(库存+·STL),克隆 P3a 塑胶入仓;库存引擎加 2 支;前端加 2 个 config(零新组件)。

**Architecture:** 每单据 = 头+明细表 + service(create/get/list/delete)+ controller(+IPostingEngine)+ 白名单 + 审核日期列 + DI。库存引擎 `PlasticInventoryService.LedgerUnion` 追加 领料(−)/退料(+) 两支。前端复用 P3a 塑胶单据通用组件(PlasticDocPage),仅加 config + 路由 + 菜单。

**Tech Stack:** .NET 8 / Dapper / ASP.NET · React+TS+AntD · SQL Server。

**设计依据:** `docs/superpowers/specs/2026-06-25-p3b-plastic-issue-return-design.md`。镜像源:`src/ErpApi/Features/Plastics/PlasticReceipt/*`(P3a)、`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`、`web/.../plastics/docs/PlasticDocConfigs.ts`。

---

## 文件结构

| 文件 | 职责 | 新建/改 |
|---|---|---|
| `db/19_plastic_issue_return.sql` | 4 表(领料/退料 头+明细) | 新建 |
| `db/seed_plastic_issue_return_perms.sql` | admin 9 位(塑胶领料单/塑胶退料单) | 新建 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 加 2 白名单项 | 改 |
| `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs` + `PlasticIssueService.cs` + `PlasticIssueController.cs` | 领料 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnDtos.cs` + `PlasticReturnService.cs` + `PlasticReturnController.cs` | 退料 | 新建 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | LedgerUnion 加 2 支 | 改 |
| `src/ErpApi/Program.cs` | 注册 2 service | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单 2 项 | 改 |
| `tests/ErpApi.Tests/PlasticIssueReturnServiceDbTests.cs` | 领料/退料 service 测试 | 新建 |
| `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` | 加 领料−/退料+ 联动测试 | 改 |
| `web/src/pages/plastics/docs/PlasticDocConfigs.ts` | 加 2 config | 改 |
| `web/src/App.tsx` | 加 2 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 菜单落地 | 改 |

---

### Task 1: 建 4 表 + 分支

**Files:** Create `db/19_plastic_issue_return.sql`

- [ ] **Step 0: 建分支** — `cd /d/WebpageERP && git checkout master && git checkout -b feat-plastic-issue-return`

- [ ] **Step 1: 写建表脚本** `db/19_plastic_issue_return.sql`:
```sql
-- 塑胶模块 P3b:塑胶领料单(库存−)+ 塑胶退料单(库存+),各 头+明细。审核后由 PlasticInventoryService 实时聚合。
IF OBJECT_ID(N'[塑胶领料单]', N'U') IS NULL
CREATE TABLE [塑胶领料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [领料部门] nvarchar(30) NULL, [领料人] nvarchar(30) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶领料明细单]', N'U') IS NULL
CREATE TABLE [塑胶领料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶退料单]', N'U') IS NULL
CREATE TABLE [塑胶退料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [退料部门] nvarchar(30) NULL, [退料人] nvarchar(30) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶退料明细单]', N'U') IS NULL
CREATE TABLE [塑胶退料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 两库执行**
```bash
cd /d/WebpageERP
for V in ERP_TEST_DB ERP_DB; do \
  powershell -NoProfile -Command "\$cs=\$env:$V; \$c=New-Object System.Data.SqlClient.SqlConnection \$cs; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/19_plastic_issue_return.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output '$V ok'"; \
done
```
Expected: 两个 `ok`。

- [ ] **Step 3: 验证** — `powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_TEST_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (N'塑胶领料单',N'塑胶领料明细单',N'塑胶退料单',N'塑胶退料明细单')\"; \$cmd.ExecuteScalar(); \$c.Close()"` → Expected `4`

- [ ] **Step 4: Commit** — `git add db/19_plastic_issue_return.sql && git commit -m "feat(塑胶领料退料): 建表脚本(领料/退料 头+明细)"`

---

### Task 2: 白名单 + DTOs

**Files:** Modify `PostableDocuments.cs`; Create `PlasticIssueDtos.cs`, `PlasticReturnDtos.cs`

- [ ] **Step 1: 白名单** — `src/ErpApi/Engines/Posting/PostableDocuments.cs`,在 `["塑胶入仓单"] = "单号",`(P3a 加的)之后加:
```csharp
            ["塑胶领料单"] = "单号",
            ["塑胶退料单"] = "单号",
```

- [ ] **Step 2: 领料 DTOs** `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticIssue;

public sealed class PlasticIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticIssueLineDto
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

public sealed class PlasticIssueDetailDto
{
    public PlasticIssueHeaderDto? 单头 { get; set; }
    public List<PlasticIssueLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticIssueCreateLineDto
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

public sealed class PlasticIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticIssueCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 3: 退料 DTOs** `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnDtos.cs` — 同领料,把 namespace 改 `ErpApi.Features.Plastics.PlasticReturn`、类名 `PlasticIssue*`→`PlasticReturn*`、头字段 `领料部门/领料人`→`退料部门/退料人`:
```csharp
namespace ErpApi.Features.Plastics.PlasticReturn;

public sealed class PlasticReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticReturnLineDto
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

public sealed class PlasticReturnDetailDto
{
    public PlasticReturnHeaderDto? 单头 { get; set; }
    public List<PlasticReturnLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReturnCreateLineDto
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

public sealed class PlasticReturnCreateDto
{
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticReturnCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 4: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4` (Expected: 0 错误)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnDtos.cs && git commit -m "feat(塑胶领料退料): 白名单+DTOs"`

---

### Task 3: 领料/退料 service · TDD

**Files:** Create `PlasticIssueService.cs`, `PlasticReturnService.cs`; Test `tests/ErpApi.Tests/PlasticIssueReturnServiceDbTests.cs`

- [ ] **Step 1: 写失败测试** `tests/ErpApi.Tests/PlasticIssueReturnServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticIssue;
using ErpApi.Features.Plastics.PlasticReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticIssueReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticIssueService IssueSvc() => new(Factory(), new DocumentNumberGenerator());
    private PlasticReturnService ReturnSvc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Issue_Create_Get_金额_Delete()
    {
        using var c = fx.Open();
        var 单号 = await IssueSvc().CreateAsync(new PlasticIssueCreateDto
        {
            领料部门 = "注塑车间", 领料人 = "张三", 仓库 = "塑胶仓",
            明细 = [ new PlasticIssueCreateLineDto { 物料编号 = "SLLPM01", 物料名称 = "ABS粒", 单位 = "kg", 数量 = 8, 单价 = 5 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SLL", 单号);
            var d = await IssueSvc().GetAsync(单号);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(40m, d.单头!.金额);
            Assert.Equal("注塑车间", d.单头!.领料部门);
            Assert.True(await IssueSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶领料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶领料单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Return_Create_Get_Delete_with_STL_prefix()
    {
        using var c = fx.Open();
        var 单号 = await ReturnSvc().CreateAsync(new PlasticReturnCreateDto
        {
            退料部门 = "注塑车间", 退料人 = "李四", 仓库 = "塑胶仓",
            明细 = [ new PlasticReturnCreateLineDto { 物料编号 = "STLPM01", 物料名称 = "PP粒", 单位 = "kg", 数量 = 3, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STL", 单号);
            var d = await ReturnSvc().GetAsync(单号);
            Assert.Equal(18m, d!.单头!.金额);
            Assert.Equal("李四", d.单头!.退料人);
            Assert.True(await ReturnSvc().DeleteAsync(单号));
            单号 = null!;
        }
        finally { if (单号 != null) { c.Execute("DELETE FROM [塑胶退料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退料单] WHERE [单号]=@n", new { n = 单号 }); } }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_and_blank()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => IssueSvc().CreateAsync(new PlasticIssueCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => ReturnSvc().CreateAsync(new PlasticReturnCreateDto { 仓库 = "", 明细 = [ new PlasticReturnCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
}
```

- [ ] **Step 2: 运行,确认失败** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticIssueReturnServiceDbTests" -nologo 2>&1 | tail -8`

- [ ] **Step 3: 写领料 service** `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueService.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticIssue;

// 塑胶领料单(库存−)。两层:塑胶领料单 + 塑胶领料明细单。审核后由 PlasticInventoryService 实时聚合(−)。
public sealed class PlasticIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶领料单";
    public const string Prefix = "SLL";

    public async Task<string> CreateAsync(PlasticIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶领料单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶领料单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶领料单]([单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@领料部门,@领料人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶领料明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色, l.仓位号, l.单位, l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticIssueHeaderDto>(items, total);
    }

    public async Task<PlasticIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶领料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶领料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticIssueLineDto>()).AsList();
        return new PlasticIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: 写退料 service** `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnService.cs` — 同领料,替换:namespace→`...PlasticReturn`、类名`PlasticIssue*`→`PlasticReturn*`、DocType="塑胶退料单"、Prefix="STL"、表名`塑胶领料单/塑胶领料明细单`→`塑胶退料单/塑胶退料明细单`、头字段`领料部门/领料人`→`退料部门/退料人`(含 List 的 keyword 用 `退料人`、所有 INSERT/SELECT 列名同步):
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticReturn;

// 塑胶退料单(库存+)。两层:塑胶退料单 + 塑胶退料明细单。审核后由 PlasticInventoryService 实时聚合(+)。
public sealed class PlasticReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶退料单";
    public const string Prefix = "STL";

    public async Task<string> CreateAsync(PlasticReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶退料单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶退料单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶退料单]([单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@退料部门,@退料人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.退料部门, dto.退料人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶退料明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色, l.仓位号, l.单位, l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶退料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [退料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶退料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [退料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticReturnHeaderDto>()).AsList();
        return new PagedResult<PlasticReturnHeaderDto>(items, total);
    }

    public async Task<PlasticReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶退料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶退料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticReturnLineDto>()).AsList();
        return new PlasticReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶退料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶退料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶退料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶退料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 运行,确认通过** — `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticIssueReturnServiceDbTests" -nologo 2>&1 | tail -6` (Expected: 通过: 3)

- [ ] **Step 6: Commit** — `git add src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueService.cs src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnService.cs tests/ErpApi.Tests/PlasticIssueReturnServiceDbTests.cs && git commit -m "feat(塑胶领料退料): service create/get/list/delete + DB测试"`

---

### Task 4: 库存引擎扩展(领料−/退料+) · TDD

**Files:** Modify `PlasticInventoryService.cs`, `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs`

- [ ] **Step 1: 追加联动测试** — 在 `PlasticInventoryServiceDbTests.cs` 类内 `Stock_zero_until_approved_...` 测试之后追加:
```csharp
    [SkippableFact]
    public async Task Issue_minus_and_Return_plus_after_approve()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        // 入仓100(审核)→库存100;领料30(审核)→70;退料10(审核)→80
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRIR01'");
        c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SLLIR01'");
        c.Execute("DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶退料单] WHERE [单号]=N'STLIR01'");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SRIR01',N'塑胶仓',N'SIRPM01',100)");
        c.Execute("INSERT INTO [塑胶领料单]([单号],[仓库],[审核]) VALUES(N'SLLIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'SLLIR01',N'塑胶仓',N'SIRPM01',30)");
        c.Execute("INSERT INTO [塑胶退料单]([单号],[仓库],[审核]) VALUES(N'STLIR01',N'塑胶仓','0')");
        c.Execute("INSERT INTO [塑胶退料明细单]([单号],[仓库],[物料编号],[数量]) VALUES(N'STLIR01',N'塑胶仓',N'SIRPM01',10)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRIR01", "t");
            Assert.Equal(100m, await Svc().StockOfAsync("SIRPM01", null));
            await engine.ApproveAsync("塑胶领料单", "SLLIR01", "t");
            Assert.Equal(70m, await Svc().StockOfAsync("SIRPM01", null));   // −30
            await engine.ApproveAsync("塑胶退料单", "STLIR01", "t");
            Assert.Equal(80m, await Svc().StockOfAsync("SIRPM01", null));   // +10
        }
        finally
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRIR01'");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SLLIR01'");
            c.Execute("DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SIRPM01'; DELETE FROM [塑胶退料单] WHERE [单号]=N'STLIR01'");
        }
    }
```

- [ ] **Step 2: 运行,确认失败(领料/退料表未在 UNION,库存仍 100)** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticInventoryServiceDbTests" -nologo 2>&1 | tail -8` (Expected: 新测试失败,断言 70 实得 100)

- [ ] **Step 3: 扩展 LedgerUnion** — `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`,把 `LedgerUnion` 常量末尾(入仓那支之后)追加两支:
```csharp
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";
```
注:原 `LedgerUnion` 字符串以入仓那支的 `...='1'"` 结尾(含结束引号);把结尾引号去掉、接上两段 `UNION ALL ...`,新结尾引号放在退料那支末尾。确保最终是一个合法的 `@"..."` 字符串。

- [ ] **Step 4: 运行,确认通过** — `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticInventoryServiceDbTests" -nologo 2>&1 | tail -6` (Expected: 通过: 2,含 100→70→80)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Engines/Inventory/PlasticInventoryService.cs tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs && git commit -m "feat(塑胶库存): UNION加领料(−)/退料(+)两支+联动测试"`

---

### Task 5: 控制器 + DI

**Files:** Create `PlasticIssueController.cs`, `PlasticReturnController.cs`; Modify `Program.cs`

- [ ] **Step 1: 领料控制器** `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueController.cs`(照 `PlasticReceiptController` 克隆,换 Menu/Table/Route/CreateDto):
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticIssue;

[ApiController]
[Authorize]
[Route("api/plastic-issues")]
public sealed class PlasticIssueController(
    PlasticIssueService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶领料单";
    private const string Table = "塑胶领料单";
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
    public async Task<IActionResult> Create([FromBody] PlasticIssueCreateDto dto)
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

- [ ] **Step 2: 退料控制器** `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnController.cs` — 同领料,替换:namespace→`...PlasticReturn`、`PlasticIssueService`→`PlasticReturnService`、`PlasticIssueCreateDto`→`PlasticReturnCreateDto`、Menu/Table="塑胶退料单"、Route="api/plastic-returns"、类名 `PlasticIssueController`→`PlasticReturnController`。

- [ ] **Step 3: 注册 DI** — `src/ErpApi/Program.cs`,在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticReceipt.PlasticReceiptService>();`(P3a 加的)之后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticIssue.PlasticIssueService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticReturn.PlasticReturnService>();
```

- [ ] **Step 4: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5` (Expected: 0 错误)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueController.cs src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnController.cs src/ErpApi/Program.cs && git commit -m "feat(塑胶领料退料): 控制器+DI"`

---

### Task 6: 菜单 + 权限种子

**Files:** Modify `MenuCatalog.cs`; Create `db/seed_plastic_issue_return_perms.sql`

- [ ] **Step 1: MenuCatalog** — 在 `new("塑胶仓储","塑胶入仓单"),`(P3a 加的)之后加:
```csharp
        new("塑胶仓储","塑胶领料单"),
        new("塑胶仓储","塑胶退料单"),
```

- [ ] **Step 2: 种子** `db/seed_plastic_issue_return_perms.sql`:
```sql
-- 开发用:给某用户授予 塑胶领料单 + 塑胶退料单 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶领料单',N'塑胶退料单');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶领料单',1,1,1,1,1,1,1,1,1),
       (@用户,N'塑胶退料单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 执行种子** — `cd /d/WebpageERP && powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/seed_plastic_issue_return_perms.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'perms seeded'"` (Expected: `perms seeded`)

- [ ] **Step 4: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4` (Expected: 0 错误)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_issue_return_perms.sql && git commit -m "feat(塑胶领料退料): MenuCatalog菜单项+权限种子"`

---

### Task 7: 前端 config + 路由 + 菜单(零新组件)

**Files:** Modify `PlasticDocConfigs.ts`, `App.tsx`, `menuTree.tsx`

- [ ] **Step 1: 加 config** — `web/src/pages/plastics/docs/PlasticDocConfigs.ts`,在 `PLASTIC_DOC_CONFIGS` 对象里 `"plastic-receipts"` 之后加:
```typescript
  "plastic-issues": {
    resource: "plastic-issues", menu: "塑胶领料单", title: "塑胶领料",
    headerFields: [
      { name: "领料部门", label: "领料部门" }, { name: "领料人", label: "领料人" },
      { name: "仓库", label: "仓库", required: true }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "领料人", label: "领料人" }, { name: "仓库", label: "仓库" }],
  },
  "plastic-returns": {
    resource: "plastic-returns", menu: "塑胶退料单", title: "塑胶退料",
    headerFields: [
      { name: "退料部门", label: "退料部门" }, { name: "退料人", label: "退料人" },
      { name: "仓库", label: "仓库", required: true }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "退料人", label: "退料人" }, { name: "仓库", label: "仓库" }],
  },
```

- [ ] **Step 2: 路由** — `web/src/App.tsx`,在 P3a 的 `plastic-receipts` 路由旁加:
```tsx
          <Route path="plastic-issues" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-issues"]} />} />
          <Route path="plastic-returns" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-returns"]} />} />
```
(`PlasticDocPage` 与 `PLASTIC_DOC_CONFIGS` 的 import 已在 P3a 加过,无需重复。)

- [ ] **Step 3: 菜单** — `web/src/nav/menuTree.tsx` ⑧塑胶仓库:把 `M("塑胶领料单")` 改 `M("塑胶领料单","/plastic-issues","塑胶领料单")`、`M("塑胶退料单")` 改 `M("塑胶退料单","/plastic-returns","塑胶退料单")`。

- [ ] **Step 4: tsc + 测试** — `cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6` (Expected: tsc 干净;vitest 54)

- [ ] **Step 5: Commit** — `cd /d/WebpageERP && git add web/src/pages/plastics/docs/PlasticDocConfigs.ts web/src/App.tsx web/src/nav/menuTree.tsx && git commit -m "feat(塑胶领料退料): 前端config+路由+菜单(复用塑胶单据通用组件)"`

---

### Task 8: 全量验证 + 冒烟 + 收尾

- [ ] **Step 1: 后端全量** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo 2>&1 | tail -5` (Expected: 全过,343+4=347)

- [ ] **Step 2: 启动 + 冒烟(入仓→领料→退料 库存联动)**
```bash
cd /d/WebpageERP
nohup dotnet run --project src/ErpApi/ErpApi.csproj --no-build > /tmp/be_p3b.log 2>&1 &
sleep 9
TOK=$(curl -s --noproxy '*' -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" --data @/tmp/login.json | python -c "import sys,json; d=json.load(sys.stdin); print(next(v for v in d.values() if isinstance(v,str) and v.startswith('eyJ')))")
mat='SB3BSMOKE'
# 入仓100
echo "{\"仓库\":\"塑胶仓\",\"明细\":[{\"物料编号\":\"$mat\",\"数量\":100,\"单价\":2}]}" > /tmp/rk.json
RK=$(curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-receipts" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/rk.json | grep -o 'SR[0-9]\+')
curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-receipts/$RK/approve" -H "Authorization: Bearer $TOK" -o /dev/null
# 领料30
echo "{\"仓库\":\"塑胶仓\",\"领料人\":\"张三\",\"明细\":[{\"物料编号\":\"$mat\",\"数量\":30,\"单价\":2}]}" > /tmp/ll.json
LL=$(curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-issues" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/ll.json | grep -o 'SLL[0-9]\+')
echo "领料单=$LL"; curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-issues/$LL/approve" -H "Authorization: Bearer $TOK" -w "领料approve HTTP %{http_code}\n" -o /dev/null
echo -n "领料审核后库存(应70): "; curl -s --noproxy '*' "http://localhost:5000/api/plastic-inventory?keyword=$mat" -H "Authorization: Bearer $TOK" | grep -o '"库存数量":[0-9.]*'
# 退料10
echo "{\"仓库\":\"塑胶仓\",\"退料人\":\"李四\",\"明细\":[{\"物料编号\":\"$mat\",\"数量\":10,\"单价\":2}]}" > /tmp/tl.json
TL=$(curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-returns" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/tl.json | grep -o 'STL[0-9]\+')
echo "退料单=$TL"; curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-returns/$TL/approve" -H "Authorization: Bearer $TOK" -w "退料approve HTTP %{http_code}\n" -o /dev/null
echo -n "退料审核后库存(应80): "; curl -s --noproxy '*' "http://localhost:5000/api/plastic-inventory?keyword=$mat" -H "Authorization: Bearer $TOK" | grep -o '"库存数量":[0-9.]*'
```
Expected: 领料 approve 204、库存 70;退料 approve 204、库存 80。

- [ ] **Step 3: 清理冒烟** — `powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SB3BSMOKE'; DELETE FROM [塑胶入仓单] WHERE [备注] IS NULL AND [单号] IN (SELECT [单号] FROM [塑胶入仓明细单] WHERE [物料编号]=N'SB3BSMOKE'); DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SB3BSMOKE'; DELETE FROM [塑胶领料单] WHERE [领料人]=N'张三'; DELETE FROM [塑胶退料明细单] WHERE [物料编号]=N'SB3BSMOKE'; DELETE FROM [塑胶退料单] WHERE [退料人]=N'李四'\"; \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output cleaned"`
  (注:若上句因依赖顺序报错,可分别按 物料编号 删明细、按 单号 删头;冒烟数据少,手工清理亦可。)

- [ ] **Step 4: 前端 lint** — `cd /d/WebpageERP/web && npx eslint src/pages/plastics/docs/PlasticDocConfigs.ts 2>&1 | tail -5` (Expected: 无错误,config 纯数据)

- [ ] **Step 5: 合并 master** — `cd /d/WebpageERP && git checkout master && git merge --no-ff feat-plastic-issue-return -m "Merge branch 'feat-plastic-issue-return' into master" && git log --oneline -2 && git branch -d feat-plastic-issue-return`

- [ ] **Step 6: worklog + 记忆** — 写 `docs/worklogs/2026-06-25-plastic-issue-return.md`;更新 `erp-plastic-module-p0-0625.md`(标 P3b)+ `MEMORY.md`。

---

## 自检

**Spec 覆盖:** ① 4表→Task1;② 领料/退料 service→Task3,控制器+DI→Task5,白名单+DTO→Task2,库存2支→Task4,权限→Task6;③ 前端config→Task7;④ 测试→Task3/4+Task8;⑤ 验收1-5→Task8 冒烟(入仓100→领料70→退料80)。无遗漏。

**占位扫描:** 无 TBD;领料 service 给全码,退料 service 给全码(非"同上");db/19 序号、白名单/DI/MenuCatalog/路由 锚点具体;退料 DTO/控制器 用"替换清单"+领料全码可无歧义照做。

**类型一致:** `PlasticIssueService`/`PlasticReturnService` 的 `{CreateAsync,GetAsync,ListAsync,DeleteAsync}`(Task3)与控制器(Task5)一致;DTO 字段(Task2)与 service SQL 列一致;`PlasticIssueCreateDto.领料部门/领料人` vs `PlasticReturnCreateDto.退料部门/退料人` 与各自表头列、前端 config headerFields name 一致;前缀 SLL/STL、菜单/权限名 塑胶领料单/塑胶退料单 三处统一;库存 UNION 领料 `数量*-1`/退料 `数量`(Task4)+ 白名单 2 项(Task2)+ 审核日期列(Task1)闭环。
