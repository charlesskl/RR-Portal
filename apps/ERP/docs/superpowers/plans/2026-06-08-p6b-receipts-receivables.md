# P6b 销售收款 + 应收对账 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 建销售收款单+明细（客户级挂账，冲应收）+ 应收对账报表（算法5：出货−收款−退货 按客户）。

**Architecture:** 销售收款=P6a 同款两层 Dapper 单据（半成品式单头审核，无 SyncLineApprovalAsync，不碰库存、不接 periodLock）；应收对账=Dapper 只读 UNION 符号法（JOIN 单头审核），独立「应收对账」菜单打开即看金额。零改表。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p6b-receipts-receivables-design.md`。样板：`src/ErpApi/Features/Sales/SalesShipmentService.cs`(+Controller)、`MaterialInventoryService`(只读 UNION)。

---

## Task 1: 销售收款 DTOs + Service + DbTest

**Files:** Modify `src/ErpApi/Features/Sales/SalesDtos.cs`（追加收款 DTO）；Create `src/ErpApi/Features/Sales/SalesReceiptService.cs`；Test `tests/ErpApi.Tests/SalesReceiptServiceDbTests.cs`.

- [ ] **Step 1: 追加收款 DTOs** 到 `SalesDtos.cs` 末尾：
```csharp
// ---- 销售收款（客户级挂账） ----
public sealed class SalesReceiptLineDto
{ public string? 客户编号 { get; set; } public string? 客户名称 { get; set; } public decimal 收款金额 { get; set; } public decimal? 货款金额 { get; set; } public decimal? 应收金额 { get; set; } public string? 出仓单号 { get; set; } }
public sealed class SalesReceiptCreateDto
{
    public string? 出仓单号 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class SalesReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 出仓单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 出仓单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal? 货款金额 { get; set; }
    public decimal? 收款金额 { get; set; }
    public decimal? 应收金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReceiptDetailDto
{ public SalesReceiptHeaderDto? 单头 { get; set; } public List<SalesReceiptLineRowDto> 明细 { get; set; } = []; }

// ---- 应收对账 ----
public sealed class ReceivableRow
{
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal 出货金额 { get; set; }
    public decimal 收款金额 { get; set; }
    public decimal 退货金额 { get; set; }
    public decimal 应收余额 { get; set; }
}
```

- [ ] **Step 2: SalesReceiptService**（`src/ErpApi/Features/Sales/SalesReceiptService.cs`，仿 `SalesShipmentService`，前缀 `XK`，明细级客户）：
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 销售收款（客户级挂账，冲应收，不碰库存）。两层：销售收款单 + 销售收款明细单(单号 主从)。审核仅单头(明细无审核列)。
public sealed class SalesReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "销售收款单";
    public const string Prefix = "XK";

    public async Task<string> CreateAsync(SalesReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("销售收款至少要有一行明细");
        var now = DateTime.Now;
        var 金额合计 = dto.明细.Sum(l => l.收款金额);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [销售收款单]([出仓单号],[单号],[日期],[金额],[操作员],[审核],[备注])
VALUES(@出仓单号,@单号,@日期,@金额,@操作员,'0',@备注)",
            new { dto.出仓单号, 单号, 日期 = now, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [销售收款明细单]([出仓单号],[单号],[日期],[客户编号],[客户名称],[货款金额],[收款金额],[应收金额],[备注])
VALUES(@出仓单号,@单号,@日期,@客户编号,@客户名称,@货款金额,@收款金额,@应收金额,@备注)",
                new
                {
                    出仓单号 = l.出仓单号 ?? dto.出仓单号, 单号, 日期 = now,
                    l.客户编号, l.客户名称, 货款金额 = l.货款金额 ?? 0, l.收款金额, 应收金额 = l.应收金额 ?? 0, 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SalesReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [销售收款单] WHERE @kw IS NULL OR [单号] LIKE @kw;
SELECT [ID],[出仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注]
FROM [销售收款单] WHERE @kw IS NULL OR [单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SalesReceiptHeaderDto>()).AsList();
        return new PagedResult<SalesReceiptHeaderDto>(items, total);
    }

    public async Task<SalesReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[出仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注] FROM [销售收款单] WHERE [单号]=@单号;
SELECT [ID],[出仓单号],[客户编号],[客户名称],[货款金额],[收款金额],[应收金额],[备注] FROM [销售收款明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SalesReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SalesReceiptLineRowDto>()).AsList();
        return new SalesReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [销售收款单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的销售收款单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [销售收款明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [销售收款单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/SalesReceiptServiceDbTests.cs`（seed 客户资料 P6BC1；建收款单两行收款金额30+20→头金额50；审核后删→409；反审核删→ok）：
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesReceiptServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SalesReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6BC1') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6BC1',N'P6B客户')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new SalesReceiptCreateDto
            {
                明细 = [
                    new SalesReceiptLineDto { 客户编号 = "P6BC1", 客户名称 = "P6B客户", 收款金额 = 30 },
                    new SalesReceiptLineDto { 客户编号 = "P6BC1", 客户名称 = "P6B客户", 收款金额 = 20 },
                ]
            }, "tester");
            Assert.StartsWith("XK", no);
            var 金额 = c.QueryFirst<decimal>("SELECT [金额] FROM [销售收款单] WHERE [单号]=@no", new { no });
            Assert.Equal(50m, 金额);

            c.Execute("UPDATE [销售收款单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [销售收款单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [销售收款明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [销售收款单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6BC1'");
        }
    }
}
```

- [ ] **Step 4: 测试（绿）** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter SalesReceiptServiceDbTests`（过）；全量(159)。
- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Sales/SalesDtos.cs src/ErpApi/Features/Sales/SalesReceiptService.cs tests/ErpApi.Tests/SalesReceiptServiceDbTests.cs && git commit -m "feat(P6): 销售收款服务(客户级挂账·两层事务·审核仅单头)+DbTest"`

---

## Task 2: 应收对账 Service + Controller + DbTest

**Files:** Create `src/ErpApi/Features/Sales/ReceivablesService.cs`、`src/ErpApi/Features/Sales/ReceivablesController.cs`；Modify `src/ErpApi/Program.cs`；Test `tests/ErpApi.Tests/ReceivablesServiceDbTests.cs`.

- [ ] **Step 1: ReceivablesService**（Dapper 只读，算法5 UNION，JOIN 单头审核）：
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 应收对账（算法5）：应收余额 = 出货 − 收款 − 退货，按客户。JOIN 各单头按 审核='1' 过滤。只读。
public sealed class ReceivablesService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT 客户编号, MAX(客户名称) AS 客户名称,
       SUM(CASE WHEN 类型='出货' THEN 金额 ELSE 0 END) AS 出货金额,
       SUM(CASE WHEN 类型='收款' THEN 金额 ELSE 0 END) AS 收款金额,
       SUM(CASE WHEN 类型='退货' THEN 金额 ELSE 0 END) AS 退货金额,
       SUM(CASE WHEN 类型='出货' THEN 金额 WHEN 类型='收款' THEN -金额 WHEN 类型='退货' THEN -金额 ELSE 0 END) AS 应收余额
FROM (
    SELECT d.客户编号, d.客户名称, '出货' AS 类型, ISNULL(d.金额,0) AS 金额
      FROM [销售出货明细单] d JOIN [销售出货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '退货', ISNULL(d.金额,0)
      FROM [销售退货明细单] d JOIN [销售退货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '收款', ISNULL(d.收款金额,0)
      FROM [销售收款明细单] d JOIN [销售收款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t
WHERE @客户编号 IS NULL OR 客户编号=@客户编号
GROUP BY 客户编号
ORDER BY 客户编号;";

    public async Task<IReadOnlyList<ReceivableRow>> ListAsync(string? 客户编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<ReceivableRow>(Sql, new { 客户编号 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim() });
        return rows.AsList();
    }
}
```

- [ ] **Step 2: ReceivablesController**（只读，打开权限即看金额，不脱敏）：
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Sales;

// 应收对账（算法5 只读报表）。有「应收对账」打开权限即授权看金额（财务报表本质是金额，不逐列脱敏）。
[ApiController]
[Authorize]
[Route("api/receivables")]
public sealed class ReceivablesController(ReceivablesService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "应收对账";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "客户编号")] string? 客户编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(客户编号));
    }
}
```

- [ ] **Step 3: DI** — `Program.cs` 在 Sales 服务注册处追加：
```csharp
builder.Services.AddScoped<ErpApi.Features.Sales.SalesReceiptService>();
builder.Services.AddScoped<ErpApi.Features.Sales.ReceivablesService>();
```
（`SalesReceiptService` 若 Task1 未注册则此处补；确保两者都注册。）

- [ ] **Step 4: DbTest** `tests/ErpApi.Tests/ReceivablesServiceDbTests.cs`（造客户 P6BR1 的 出货100+退货10+收款30 全审核 → 应收余额=60；未审核不计）：
```csharp
using Dapper;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReceivablesServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task 应收余额_出货减收款减退货()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string cust = "P6BR1";
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [销售出货明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售出货单] WHERE [单号] IN ('RVS1')");
            c.Execute("DELETE FROM [销售退货明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售退货单] WHERE [单号] IN ('RVT1')");
            c.Execute("DELETE FROM [销售收款明细单] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [销售收款单] WHERE [单号] IN ('RVK1')");
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=@cust", new { cust });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P6BM1'");
        }
        Clean();
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(@cust,N'对账客户')", new { cust });
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'P6BM1') INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'P6BM1',N'成品乙')");
        try
        {
            // 出货 100（审核）
            c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES('RVS1',N'仓',@cust,N'对账客户',10,100,'1')", new { cust });
            c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES('RVS1',N'仓',@cust,N'对账客户',N'P6BM1',N'成品乙',10,10,100)", new { cust });
            // 退货 10（审核）
            c.Execute("INSERT INTO [销售退货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES('RVT1',N'仓',@cust,N'对账客户',1,10,'1')", new { cust });
            c.Execute("INSERT INTO [销售退货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[数量],[单价],[金额]) VALUES('RVT1',N'仓',@cust,N'对账客户',N'P6BM1',N'成品乙',1,10,10)", new { cust });
            // 收款 30（审核）
            c.Execute("INSERT INTO [销售收款单]([单号],[金额],[审核]) VALUES('RVK1',30,'1')");
            c.Execute("INSERT INTO [销售收款明细单]([单号],[客户编号],[客户名称],[收款金额]) VALUES('RVK1',@cust,N'对账客户',30)", new { cust });

            var rows = await new ReceivablesService(Factory()).ListAsync(cust);
            Assert.Single(rows);
            Assert.Equal(100m, rows[0].出货金额);
            Assert.Equal(30m, rows[0].收款金额);
            Assert.Equal(10m, rows[0].退货金额);
            Assert.Equal(60m, rows[0].应收余额);  // 100 - 30 - 10
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 5: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Sales/ReceivablesService.cs src/ErpApi/Features/Sales/ReceivablesController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/ReceivablesServiceDbTests.cs
git commit -m "feat(P6): 应收对账(算法5:出货-收款-退货 按客户·JOIN单头审核·打开即看)+DbTest"
```

---

## Task 3: 销售收款 Controller + 权限种子 + API 集成测试

**Files:** Create `src/ErpApi/Features/Sales/SalesReceiptController.cs`；Create `db/seed_p6b_perms.sql`；Create `tests/ErpApi.Tests/P6bReceiptsApiIntegrationTests.cs`.

- [ ] **Step 1: SalesReceiptController**（仿 P6a `SalesShipmentController`：api/sales-receipts、Menu 销售收款、Table 销售收款单；无 SyncLineApprovalAsync；**成本保密按 `金额` 权限**剥离 货款金额/收款金额/应收金额）：
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Sales;

[ApiController]
[Authorize]
[Route("api/sales-receipts")]
public sealed class SalesReceiptController(
    SalesReceiptService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "销售收款";
    private const string Table = "销售收款单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
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
        if (!await AllowAsync(PermissionAction.金额))
            foreach (var l in d.明细) { l.货款金额 = null; l.收款金额 = null; l.应收金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SalesReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "客户不存在。" }); }
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
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 2: 权限种子** `db/seed_p6b_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'销售收款',N'应收对账');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'销售收款',1,1,1,1,1,1,1,1,1),
       (@用户,N'应收对账',1,0,0,1,0,1,0,0,1);
```

- [ ] **Step 3: API 集成测试** `tests/ErpApi.Tests/P6bReceiptsApiIntegrationTests.cs`（仿 `P6aSalesApiIntegrationTests`）：①收款无保存权限 Create→403；②收款全权限 create→approve→删已审核 409→unapprove→delete；③收款缺 `金额` 权限 Get→货款/收款/应收金额 null（有则非 null）；④应收对账 无打开权限→403、有打开→200 返回行（造一客户出货+收款 验证应收余额）。seed 客户资料 FK；`SeedPerms` 含 金额 列（现有 P5c/P6a SeedPerms 用部分列插入；如需 金额 位，扩列或内联种子）。清理删单据/客户/权限。

- [ ] **Step 4: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Sales/SalesReceiptController.cs db/seed_p6b_perms.sql tests/ErpApi.Tests/P6bReceiptsApiIntegrationTests.cs
git commit -m "feat(P6): 销售收款REST(成本保密按金额权限)+应收对账权限种子+API集成测试"
```

---

## Task 4: 前端 — 销售收款页 + 应收对账页

**Files:** Modify `web/src/api/sales.ts`、`web/src/App.tsx`、`web/src/pages/MainLayout.tsx`；Create `web/src/pages/sales/SalesReceiptPage.tsx`、`web/src/pages/sales/ReceivablesPage.tsx`；Modify/Create `web/src/__tests__/sales.test.ts`(+收款合计断言).

- [ ] **Step 1: api 追加** `web/src/api/sales.ts`：`salesReceiptApi`(list/get/create/remove/approve/unapprove)、`receivablesApi.list(客户编号?)` + 类型 `SK*`(收款,明细 客户编号/客户名称/收款金额) 与 `ReceivableRow`(客户编号/客户名称/出货金额/收款金额/退货金额/应收余额)。
- [ ] **Step 2: 收款页** `SalesReceiptPage.tsx`（仿 `SalesShipmentPage`：列表+新建抽屉，明细=客户(编号/名称)+收款金额；审核/反审核/删除；金额列按 `can('销售收款','金额')` 显隐）。
- [ ] **Step 3: 应收对账页** `ReceivablesPage.tsx`（只读报表：客户编号/客户名称/出货金额/收款金额/退货金额/应收余额，可选客户筛选 Input；应收余额>0 红色；`receivablesApi.list`）。
- [ ] **Step 4: 菜单+路由** — `MainLayout` 的 `saleChildren` 追加 `销售收款`(`can('销售收款','打开')`,图标如 `MoneyCollectOutlined`/`AccountBookOutlined`)、`应收对账`(`can('应收对账','打开')`,图标 `ReconciliationOutlined`)；`App.tsx` 加路由 `/sales-receipts`、`/receivables`；Header 标题链补。（图标若未引入则加到 `@ant-design/icons` import。）
- [ ] **Step 5: util 测试** `sales.test.ts` 加 `sumReceipt`(Σ收款金额) 或复用 `sumAmount`——加一条收款合计断言（如新增 util）。
- [ ] **Step 6: 构建+测试+Commit** — `npm --prefix web run build`(无TS错)；`npm --prefix web run test -- --run`(全过)；`git add web/src && git commit -m "feat(P6): 销售收款页+应收对账页+菜单+api+util测试"`

---

## Task 5: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：收款服务/控制器纯应收不碰库存、无 SyncLineApprovalAsync、成本保密按金额权限；应收对账只读打开权限；零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p6b_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆（erp-status 加 P6b 条目，标注 P6c 付款+应付对账 为下一步）。

---

## Self-Review

- **Spec 覆盖**：收款DTOs+Service+DbTest(T1)、应收对账Service+Controller+DbTest(T2)、收款Controller+权限种子+API测试(T3)、前端收款页/对账页/菜单(T4)、回归收尾(T5)。客户级挂账、只建销售收款、算法5应收、打开即看金额、半成品式单头审核无同步、不碰库存不锁期、零改表——均落实。✓
- **占位符**：DTOs/收款Service/应收对账Service/Controller/两个DbTest/收款Controller/权限种子为完整代码；API集成测试与前端页给明确结构+样板引用(P6a同构)。✓
- **类型/命名一致**：DocType 销售收款单；前缀 XK；Menu 销售收款/应收对账;路由 api/sales-receipts、api/receivables；DTO SalesReceipt*/ReceivableRow；收款成本保密按 `金额` 权限(无单价列);应收对账打开权限不脱敏。✓
- **关键坑**：收款明细无审核列→无SyncLineApprovalAsync(应收对账JOIN单头审核);算法5三段UNION符号法ISNULL;客户FK547→400;UPDLOCK删除守卫;应收=出货−收款−退货;不接periodLock;ErpApi占用先Stop-Process。✓
