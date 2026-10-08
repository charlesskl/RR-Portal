# 塑胶库存引擎 + 塑胶入仓单(P3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建塑胶库存引擎(实时 UNION,本期单支)+ 塑胶入仓单(头+明细·SR单号·审核即过账)+ 一套塑胶专用 config 驱动单据前端(行表用 PlasticMaterialPicker)+ 塑胶库存统计表。

**Architecture:** 镜像物料侧 MaterialInventoryService(UNION)+ PurchaseReceiptService(入仓)。库存=已审核明细实时聚合,无过账写账。前端因物料侧通用组件写死 MaterialPicker,另建塑胶专用一套(P3b/c/d 复用)。过账三件套(PostableDocuments 白名单 + 审核日期列 + 回归测试)按 P2 教训直接做对。

**Tech Stack:** .NET 8 / Dapper / ASP.NET · React+TS+AntD · SQL Server。

**设计依据:** `docs/superpowers/specs/2026-06-25-p3a-plastic-inventory-receipt-design.md`。镜像源:`MaterialInventoryService.cs`、`PurchaseReceipt/*`、`web/.../materials/{MaterialDocPage,MaterialDocCreateDrawer,MaterialLineTable,MaterialDocDetailDrawer}.tsx`、`web/.../plastics/PlasticMaterialPicker.tsx`(P1)。

---

## 文件结构

| 文件 | 职责 | 新建/改 |
|---|---|---|
| `db/18_plastic_receipt.sql` | 塑胶入仓单+明细 建表 | 新建 |
| `db/seed_plastic_receipt_perms.sql` | admin 9 位(塑胶入仓单/塑胶库存) | 新建 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 加 塑胶入仓单 白名单 | 改 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs` | 入仓 DTO | 新建 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | 塑胶库存 UNION 引擎 + DTO | 新建 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryController.cs` | 库存查询 REST | 新建 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptService.cs` | 入仓 create/get/list/delete | 新建 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptController.cs` | 入仓 REST + 审核 | 新建 |
| `src/ErpApi/Program.cs` | 注册两 service | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单 塑胶入仓单/塑胶库存 | 改 |
| `tests/ErpApi.Tests/PlasticReceiptServiceDbTests.cs` | 入仓 service 测试 | 新建 |
| `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` | 库存引擎测试(审核±) | 新建 |
| `web/src/api/plasticDocs.ts` | 泛型单据 API | 新建 |
| `web/src/pages/plastics/docs/PlasticDocConfigs.ts` | 单据 config | 新建 |
| `web/src/pages/plastics/docs/PlasticLineTable.tsx` | 明细行表(PlasticMaterialPicker) | 新建 |
| `web/src/pages/plastics/docs/PlasticDocCreateDrawer.tsx` | 新建抽屉 | 新建 |
| `web/src/pages/plastics/docs/PlasticDocDetailDrawer.tsx` | 查看/审核抽屉 | 新建 |
| `web/src/pages/plastics/docs/PlasticDocPage.tsx` | 列表页 | 新建 |
| `web/src/api/plasticInventory.ts` | 库存 API | 新建 |
| `web/src/pages/plastics/PlasticInventoryPage.tsx` | 塑胶库存统计表 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 菜单落地 | 改 |

---

### Task 1: 建表 + 分支

**Files:** Create `db/18_plastic_receipt.sql`

- [ ] **Step 0: 建分支** — `cd /d/WebpageERP && git checkout master && git checkout -b feat-plastic-receipt` (Expected: Switched to a new branch)

- [ ] **Step 1: 写建表脚本** `db/18_plastic_receipt.sql`:
```sql
-- 塑胶模块 P3a:塑胶入仓单(头)+ 塑胶入仓明细单(明细)。审核后由 PlasticInventoryService 实时聚合入库存。
IF OBJECT_ID(N'[塑胶入仓单]', N'U') IS NULL
CREATE TABLE [塑胶入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶入仓明细单]', N'U') IS NULL
CREATE TABLE [塑胶入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 两库执行**
```bash
cd /d/WebpageERP
for V in ERP_TEST_DB ERP_DB; do \
  powershell -NoProfile -Command "\$cs=\$env:$V; \$c=New-Object System.Data.SqlClient.SqlConnection \$cs; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/18_plastic_receipt.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output '$V ok'"; \
done
```
Expected: 两个 `ok`。

- [ ] **Step 3: 验证** — `powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_TEST_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (N'塑胶入仓单',N'塑胶入仓明细单')\"; \$cmd.ExecuteScalar(); \$c.Close()"` → Expected `2`

- [ ] **Step 4: Commit** — `git add db/18_plastic_receipt.sql && git commit -m "feat(塑胶入仓单): 建表脚本(头+明细)"`

---

### Task 2: 白名单 + 入仓 DTOs

**Files:** Modify `PostableDocuments.cs`; Create `PlasticReceiptDtos.cs`

- [ ] **Step 1: 白名单加项** — `src/ErpApi/Engines/Posting/PostableDocuments.cs`,在 `["塑胶物料单"] = "单号",`(P2 加的)之后加:
```csharp
            ["塑胶入仓单"] = "单号",
```

- [ ] **Step 2: 写 DTO** `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticReceipt;

public sealed class PlasticReceiptHeaderDto
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

public sealed class PlasticReceiptLineDto
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

public sealed class PlasticReceiptDetailDto
{
    public PlasticReceiptHeaderDto? 单头 { get; set; }
    public List<PlasticReceiptLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReceiptCreateLineDto
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

public sealed class PlasticReceiptCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticReceiptCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 3: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4` (Expected: 0 错误)

- [ ] **Step 4: Commit** — `git add src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs && git commit -m "feat(塑胶入仓单): 过账白名单+DTOs"`

---

### Task 3: 塑胶库存引擎 · TDD

**Files:** Create `PlasticInventoryService.cs`; Test `PlasticInventoryServiceDbTests.cs`

- [ ] **Step 1: 写失败测试** `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticInventoryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        // 未审核入仓:不应计入库存
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRINV01',N'塑胶仓','0')");
        c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'SRINV01',N'塑胶仓',N'SIPM01',N'ABS粒',N'规A',N'kg',100)");
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIPM01'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRINV01'");
    }

    [SkippableFact]
    public async Task Stock_zero_until_approved_then_plus_then_reverses()
    {
        using var c = fx.Open(); Seed(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            Assert.Equal(0m, await Svc().StockOfAsync("SIPM01", null));     // 未审核=0

            Assert.True(await engine.ApproveAsync("塑胶入仓单", "SRINV01", "tester"));
            Assert.Equal(100m, await Svc().StockOfAsync("SIPM01", null));   // 审核后 +100
            var list = await Svc().ListAsync("塑胶仓", "SIPM01");
            Assert.Contains(list, r => r.物料编号 == "SIPM01" && r.库存数量 == 100m && r.仓库 == "塑胶仓");

            Assert.True(await engine.UnapproveAsync("塑胶入仓单", "SRINV01", "tester"));
            Assert.Equal(0m, await Svc().StockOfAsync("SIPM01", null));     // 反审核归零
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 2: 运行,确认失败(service 未定义)** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticInventoryServiceDbTests" -nologo 2>&1 | tail -8`

- [ ] **Step 3: 写引擎** `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`:
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;

public sealed class PlasticStockRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 库存数量 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 仓位号 { get; set; }
}

// 塑胶库存(口径=塑胶):入仓(+) [后续阶段加 领料− / 退料+ / 退仓− / 报废− / 盘点±]。仅审核='1',按 物料编号×仓库 汇总。
// 单据不维护余额——库存是已审核明细单的实时聚合(镜像 MaterialInventoryService)。
public sealed class PlasticInventoryService(ISqlConnectionFactory factory)
{
    private const string LedgerUnion = @"
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    public async Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope)
    {
        if (string.IsNullOrEmpty(物料编号)) return 0;
        var sql = $"SELECT ISNULL(SUM([数量]),0) FROM ({LedgerUnion}) t WHERE [物料编号]=@物料编号";
        if (scope is { } s)
            return await s.conn.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }, s.tx) ?? 0;
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }) ?? 0;
    }

    public async Task<IReadOnlyList<PlasticStockRow>> ListAsync(string? 仓库, string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
       t.[仓库], SUM(t.[数量]) AS 库存数量,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[仓位号]) AS 仓位号
FROM ({LedgerUnion}) t
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([仓位号]) AS 仓位号
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(t.[数量]) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStockRow>(sql, new { wh, kw });
        return rows.AsList();
    }
}
```

- [ ] **Step 4: 运行,确认通过** — `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticInventoryServiceDbTests" -nologo 2>&1 | tail -6` (Expected: 通过: 1)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Engines/Inventory/PlasticInventoryService.cs tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs && git commit -m "feat(塑胶库存): UNION引擎(入仓+·审核即过账)+DB测试"`

---

### Task 4: 塑胶入仓 service · TDD

**Files:** Create `PlasticReceiptService.cs`; Test `PlasticReceiptServiceDbTests.cs`

- [ ] **Step 1: 写失败测试** `tests/ErpApi.Tests/PlasticReceiptServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static PlasticReceiptCreateDto Dto() => new()
    {
        供应商编号 = "S1", 供应商名称 = "供A", 仓库 = "塑胶仓",
        明细 = [
            new PlasticReceiptCreateLineDto { 物料编号 = "SRPM01", 物料名称 = "ABS粒", 规格 = "规A", 单位 = "kg", 数量 = 10, 单价 = 5 },
            new PlasticReceiptCreateLineDto { 物料编号 = "SRPM02", 物料名称 = "PP粒", 单位 = "kg", 数量 = 20, 单价 = 6 },
        ]
    };

    [SkippableFact]
    public async Task Create_then_Get_computes_金额_then_Delete()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("SR", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal(30m, d!.单头!.数量);        // 10+20
            Assert.Equal(170m, d.单头!.金额);        // 50+120
            Assert.Equal(2, d.明细.Count);
            Assert.Equal(50m, Assert.Single(d.明细, x => x.物料编号 == "SRPM01").金额);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Null(await Svc().GetAsync(单号));
            单号 = null!;
        }
        finally
        {
            if (单号 != null) { c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@n", new { n = 单号 }); }
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines_and_blank_warehouse()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticReceiptCreateDto { 仓库 = "塑胶仓", 明细 = [] }, "tester"));
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(new PlasticReceiptCreateDto { 仓库 = "", 明细 = [ new PlasticReceiptCreateLineDto { 物料编号 = "X", 数量 = 1 } ] }, "tester"));
    }
}
```

- [ ] **Step 2: 运行,确认失败** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticReceiptServiceDbTests" -nologo 2>&1 | tail -8`

- [ ] **Step 3: 写 service** `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptService.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticReceipt;

// 塑胶入仓单。两层:塑胶入仓单 + 塑胶入仓明细单。审核后由 PlasticInventoryService 实时聚合入库存。
public sealed class PlasticReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶入仓单";
    public const string Prefix = "SR";   // 塑胶入仓单号 = SR + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶入仓单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶入仓单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticReceiptHeaderDto>()).AsList();
        return new PagedResult<PlasticReceiptHeaderDto>(items, total);
    }

    public async Task<PlasticReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶入仓单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticReceiptLineDto>()).AsList();
        return new PlasticReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: 运行,确认通过** — `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticReceiptServiceDbTests" -nologo 2>&1 | tail -6` (Expected: 通过: 2)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptService.cs tests/ErpApi.Tests/PlasticReceiptServiceDbTests.cs && git commit -m "feat(塑胶入仓单): service create/get/list/delete + DB测试"`

---

### Task 5: 控制器 + DI

**Files:** Create `PlasticReceiptController.cs`, `PlasticInventoryController.cs`; Modify `Program.cs`

- [ ] **Step 1: 入仓控制器** `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticReceipt;

[ApiController]
[Authorize]
[Route("api/plastic-receipts")]
public sealed class PlasticReceiptController(
    PlasticReceiptService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶入仓单";
    private const string Table = "塑胶入仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

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
        if (!await AllowAsync(PermissionAction.单价))
        {
            if (d.单头 is not null) d.单头.金额 = null;
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticReceiptCreateDto dto)
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

- [ ] **Step 2: 库存控制器** `src/ErpApi/Engines/Inventory/PlasticInventoryController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Engines.Inventory;

[ApiController]
[Authorize]
[Route("api/plastic-inventory")]
public sealed class PlasticInventoryController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶库存";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(仓库, keyword));
    }
}
```

- [ ] **Step 3: 注册 DI** — `src/ErpApi/Program.cs`,在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialDoc.PlasticMaterialDocService>();`(P2 加的)之后加:
```csharp
builder.Services.AddScoped<ErpApi.Engines.Inventory.PlasticInventoryService>();
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticReceipt.PlasticReceiptService>();
```

- [ ] **Step 4: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5` (Expected: 0 错误)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptController.cs src/ErpApi/Engines/Inventory/PlasticInventoryController.cs src/ErpApi/Program.cs && git commit -m "feat(塑胶入仓单): 控制器(入仓+库存查询)+DI"`

---

### Task 6: 菜单 + 权限种子

**Files:** Modify `MenuCatalog.cs`; Create `db/seed_plastic_receipt_perms.sql`

- [ ] **Step 1: MenuCatalog** — 在 `new("塑胶采购","塑胶物料单"),`(P2 加的)之后加:
```csharp
        new("塑胶仓储","塑胶入仓单"),
        new("塑胶报表","塑胶库存"),
```

- [ ] **Step 2: 种子** `db/seed_plastic_receipt_perms.sql`:
```sql
-- 开发用:给某用户授予 塑胶入仓单 + 塑胶库存 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶入仓单',N'塑胶库存');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶入仓单',1,1,1,1,1,1,1,1,1),
       (@用户,N'塑胶库存',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 执行种子** — `cd /d/WebpageERP && powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/seed_plastic_receipt_perms.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'perms seeded'"` (Expected: `perms seeded`)

- [ ] **Step 4: 编译** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4` (Expected: 0 错误)

- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_receipt_perms.sql && git commit -m "feat(塑胶入仓单): MenuCatalog菜单项+权限种子"`

---

### Task 7: 前端塑胶单据通用组件 (api/config/行表)

**Files:** Create `web/src/api/plasticDocs.ts`, `web/src/pages/plastics/docs/PlasticDocConfigs.ts`, `web/src/pages/plastics/docs/PlasticLineTable.tsx`

- [ ] **Step 1: 泛型 API** `web/src/api/plasticDocs.ts`:
```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PlasticDocHeader {
  id: number; 单号?: string; 日期?: string; 仓库?: string; 数量?: number | null; 金额?: number | null;
  审核?: string; 备注?: string; [k: string]: unknown;
}
export interface PlasticDocLine {
  id?: number; 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 仓位号?: string;
  单位?: string; 数量?: number | null; 单价?: number | null; 金额?: number | null; 备注?: string;
}
export interface PlasticDocDetail { 单头?: PlasticDocHeader; 明细: PlasticDocLine[] }

const enc = encodeURIComponent;
export function plasticDocApi(resource: string) {
  const base = `/${resource}`;
  return {
    list: (page = 1, size = 10, keyword = "") => api.get<Paged<PlasticDocHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
    get: (单号: string) => api.get<PlasticDocDetail>(`${base}/${enc(单号)}`).then(r => r.data),
    create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
    remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
    approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
    unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
  };
}
```

- [ ] **Step 2: config** `web/src/pages/plastics/docs/PlasticDocConfigs.ts`:
```typescript
export interface PlasticDocFieldCfg { name: string; label: string; required?: boolean }
export interface PlasticDocCfg {
  resource: string;   // API 资源/路由段(plastic-receipts)
  menu: string;       // 权限菜单
  title: string;      // 显示名(塑胶入仓)
  headerFields: PlasticDocFieldCfg[];
  listExtra: PlasticDocFieldCfg[];   // 列表里头表特有列
}

export const PLASTIC_DOC_CONFIGS: Record<string, PlasticDocCfg> = {
  "plastic-receipts": {
    resource: "plastic-receipts", menu: "塑胶入仓单", title: "塑胶入仓",
    headerFields: [
      { name: "供应商编号", label: "供应商编号" }, { name: "供应商名称", label: "供应商名称" },
      { name: "仓库", label: "仓库", required: true }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "供应商名称", label: "供应商" }, { name: "仓库", label: "仓库" }],
  },
};
```

- [ ] **Step 3: 明细行表** `web/src/pages/plastics/docs/PlasticLineTable.tsx`:
```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import PlasticMaterialPicker from "../PlasticMaterialPicker";
import type { PlasticMaterialRow } from "../../../api/plasticMaterialMaster";
import type { PlasticDocLine } from "../../../api/plasticDocs";

// 受控塑胶明细行表:物料编号点🔍弹 PlasticMaterialPicker(P0 塑胶物料资料)回填名称/规格/颜色/仓位号/单位。
export default function PlasticLineTable({ value, onChange, hidePriceCols }: {
  value: PlasticDocLine[];
  onChange: Dispatch<SetStateAction<PlasticDocLine[]>>;
  hidePriceCols: boolean;
}) {
  const [pickFor, setPickFor] = useState<number | null>(null);
  const setLine = (i: number, patch: Partial<PlasticDocLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const fill = (row: PlasticMaterialRow) => {
    if (pickFor === null) return;
    setLine(pickFor, {
      物料编号: row.物料编号, 物料名称: row.物料名称, 规格: row.规格,
      颜色: row.颜色, 仓位号: row.仓位号, 单位: row.单位,
      单价: hidePriceCols ? null : (row.单价 ?? null),
    });
  };

  const ro = (v?: string) => <span>{v ?? ""}</span>;
  const columns = [
    {
      title: "物料", dataIndex: "物料编号", width: 200,
      render: (_: unknown, r: PlasticDocLine, i: number) => (
        <Input style={{ width: 180 }} value={r.物料编号 ?? ""} onChange={e => setLine(i, { 物料编号: e.target.value })}
          suffix={<SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setPickFor(i)} />} />
      ),
    },
    { title: "物料名称", dataIndex: "物料名称", width: 140, render: (v: string) => ro(v) },
    { title: "规格", dataIndex: "规格", width: 100, render: (v: string) => ro(v) },
    { title: "颜色", dataIndex: "颜色", width: 80, render: (v: string) => ro(v) },
    { title: "仓位号", dataIndex: "仓位号", width: 90, render: (v: string) => ro(v) },
    { title: "单位", dataIndex: "单位", width: 64, render: (v: string) => ro(v) },
    {
      title: "数量", dataIndex: "数量", width: 100,
      render: (_: unknown, r: PlasticDocLine, i: number) => (
        <InputNumber min={0} precision={2} style={{ width: 88 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} />
      ),
    },
    ...(hidePriceCols ? [] : [
      {
        title: "单价", dataIndex: "单价", width: 110,
        render: (_: unknown, r: PlasticDocLine, i: number) => (
          <InputNumber min={0} precision={4} style={{ width: 96 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} />
        ),
      },
      { title: "金额", dataIndex: "_amt", width: 100, render: (_: unknown, r: PlasticDocLine) => ((Number(r.数量) || 0) * (Number(r.单价) || 0)).toFixed(2) },
    ]),
    {
      title: "备注", dataIndex: "备注", width: 140,
      render: (_: unknown, r: PlasticDocLine, i: number) => (
        <Input style={{ width: 128 }} value={r.备注 ?? ""} onChange={e => setLine(i, { 备注: e.target.value })} />
      ),
    },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: PlasticDocLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: PlasticDocLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>
      <PlasticMaterialPicker open={pickFor !== null} onPick={fill} onClose={() => setPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**(tsc 待 Task8 抽屉/页齐再跑) — `cd /d/WebpageERP && git add web/src/api/plasticDocs.ts web/src/pages/plastics/docs/PlasticDocConfigs.ts web/src/pages/plastics/docs/PlasticLineTable.tsx && git commit -m "feat(塑胶单据前端): 泛型API+config+明细行表(PlasticMaterialPicker)"`

---

### Task 8: 前端塑胶单据通用组件 (抽屉/页) + tsc

**Files:** Create `PlasticDocCreateDrawer.tsx`, `PlasticDocDetailDrawer.tsx`, `PlasticDocPage.tsx`

- [ ] **Step 1: 新建抽屉** `web/src/pages/plastics/docs/PlasticDocCreateDrawer.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, Row, Space, Statistic, message } from "antd";
import { plasticDocApi, type PlasticDocLine } from "../../../api/plasticDocs";
import { hidePrice } from "../../../auth/permissions";
import { usePerms } from "../../../auth/PermissionContext";
import type { PlasticDocCfg } from "./PlasticDocConfigs";
import PlasticLineTable from "./PlasticLineTable";

export default function PlasticDocCreateDrawer({ cfg, open, onClose, onCreated }: {
  cfg: PlasticDocCfg; open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, cfg.menu);
  const [form] = Form.useForm<Record<string, string>>();
  const [lines, setLines] = useState<PlasticDocLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { form.resetFields(); setLines([]); } }, [open, form, cfg.resource]);

  const submit = async () => {
    let v: Record<string, string>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细"); return; }
    setSaving(true);
    try {
      await plasticDocApi(cfg.resource).create({ ...v, 明细: ok });
      message.success(`${cfg.title}单已创建`); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const sumQty = lines.reduce((s, l) => s + (Number(l.数量) || 0), 0);
  const sumAmt = lines.reduce((s, l) => s + (Number(l.数量) || 0) * (Number(l.单价) || 0), 0);

  return (
    <Drawer title={`新建${cfg.title}单`} width={960} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          {cfg.headerFields.map(f => (
            <Col span={8} key={f.name}>
              <Form.Item name={f.name} label={f.label}
                rules={f.required ? [{ required: true, message: `请填写${f.label}` }] : undefined}>
                <Input />
              </Form.Item>
            </Col>
          ))}
        </Row>
      </Form>
      <PlasticLineTable value={lines} onChange={setLines} hidePriceCols={priceHidden} />
      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={sumQty} />
        {!priceHidden && <Statistic title="金额合计" value={sumAmt.toFixed(2)} />}
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 2: 查看/审核抽屉** `web/src/pages/plastics/docs/PlasticDocDetailDrawer.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Button, Descriptions, Drawer, Popconfirm, Space, Table, Tag, message } from "antd";
import { plasticDocApi, type PlasticDocDetail } from "../../../api/plasticDocs";
import type { PlasticDocCfg } from "./PlasticDocConfigs";
import { can, hidePrice } from "../../../auth/permissions";
import { usePerms } from "../../../auth/PermissionContext";

const d10 = (v?: string) => v?.slice(0, 10);

export default function PlasticDocDetailDrawer({ cfg, 单号, onClose, onChanged }: {
  cfg: PlasticDocCfg; 单号: string | null; onClose: () => void; onChanged: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, cfg.menu);
  const money = (v?: number | null) => (priceHidden || v == null ? "***" : v);
  const dapi = plasticDocApi(cfg.resource);
  const [detail, setDetail] = useState<PlasticDocDetail | null>(null);

  useEffect(() => {
    if (!单号) { setDetail(null); return; }
    dapi.get(单号).then(setDetail).catch(() => message.error("加载单据失败"));
  }, [单号]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, ok: string, close: boolean) => {
    try {
      await fn(); message.success(ok); onChanged();
      if (close) onClose(); else if (单号) dapi.get(单号).then(setDetail);
    } catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const h = detail?.单头;
  const 审核 = h?.审核;
  const cols = [
    { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" }, { title: "颜色", dataIndex: "颜色" },
    { title: "仓位号", dataIndex: "仓位号" }, { title: "单位", dataIndex: "单位" },
    { title: "数量", dataIndex: "数量", align: "right" as const },
    ...(priceHidden ? [] : [
      { title: "单价", dataIndex: "单价", align: "right" as const, render: money },
      { title: "金额", dataIndex: "金额", align: "right" as const, render: money },
    ]),
  ];

  return (
    <Drawer title={`${cfg.title}单 ${单号 ?? ""}`} width={960} open={!!单号} onClose={onClose}
      extra={detail && (
        <Space>
          {审核 !== "1" && can(perms, cfg.menu, "审核") && <Button onClick={() => act(() => dapi.approve(单号!), "已审核", false)}>审核</Button>}
          {审核 === "1" && can(perms, cfg.menu, "反审核") && <Button onClick={() => act(() => dapi.unapprove(单号!), "已反审核", false)}>反审核</Button>}
          {审核 !== "1" && can(perms, cfg.menu, "删除") && (
            <Popconfirm title="确认删除?" onConfirm={() => act(() => dapi.remove(单号!), "已删除", true)}><Button danger>删除</Button></Popconfirm>
          )}
        </Space>
      )}>
      {detail && h && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="单号">{h.单号}</Descriptions.Item>
            <Descriptions.Item label="日期">{d10(h.日期)}</Descriptions.Item>
            <Descriptions.Item label="状态">{审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>}</Descriptions.Item>
            {cfg.listExtra.map(f => <Descriptions.Item key={f.name} label={f.label}>{String(h[f.name] ?? "-")}</Descriptions.Item>)}
            <Descriptions.Item label="数量">{String(h.数量 ?? "-")}</Descriptions.Item>
            <Descriptions.Item label="金额">{money(h.金额)}</Descriptions.Item>
            <Descriptions.Item label="备注">{h.备注 ?? "-"}</Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey="id" pagination={false} scroll={{ x: true }} dataSource={detail.明细} columns={cols} />
        </Space>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 3: 列表页** `web/src/pages/plastics/docs/PlasticDocPage.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { plasticDocApi, type PlasticDocHeader } from "../../../api/plasticDocs";
import { can } from "../../../auth/permissions";
import { usePerms } from "../../../auth/PermissionContext";
import type { PlasticDocCfg } from "./PlasticDocConfigs";
import PlasticDocCreateDrawer from "./PlasticDocCreateDrawer";
import PlasticDocDetailDrawer from "./PlasticDocDetailDrawer";

export default function PlasticDocPage({ cfg }: { cfg: PlasticDocCfg }) {
  const perms = usePerms();
  const dapi = useMemo(() => plasticDocApi(cfg.resource), [cfg.resource]);
  const [rows, setRows] = useState<PlasticDocHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await dapi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载列表失败"); }
  }, [page, keyword, dapi]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "单号", dataIndex: "单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "日期", dataIndex: "日期", render: (v?: string) => v?.slice(0, 10) },
    ...cfg.listExtra.map(f => ({ title: f.label, dataIndex: f.name })),
    { title: "数量", dataIndex: "数量" },
    { title: "金额", dataIndex: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "状态", dataIndex: "审核", render: (v?: string) => v === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
  ];

  if (!can(perms, cfg.menu, "打开")) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"{cfg.menu}·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`${cfg.title}单`} variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/供应商" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, cfg.menu, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建{cfg.title}单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <PlasticDocCreateDrawer cfg={cfg} open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <PlasticDocDetailDrawer cfg={cfg} 单号={viewing} onClose={() => setViewing(null)} onChanged={load} />
    </Card>
  );
}
```

- [ ] **Step 4: tsc + 测试** — `cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6` (Expected: tsc 干净;vitest 54)。修 YOUR 文件 tsc 报错。

- [ ] **Step 5: Commit** — `cd /d/WebpageERP && git add web/src/pages/plastics/docs/PlasticDocCreateDrawer.tsx web/src/pages/plastics/docs/PlasticDocDetailDrawer.tsx web/src/pages/plastics/docs/PlasticDocPage.tsx && git commit -m "feat(塑胶单据前端): 新建抽屉+查看审核抽屉+列表页"`

---

### Task 9: 塑胶入仓页 + 塑胶库存统计表 + 路由 + 菜单

**Files:** Create `web/src/api/plasticInventory.ts`, `web/src/pages/plastics/PlasticInventoryPage.tsx`; Modify `App.tsx`, `menuTree.tsx`

- [ ] **Step 1: 库存 API** `web/src/api/plasticInventory.ts`:
```typescript
import { api } from "./client";

export interface PlasticStockRow {
  物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string;
  仓库?: string; 库存数量: number; 物料类别?: string; 仓位号?: string;
}
export const plasticInventoryApi = {
  list: (仓库?: string, keyword?: string) =>
    api.get<PlasticStockRow[]>("/plastic-inventory", { params: { 仓库, keyword } }).then(r => r.data),
};
```

- [ ] **Step 2: 库存统计表页** `web/src/pages/plastics/PlasticInventoryPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Input, Space, Table, message } from "antd";
import { plasticInventoryApi, type PlasticStockRow } from "../../api/plasticInventory";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶库存";
export default function PlasticInventoryPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [仓库, set仓库] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticStockRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try { setRows(await plasticInventoryApi.list(仓库.trim() || undefined, keyword.trim() || undefined)); }
    catch { message.error("加载塑胶库存失败"); }
    finally { setLoading(false); }
  }, [canOpen, 仓库, keyword]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "材料", dataIndex: "物料类别", width: 90 },
    { title: "仓位号", dataIndex: "仓位号", width: 90 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "仓库", dataIndex: "仓库", width: 100 },
    { title: "库存数量", dataIndex: "库存数量", width: 100, align: "right" as const,
      render: (v: number) => <span style={{ fontWeight: 600 }}>{v}</span> },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶库存·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶库存统计表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Input placeholder="仓库" allowClear value={仓库} onChange={e => set仓库(e.target.value)} onPressEnter={load} style={{ width: 140 }} />
        <Input.Search placeholder="物料编号/名称/规格" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由** `web/src/App.tsx` —— import 区加:
```tsx
import PlasticDocPage from "./pages/plastics/docs/PlasticDocPage";
import { PLASTIC_DOC_CONFIGS } from "./pages/plastics/docs/PlasticDocConfigs";
import PlasticInventoryPage from "./pages/plastics/PlasticInventoryPage";
```
路由区加:
```tsx
          <Route path="plastic-receipts" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-receipts"]} />} />
          <Route path="plastic-inventory" element={<PlasticInventoryPage />} />
```

- [ ] **Step 4: 菜单** `web/src/nav/menuTree.tsx` —— ⑧塑胶仓库 把 `M("塑胶入仓单")` 改为 `M("塑胶入仓单", "/plastic-receipts", "塑胶入仓单")`;⑨塑胶报表 把 `M("塑胶库存统计表")` 改为 `M("塑胶库存统计表", "/plastic-inventory", "塑胶库存")`。

- [ ] **Step 5: tsc + 测试** — `cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6` (Expected: tsc 干净;vitest 54)

- [ ] **Step 6: Commit** — `cd /d/WebpageERP && git add web/src/api/plasticInventory.ts web/src/pages/plastics/PlasticInventoryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx && git commit -m "feat(塑胶入仓单): 塑胶入仓页+库存统计表+路由+菜单"`

---

### Task 10: 全量验证 + 冒烟 + 收尾

- [ ] **Step 1: 后端全量** — `taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo 2>&1 | tail -5` (Expected: 全过,340+3=343)

- [ ] **Step 2: 启动 + 冒烟(create→approve→库存出现→unapprove→消失)**
```bash
cd /d/WebpageERP
nohup dotnet run --project src/ErpApi/ErpApi.csproj --no-build > /tmp/be_p3a.log 2>&1 &
sleep 9
echo '{"用户":"admin","密码":"admin123"}' > /tmp/login.json
TOK=$(curl -s --noproxy '*' -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" --data @/tmp/login.json | python -c "import sys,json; d=json.load(sys.stdin); print(next(v for v in d.values() if isinstance(v,str) and v.startswith('eyJ')))")
echo '{"供应商编号":"S1","供应商名称":"供A","仓库":"塑胶仓","明细":[{"物料编号":"SRSMOKE","物料名称":"冒烟料","单位":"kg","数量":7,"单价":3}]}' > /tmp/r.json
NO=$(curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-receipts" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/r.json | grep -o 'SR[0-9]\+')
echo "新单=$NO"
echo -n "审核前库存(应空): "; curl -s --noproxy '*' "http://localhost:5000/api/plastic-inventory?keyword=SRSMOKE" -H "Authorization: Bearer $TOK" | head -c 60
echo ""; echo -n "approve: "; curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-receipts/$NO/approve" -H "Authorization: Bearer $TOK" -w "HTTP %{http_code}\n" -o /dev/null
echo -n "审核后库存(应含7): "; curl -s --noproxy '*' "http://localhost:5000/api/plastic-inventory?keyword=SRSMOKE" -H "Authorization: Bearer $TOK" | head -c 200
echo ""; echo -n "unapprove: "; curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-receipts/$NO/unapprove" -H "Authorization: Bearer $TOK" -w "HTTP %{http_code}\n" -o /dev/null
echo -n "反审核后库存(应空): "; curl -s --noproxy '*' "http://localhost:5000/api/plastic-inventory?keyword=SRSMOKE" -H "Authorization: Bearer $TOK" | head -c 60
echo ""; echo -n "del(未审核应204): "; curl -s --noproxy '*' -X DELETE "http://localhost:5000/api/plastic-receipts/$NO" -H "Authorization: Bearer $TOK" -w "HTTP %{http_code}\n" -o /dev/null
```
Expected: 审核前库存 `[]`;approve 204;审核后库存含 `库存数量:7`;unapprove 204;反审核后 `[]`;del 204。

- [ ] **Step 3: 前端 lint 新文件** — `cd /d/WebpageERP/web && npx eslint src/pages/plastics/docs/ src/pages/plastics/PlasticInventoryPage.tsx 2>&1 | tail -10` (Expected:仅 set-state-in-effect 类基线惯例)

- [ ] **Step 4: 合并 master**
```bash
cd /d/WebpageERP
git checkout master && git merge --no-ff feat-plastic-receipt -m "Merge branch 'feat-plastic-receipt' into master"
git log --oneline -2 && git branch -d feat-plastic-receipt
```

- [ ] **Step 5: worklog + 记忆** — 写 `docs/worklogs/2026-06-25-plastic-inventory-receipt.md`;更新 `erp-plastic-module-p0-0625.md`(标 P3a)+ `MEMORY.md`。

---

## 自检

**Spec 覆盖:** ① 两表→Task1;② 库存引擎→Task3,入仓 service→Task4,控制器+DI→Task5,白名单+DTO→Task2,权限→Task6;③ 塑胶单据通用前端→Task7+8,入仓页+库存页→Task9;④ 测试→Task3/4+Task10;⑤ 验收 1-5→Task10 冒烟(含审核→库存→反审核全链)。无遗漏。

**占位扫描:** 无 TBD;每步完整代码;db/18 序号已定;白名单/DI/MenuCatalog/路由 锚点具体。Task7 提交时抽屉/页未建(行表被 Task8 引用),tsc 在 Task8/9 跑——已注明。

**类型一致:** 后端 `PlasticInventoryService.{StockOfAsync,ListAsync}`(Task3)/`PlasticReceiptService.{CreateAsync,GetAsync,ListAsync,DeleteAsync}`(Task4)与控制器(Task5)调用一致;`PlasticStockRow`(后端Task3/前端Task9)字段一致;`PlasticDocCfg`/`plasticDocApi`(Task7)被抽屉/页(Task8)与 App.tsx(Task9)一致引用;审核走 `posting.ApproveAsync("塑胶入仓单",单号,user)`(Task5);白名单 `塑胶入仓单`(Task2)+ 审核日期列(Task1)+ 库存测试用 PostingEngine 审核(Task3)三者闭环(P2 教训)。
