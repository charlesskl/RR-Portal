# P6a 销售出货 / 退货 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 建销售出货单+明细、销售退货单+明细（纯应收层，不碰库存、不算COGS、退货引用销售单号带出），为 P6b 应收对账备数据。

**Architecture:** 两个两层 Dapper 事务单据族（半成品式：审核仅单头、无 SyncLineApprovalAsync）；审核走引擎②；零改表（表/白名单/审核留痕列已就绪）；新「销售管理」菜单。不接 periodLock（销售类不在月结库存口径）。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p6a-sales-shipment-design.md`。参考样板：`src/ErpApi/Features/Warehouse/Semi/SemiReceiptService.cs`(+Controller)、`SemiStocktakeService.BasisAsync`。

---

## Task 1: 销售出货 DTOs + Service + DbTest

**Files:** Create `src/ErpApi/Features/Sales/SalesDtos.cs`, `src/ErpApi/Features/Sales/SalesShipmentService.cs`；Test `tests/ErpApi.Tests/SalesShipmentServiceDbTests.cs`.

- [ ] **Step 1: DTOs（出货+退货都先放这，退货 DTO 供 Task 2 用）**

`src/ErpApi/Features/Sales/SalesDtos.cs`：
```csharp
namespace ErpApi.Features.Sales;

// ---- 销售出货 ----
public sealed class SalesShipmentLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SalesShipmentCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesShipmentLineDto> 明细 { get; set; } = [];
}
public sealed class SalesShipmentHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesShipmentLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 库存单价 { get; set; }
    public decimal? 库存金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesShipmentDetailDto
{ public SalesShipmentHeaderDto? 单头 { get; set; } public List<SalesShipmentLineRowDto> 明细 { get; set; } = []; }

// ---- 销售退货 ----
public sealed class SalesReturnLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SalesReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 销售单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 备注 { get; set; }
    public List<SalesReturnLineDto> 明细 { get; set; } = [];
}
public sealed class SalesReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 销售单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReturnLineRowDto
{
    public long ID { get; set; }
    public string? 销售单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 库存单价 { get; set; }
    public decimal? 库存金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SalesReturnDetailDto
{ public SalesReturnHeaderDto? 单头 { get; set; } public List<SalesReturnLineRowDto> 明细 { get; set; } = []; }
public sealed class SalesReturnBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
}
```

- [ ] **Step 2: SalesShipmentService**

`src/ErpApi/Features/Sales/SalesShipmentService.cs`（仿 `SemiReceiptService`：两层事务、单头审核'0'、明细不写审核、金额=数量×单价、库存单价/金额=0、UPDLOCK 删除守卫）：
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 销售出货（纯应收层，不进库存账本）。两层：销售出货单 + 销售出货明细单(单号 主从)。审核仅单头(明细无审核列)。
// 金额=数量×单价(售价/应收)；库存单价/金额(COGS)本期留 0。
public sealed class SalesShipmentService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "销售出货单";
    public const string Prefix = "XS";

    public async Task<string> CreateAsync(SalesShipmentCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("销售出货至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [销售出货单]([单号],[日期],[客户编号],[客户名称],[付款方式],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@客户编号,@客户名称,@付款方式,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.客户编号, dto.客户名称, dto.付款方式, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [销售出货明细单]([单号],[日期],[客户编号],[客户名称],[仓库],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注])
VALUES(@单号,@日期,@客户编号,@客户名称,@仓库,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,0,0,@单价,@金额,@备注)",
                new
                {
                    单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库,
                    l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.数量,
                    单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SalesShipmentHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [销售出货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[客户编号],[客户名称],[付款方式],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [销售出货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SalesShipmentHeaderDto>()).AsList();
        return new PagedResult<SalesShipmentHeaderDto>(items, total);
    }

    public async Task<SalesShipmentDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[客户编号],[客户名称],[付款方式],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [销售出货单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注] FROM [销售出货明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SalesShipmentHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SalesShipmentLineRowDto>()).AsList();
        return new SalesShipmentDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [销售出货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的销售出货单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [销售出货明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [销售出货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/SalesShipmentServiceDbTests.cs`（仿 `SemiStocktakeServiceDbTests`：seed 客户资料 FK；建单断言金额合计=数量×单价；删除护栏）：
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesShipmentServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SalesShipmentService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_金额合计_then_删除护栏()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6AC1') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6AC1',N'P6A客户')");
        string? no = null;
        try
        {
            no = await Svc().CreateAsync(new SalesShipmentCreateDto
            {
                仓库 = "P6A仓", 客户编号 = "P6AC1", 客户名称 = "P6A客户",
                明细 = [
                    new SalesShipmentLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 10, 单价 = 8 },
                    new SalesShipmentLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "L", 颜色 = "白", 单位 = "件", 数量 = 5, 单价 = 8 },
                ]
            }, "tester");
            Assert.StartsWith("XS", no);
            var h = c.QueryFirst<(decimal 数量, decimal 金额)>("SELECT [数量],[金额] FROM [销售出货单] WHERE [单号]=@no", new { no });
            Assert.Equal(15m, h.数量);
            Assert.Equal(120m, h.金额);  // 10*8 + 5*8

            // 审核后不可删
            c.Execute("UPDATE [销售出货单] SET [审核]='1' WHERE [单号]=@no", new { no });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(no!));
            c.Execute("UPDATE [销售出货单] SET [审核]='0' WHERE [单号]=@no", new { no });
            Assert.True(await Svc().DeleteAsync(no!));
            no = null;
        }
        finally
        {
            if (no != null) { c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]=@no", new { no }); c.Execute("DELETE FROM [销售出货单] WHERE [单号]=@no", new { no }); }
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6AC1'");
        }
    }
}
```

- [ ] **Step 4: 测试（绿）** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter SalesShipmentServiceDbTests`（过）；全量（152）。
- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Sales tests/ErpApi.Tests/SalesShipmentServiceDbTests.cs && git commit -m "feat(P6): 销售出货服务(两层事务·纯应收·金额=数量×单价·审核仅单头)+DbTest"`

---

## Task 2: 销售退货 Service（+BasisAsync）+ DbTest

**Files:** Create `src/ErpApi/Features/Sales/SalesReturnService.cs`；Test `tests/ErpApi.Tests/SalesReturnServiceDbTests.cs`.

- [ ] **Step 1: SalesReturnService**（同出货模式 + `销售单号` + `BasisAsync`）：
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 销售退货（纯应收逆向，不进库存账本）。两层：销售退货单 + 销售退货明细单(单号 主从)，带 销售单号 引用原出货。审核仅单头。
public sealed class SalesReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "销售退货单";
    public const string Prefix = "XR";

    // 从原销售出货单带出明细作退货基准（首版不做累计已退校验）
    public async Task<IReadOnlyList<SalesReturnBasisRow>> BasisAsync(string 销售单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<SalesReturnBasisRow>(@"
SELECT [物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价]
FROM [销售出货明细单] WHERE [单号]=@销售单号 ORDER BY [ID]", new { 销售单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(SalesReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("销售退货至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [销售退货单]([单号],[销售单号],[日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@销售单号,@日期,@客户编号,@客户名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.销售单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [销售退货明细单]([单号],[销售单号],[日期],[客户编号],[客户名称],[仓库],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注])
VALUES(@单号,@销售单号,@日期,@客户编号,@客户名称,@仓库,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,0,0,@单价,@金额,@备注)",
                new
                {
                    单号, dto.销售单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库,
                    l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.数量,
                    单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SalesReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [销售退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw OR [销售单号] LIKE @kw;
SELECT [ID],[单号],[销售单号],[客户编号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [销售退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw OR [销售单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SalesReturnHeaderDto>()).AsList();
        return new PagedResult<SalesReturnHeaderDto>(items, total);
    }

    public async Task<SalesReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[销售单号],[客户编号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [销售退货单] WHERE [单号]=@单号;
SELECT [ID],[销售单号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注] FROM [销售退货明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SalesReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SalesReturnLineRowDto>()).AsList();
        return new SalesReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [销售退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的销售退货单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [销售退货明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [销售退货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 2: DbTest** `tests/ErpApi.Tests/SalesReturnServiceDbTests.cs`：建一张销售出货（或直接插一张 销售出货单+明细 作基准源）→ `BasisAsync(销售单号)` 带出明细断言；建退货引用该销售单号断言金额合计；删除护栏。seed 客户资料 FK；清理删明细/单头/客户。结构仿 Task1 测试 + `SemiStocktakeServiceDbTests` 的 Basis 断言。
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesReturnServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Basis_带出原销售明细_then_建退货()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6AC2') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6AC2',N'P6A退客')");
        // 造一张销售出货作基准源
        c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(N'XSBASE1',N'P6A仓',N'P6AC2',N'P6A退客',10,80,'1')");
        c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额]) VALUES(N'XSBASE1',N'P6A仓',N'P6AC2',N'P6A退客',N'P6AM1',N'成品甲',N'M',N'黑',N'件',10,8,80)");
        var svc = new SalesReturnService(Factory(), new DocumentNumberGenerator());
        string? rno = null;
        try
        {
            var basis = await svc.BasisAsync("XSBASE1");
            Assert.Single(basis);
            Assert.Equal(10m, basis[0].数量);
            Assert.Equal(8m, basis[0].单价);

            rno = await svc.CreateAsync(new SalesReturnCreateDto
            {
                仓库 = "P6A仓", 销售单号 = "XSBASE1", 客户编号 = "P6AC2", 客户名称 = "P6A退客",
                明细 = [ new SalesReturnLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 3, 单价 = 8 } ]
            }, "tester");
            Assert.StartsWith("XR", rno);
            var h = c.QueryFirst<(decimal 数量, decimal 金额, string 销售单号)>("SELECT [数量],[金额],[销售单号] FROM [销售退货单] WHERE [单号]=@no", new { no = rno });
            Assert.Equal(3m, h.数量);
            Assert.Equal(24m, h.金额);
            Assert.Equal("XSBASE1", h.销售单号);
        }
        finally
        {
            if (rno != null) { c.Execute("DELETE FROM [销售退货明细单] WHERE [单号]=@no", new { no = rno }); c.Execute("DELETE FROM [销售退货单] WHERE [单号]=@no", new { no = rno }); }
            c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]='XSBASE1'");
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]='XSBASE1'");
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6AC2'");
        }
    }
}
```

- [ ] **Step 3: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Sales/SalesReturnService.cs tests/ErpApi.Tests/SalesReturnServiceDbTests.cs
git commit -m "feat(P6): 销售退货服务(引用销售单号+BasisAsync带出原明细)+DbTest"
```

---

## Task 3: 控制器 + DI + 权限种子 + API 集成测试

**Files:** Create `src/ErpApi/Features/Sales/SalesShipmentController.cs`, `SalesReturnController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p6a_perms.sql`；Create `tests/ErpApi.Tests/P6aSalesApiIntegrationTests.cs`.

- [ ] **Step 1: SalesShipmentController**（仿 `SemiStocktakeController`，无 SyncLineApprovalAsync）：
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Sales;

// 销售出货 REST（纯应收，不进库存账本）。审核仅翻单头(明细无审核列)，无 SyncLineApprovalAsync。缺单价权限剥离金额列。
[ApiController]
[Authorize]
[Route("api/sales-shipments")]
public sealed class SalesShipmentController(
    SalesShipmentService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "销售出货";
    private const string Table = "销售出货单";
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
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; l.库存单价 = null; l.库存金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SalesShipmentCreateDto dto)
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

- [ ] **Step 2: SalesReturnController** — 同上结构（`api/sales-returns`、Menu `销售退货`、Table `销售退货单`、svc=SalesReturnService），**额外加 Basis 端点**：
```csharp
    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "销售单号")] string 销售单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.BasisAsync(销售单号);
        // basis 含单价：缺单价权限则剥离
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) r.单价 = null;
        return Ok(rows);
    }
```
（Get 剥离同出货：单价/金额/库存单价/库存金额。`BasisAsync` 返回 `IReadOnlyList<SalesReturnBasisRow>`，剥离 `单价` 需可写——`SalesReturnBasisRow.单价` 是可写属性，可直接置 null。）

- [ ] **Step 3: DI** — `Program.cs` 在 MonthEnd/PeriodLock 注册附近追加：
```csharp
builder.Services.AddScoped<ErpApi.Features.Sales.SalesShipmentService>();
builder.Services.AddScoped<ErpApi.Features.Sales.SalesReturnService>();
```

- [ ] **Step 4: 权限种子** `db/seed_p6a_perms.sql`：
```sql
-- 开发用：给某用户授予 P6a 销售出货/退货 菜单权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'销售出货',N'销售退货');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'销售出货',1,1,1,1,1,1,1,1,1),
       (@用户,N'销售退货',1,1,1,1,1,1,1,1,1);
```
（部署：`dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p6a_perms.sql"`；测试库由集成测试自种权限。）

- [ ] **Step 5: API 集成测试** `tests/ErpApi.Tests/P6aSalesApiIntegrationTests.cs`（仿 `P5cApiIntegrationTests`：`WebApplicationFactory<Program>`、JWT、SeedPerms、Client）。覆盖：①无保存权限 Create→403；②全权限生命周期 出货 create→approve→（删已审核 409）→unapprove→delete；③缺单价权限 Get→单价/金额/库存单价/库存金额 null（有则非 null）；④退货 引用销售单号 + basis 带出。seed 客户资料 FK；清理删明细/单头/客户/权限。

- [ ] **Step 6: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Sales src/ErpApi/Program.cs db/seed_p6a_perms.sql tests/ErpApi.Tests/P6aSalesApiIntegrationTests.cs
git commit -m "feat(P6): 销售出货/退货REST(审核引擎②无明细同步·成本保密)+DI+权限种子+API集成测试"
```

---

## Task 4: 前端 — 销售管理菜单 + 出货/退货页

**Files:** Create `web/src/api/sales.ts`、`web/src/pages/sales/SalesShipmentPage.tsx`、`web/src/pages/sales/SalesReturnPage.tsx`、`web/src/utils/salesLines.ts`、`web/src/__tests__/sales.test.ts`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api 客户端** `web/src/api/sales.ts`（仿 `web/src/api/semi.ts`）：`salesShipmentApi`(list/get/create/remove/approve/unapprove)、`salesReturnApi`(+basis) + 类型 `SS*/SR*`（明细 物料编号/规格/颜色/单位/数量/单价/金额）。`import { api } from "./client"; import type { Paged } from "./master";`。
- [ ] **Step 2: 工具 + 单测** `web/src/utils/salesLines.ts`：`sumQty(lines)`、`sumAmount(lines)`(Σ数量×单价)、`validLines(lines)`(过滤数量≤0)。`web/src/__tests__/sales.test.ts` 断言（仿 `finished.test.ts`）。
- [ ] **Step 3: 页面**（仿成品/半成品单据页：列表 Card + 新建抽屉 + 明细表 物料编号/规格/颜色/单位/数量/单价/金额 + 审核/反审核/删除按钮，按 `usePerms` 控权与金额列显隐）。退货页加"引用销售单号→basis 带出明细"。可复用现有单据页组件思路。
- [ ] **Step 4: 路由 + 菜单** — `App.tsx` import 两页 + 路由 `/sales-shipments`、`/sales-returns`；`MainLayout` 新增独立组 **「销售管理」**(key `sale`，图标如 `ShoppingCartOutlined`/`RollbackOutlined`)：销售出货(`can('销售出货','打开')`)、销售退货(`can('销售退货','打开')`)；Header 标题链补 `/sales-shipments`→销售出货、`/sales-returns`→销售退货。
- [ ] **Step 5: 构建 + 测试** — `npm --prefix web run build`（无 TS 错误）；`npm --prefix web run test -- --run`（全过）。
- [ ] **Step 6: Commit** — `git add web/src && git commit -m "feat(P6): 销售管理菜单+销售出货/退货前端页面+api+工具单测"`

---

## Task 5: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`（全过）；前端 test+build（全过）。
- [ ] **Step 2: 终审** — diff 核对：Sales 服务/控制器纯应收不碰库存账本、无 SyncLineApprovalAsync、成本保密齐全、不接 periodLock；零改表。
- [ ] **Step 3: 授权种子 + API 冒烟（可选）** — `seed_p6a_perms.sql` 部署 erp；起后端用 `tmp/smoke_p4` 改销售出货 create→approve→查询验证（或 puppeteer 截图）。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆（erp-status 加 P6a 条目，标注 P6b 应收对账为下一步）。

---

## Self-Review

- **Spec 覆盖**：出货服务+DbTest(T1)、退货服务+Basis+DbTest(T2)、双控制器+DI+权限种子+API测试(T3)、前端菜单/页/api/util(T4)、回归收尾(T5)。纯应收不碰库存、审核仅单头无同步、不算COGS(库存单价/金额=0)、退货引用销售单号带出、成本保密、零改表、不接periodLock——均落实。✓
- **占位符**：服务/DTOs/出货控制器/出货DbTest/退货服务/退货DbTest/DI/权限种子为完整代码；退货控制器=出货控制器同构+Basis端点(给出)；API集成测试与前端页给出明确结构+样板引用(P5c测试/semi页)，属"按既有同构模式套用"。✓
- **类型/命名一致**：DocType 销售出货单/销售退货单；前缀 XS/XR；Menu 销售出货/销售退货；路由 api/sales-shipments、api/sales-returns(+basis)；DTO SalesShipment*/SalesReturn*；成本保密剥离 单价/金额/库存单价/库存金额。✓
- **关键坑**：明细无审核列→无SyncLineApprovalAsync(P6b 应收 JOIN 单头审核)；纯应收不进库存账本；客户FK 547→400；UPDLOCK删除守卫；金额=数量×单价服务端算；库存单价/金额=0;不接periodLock;ErpApi占用先Stop-Process。✓
