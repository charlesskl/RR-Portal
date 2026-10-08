using Dapper;
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.MaterialStocktake;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private MaterialStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()), new NoOpAuditLogger());

    private sealed class NoOpAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            Microsoft.Data.SqlClient.SqlConnection conn, Microsoft.Data.SqlClient.SqlTransaction? tx = null)
            => Task.CompletedTask;
    }

    private sealed class AuxiliaryQueryPermissionService(bool allowOpen, bool allowUnitPrice) : IPermissionService
    {
        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName) =>
            Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());

        public Task<bool> HasAsync(string userName, string menu, PermissionAction action) =>
            Task.FromResult(menu == "辅料盘点查询" && action switch
            {
                PermissionAction.打开 => allowOpen,
                PermissionAction.单价 => allowUnitPrice,
                _ => false,
            });
    }

    private AuxiliaryStocktakeQueryController AuxiliaryController(
        bool allowOpen = true,
        bool allowUnitPrice = false) => new(
        Svc(),
        new AuxiliaryQueryPermissionService(allowOpen, allowUnitPrice))
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "tester")], "test"))
            }
        }
    };

    private static void SeedStock(Microsoft.Data.SqlClient.SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价],[库存]) VALUES(N'PDM01',N'盘点料',N'规格A',N'米',10,100)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PDRK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PDRK01',N'物料仓',N'PDM01',N'盘点料',N'规格A',N'米',100)");
    }
    // 辅料仓库账面 30：系统数量服务端按台账复算(口径同 BasisAsync),辅料仓单据的落库系统数量以此为准
    private static void SeedAuxiliaryStock(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'PDRK02',N'辅料仓库','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PDRK02',N'辅料仓库',N'PDM01',N'盘点料',N'规格A',N'米',30)");
    }
    private static void Cleanup(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号]=N'PDM01'");
        c.Execute("DELETE FROM [盘点单] WHERE [单号] LIKE N'PD%' AND [仓库]=N'物料仓' AND [单号] NOT LIKE N'PDRK%'");
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'PDM01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'PDRK01',N'PDRK02')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDM01'");
    }

    [SkippableFact]
    public async Task Basis_returns_system_qty()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        try
        {
            var basis = await Svc().BasisAsync("物料仓");
            var row = Assert.Single(basis, b => b.物料编号 == "PDM01");
            Assert.Equal(100m, row.系统数量);
            Assert.Equal("米", row.单位);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_computes_盈亏_and_GetReadsBack()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");
            Assert.StartsWith("PD", pd);
            Assert.Equal(-20m, c.ExecuteScalar<decimal>(
                "SELECT CAST([盈亏数量] AS decimal(18,4)) FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }));
            var detail = await Svc().GetAsync(pd);
            var line = Assert.Single(detail!.明细);
            Assert.Equal(100m, line.系统数量);
            Assert.Equal(80m, line.盘点数量);
            Assert.Equal(-20m, line.盈亏数量);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_uses_requested_date_for_header_and_detail()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        var requestedDate = new DateTime(2026, 7, 9);
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                日期 = requestedDate,
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");

            Assert.StartsWith("PD20260709", pd);
            Assert.Equal(requestedDate.Date, c.ExecuteScalar<DateTime>(
                "SELECT CAST([日期] AS date) FROM [盘点单] WHERE [单号]=@n", new { n = pd }).Date);
            Assert.Equal(requestedDate.Date, c.ExecuteScalar<DateTime>(
                "SELECT CAST([日期] AS date) FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }).Date);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task StocktakeQuery_detail_and_summary_carry_盈亏_and_金额()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            // 系统100 盘点80 → 盈亏-20；物料资料单价10 → 金额=盈亏×单价=-200
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");

            var detail = await Svc().StocktakeQueryDetailAsync(null, null, "PDM01", null, null);
            var dr = Assert.Single(detail, r => r.单号 == pd);
            Assert.Equal(100m, dr.系统数量);
            Assert.Equal(80m, dr.盘点数量);
            Assert.Equal(-20m, dr.盈亏数量);
            Assert.Equal(10m, dr.单价);
            Assert.Equal(-200m, dr.金额);
            Assert.Equal("规格A", dr.规格);

            var summary = await Svc().StocktakeQuerySummaryAsync(null, null, "PDM01", null, null);
            var sr = Assert.Single(summary, r => r.物料编号 == "PDM01" && r.规格 == "规格A");
            Assert.Equal(-20m, sr.盈亏数量);
            Assert.Equal(-200m, sr.金额);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    // 系统数量服务端复算:DTO 传入值不可信(防篡改),落库值=台账实时聚合(口径同 BasisAsync)
    [SkippableFact]
    public async Task Create_recomputes_系统数量_from_ledger_ignoring_dto()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 9999, 盘点数量 = 80 } ]
            }, "tester");
            var line = Assert.Single((await Svc().GetAsync(pd))!.明细);
            Assert.Equal(100m, line.系统数量);   // 忽略 DTO 传入的 9999
            Assert.Equal(80m, line.盘点数量);
            Assert.Equal(-20m, line.盈亏数量);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task StocktakeQuery_filters_detail_and_summary_by_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        SeedAuxiliaryStock(c);
        string? auxiliaryNo = null;
        string? otherNo = null;
        try
        {
            var line = new MaterialStocktakeLineDto
            {
                物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                系统数量 = 30, 盘点数量 = 25
            };
            auxiliaryNo = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "辅料仓库",
                明细 = [line]
            }, "tester");
            otherNo = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "其他仓库",
                明细 = [line]
            }, "tester");

            var detail = await Svc().StocktakeQueryDetailAsync(null, null, "PDM01", null, null, "辅料仓库");
            Assert.NotEmpty(detail);
            Assert.All(detail, row => Assert.Equal(auxiliaryNo, row.单号));

            var summary = await Svc().StocktakeQuerySummaryAsync(null, null, "PDM01", null, null, "辅料仓库");
            var row = Assert.Single(summary);
            Assert.Equal(30m, row.系统数量);
        }
        finally
        {
            if (auxiliaryNo != null)
            {
                c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = auxiliaryNo });
                c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = auxiliaryNo });
            }
            if (otherNo != null)
            {
                c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = otherNo });
                c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = otherNo });
            }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task AuxiliaryStocktakeQuery_get_reads_auxiliary_document_but_not_other_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? auxiliaryNo = null;
        string? otherNo = null;
        try
        {
            var line = new MaterialStocktakeLineDto
            {
                物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                系统数量 = 30, 盘点数量 = 25
            };
            auxiliaryNo = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "辅料仓库",
                明细 = [line]
            }, "tester");
            otherNo = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "其他仓库",
                明细 = [line]
            }, "tester");

            var controller = AuxiliaryController();
            var auxiliaryResult = Assert.IsType<OkObjectResult>(await controller.Get(auxiliaryNo));
            var auxiliary = Assert.IsType<MaterialStocktakeDetailDto>(auxiliaryResult.Value);
            Assert.Equal(auxiliaryNo, auxiliary.单头?.单号);
            Assert.Equal("辅料仓库", auxiliary.单头?.仓库);
            Assert.Single(auxiliary.明细);

            Assert.IsType<NotFoundResult>(await controller.Get(otherNo));
            Assert.IsType<NotFoundResult>(await controller.Get("missing-stocktake"));
        }
        finally
        {
            foreach (var number in new[] { auxiliaryNo, otherNo }.Where(number => number is not null))
            {
                c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = number });
                c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = number });
            }
            Cleanup(c);
        }
    }

    [Fact]
    public async Task AuxiliaryStocktakeQuery_get_forbids_without_open_permission()
    {
        var controller = AuxiliaryController(allowOpen: false);

        Assert.IsType<ForbidResult>(await controller.Get("PD001"));
    }

    [SkippableFact]
    public async Task AuxiliaryStocktakeQuery_applies_unit_price_permission_to_summary_and_detail()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        SeedAuxiliaryStock(c);
        string? stocktakeNo = null;
        try
        {
            stocktakeNo = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "辅料仓库",
                明细 = [new MaterialStocktakeLineDto
                {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 30, 盘点数量 = 25
                }]
            }, "tester");
            var controller = AuxiliaryController(allowUnitPrice: false);

            var detailResult = Assert.IsType<OkObjectResult>(await controller.Detail(keyword: "PDM01"));
            var detail = Assert.IsAssignableFrom<IReadOnlyList<MaterialStocktakeQueryDetailRow>>(detailResult.Value);
            var detailRow = Assert.Single(detail);
            Assert.Null(detailRow.单价);
            Assert.Null(detailRow.金额);

            var summaryResult = Assert.IsType<OkObjectResult>(await controller.Summary(keyword: "PDM01"));
            var summary = Assert.IsAssignableFrom<IReadOnlyList<MaterialStocktakeSummaryRow>>(summaryResult.Value);
            var summaryRow = Assert.Single(summary);
            Assert.Null(summaryRow.单价);
            Assert.Null(summaryRow.金额);

            var priceController = AuxiliaryController(allowUnitPrice: true);
            var pricedDetailResult = Assert.IsType<OkObjectResult>(await priceController.Detail(keyword: "PDM01"));
            var pricedDetail = Assert.IsAssignableFrom<IReadOnlyList<MaterialStocktakeQueryDetailRow>>(pricedDetailResult.Value);
            var pricedDetailRow = Assert.Single(pricedDetail);
            Assert.Equal(10m, pricedDetailRow.单价);
            Assert.Equal(-50m, pricedDetailRow.金额);

            var pricedSummaryResult = Assert.IsType<OkObjectResult>(await priceController.Summary(keyword: "PDM01"));
            var pricedSummary = Assert.IsAssignableFrom<IReadOnlyList<MaterialStocktakeSummaryRow>>(pricedSummaryResult.Value);
            var pricedSummaryRow = Assert.Single(pricedSummary);
            Assert.Equal(10m, pricedSummaryRow.单价);
            Assert.Equal(-50m, pricedSummaryRow.金额);
        }
        finally
        {
            if (stocktakeNo != null)
            {
                c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = stocktakeNo });
                c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = stocktakeNo });
            }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task StocktakeQuery_approval_filter_excludes_unapproved()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");
            // 新建即未审核：审核情况="已审核"应过滤掉，"未审核"应保留
            Assert.DoesNotContain(await Svc().StocktakeQueryDetailAsync(null, null, "PDM01", null, "已审核"), r => r.单号 == pd);
            Assert.Contains(await Svc().StocktakeQueryDetailAsync(null, null, "PDM01", null, "未审核"), r => r.单号 == pd);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Approve_writes_盘点数量_back_to_master_stock()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            // 主档库存100；盘点：系统100 盘成80
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");

            Assert.True(await Svc().ApproveAsync(pd, "tester"));
            Assert.Equal(80m, c.ExecuteScalar<decimal>(
                "SELECT [库存] FROM [物料资料] WHERE [物料编号]=N'PDM01'"));
            Assert.Equal("1", c.ExecuteScalar<string>(
                "SELECT [审核] FROM [盘点单] WHERE [单号]=@n", new { n = pd }));

            // 重复审核幂等：返回 false 且库存不变
            Assert.False(await Svc().ApproveAsync(pd, "tester"));
            Assert.Equal(80m, c.ExecuteScalar<decimal>(
                "SELECT [库存] FROM [物料资料] WHERE [物料编号]=N'PDM01'"));
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Unapprove_restores_master_stock_to_系统数量()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedStock(c);
        string? pd = null;
        try
        {
            pd = await Svc().CreateAsync(new MaterialStocktakeCreateDto
            {
                仓库 = "物料仓",
                明细 = [ new MaterialStocktakeLineDto {
                    物料编号 = "PDM01", 物料名称 = "盘点料", 规格 = "规格A", 单位 = "米",
                    系统数量 = 100, 盘点数量 = 80 } ]
            }, "tester");
            Assert.True(await Svc().ApproveAsync(pd, "tester"));
            Assert.Equal(80m, c.ExecuteScalar<decimal>(
                "SELECT [库存] FROM [物料资料] WHERE [物料编号]=N'PDM01'"));

            Assert.True(await Svc().UnapproveAsync(pd, "tester"));
            Assert.Equal(100m, c.ExecuteScalar<decimal>(
                "SELECT [库存] FROM [物料资料] WHERE [物料编号]=N'PDM01'"));
            Assert.Equal("0", c.ExecuteScalar<string>(
                "SELECT [审核] FROM [盘点单] WHERE [单号]=@n", new { n = pd }));

            // 重复反审核幂等：返回 false 且库存不变
            Assert.False(await Svc().UnapproveAsync(pd, "tester"));
            Assert.Equal(100m, c.ExecuteScalar<decimal>(
                "SELECT [库存] FROM [物料资料] WHERE [物料编号]=N'PDM01'"));
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [盘点单] WHERE [单号]=@n", new { n = pd }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new MaterialStocktakeCreateDto { 仓库 = "物料仓", 明细 = [] }, "tester"));
    }

    [SkippableFact]
    public async Task Create_rejects_blank_warehouse()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new MaterialStocktakeCreateDto { 仓库 = "", 明细 = [ new MaterialStocktakeLineDto { 物料编号 = "PDM01", 系统数量 = 1, 盘点数量 = 1 } ] }, "tester"));
    }
}
