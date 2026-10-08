using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;
using ErpApi.Integrations.Paiji;

// 塑胶入仓单(加工入仓单)审核后自动生成目标仓入仓单的 DB 测试。
[Collection("db")]
public class PlasticReceiptWarehouseGenDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator(),
        new PaijiPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PaijiPushService>.Instance));

    private static PlasticReceiptCreateDto Dto(string 仓库) => new()
    {
        供应商编号 = null, 供应商名称 = "供WH", 仓库 = 仓库, 订单单号 = "SO-WH-TEST",
        明细 =
        [
            new PlasticReceiptCreateLineDto { 物料编号 = "WHP01", 物料名称 = "加工件A", 规格 = "规A", 单位 = "pcs", 数量 = 10, 单价 = 5, 塑胶货号 = "H-A", 款号 = "K1", 生产单号 = "MO-WH-1" },
            new PlasticReceiptCreateLineDto { 物料编号 = "WHP02", 物料名称 = "加工件B", 单位 = "pcs", 数量 = 20, 单价 = 6, 塑胶货号 = "H-B", 款号 = "K2" },
        ]
    };

    private static void Seed(Microsoft.Data.SqlClient.SqlConnection c)
    {
        CleanMasters(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'WHP01',N'加工件A',N'pcs')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'WHP02',N'加工件B',N'pcs')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K1',N'测试款1')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'K2',N'测试款2')");
    }

    private static void CleanMasters(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'WHP01',N'WHP02')");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] IN (N'K1',N'K2')");
    }

    private static void Clean(Microsoft.Data.SqlClient.SqlConnection c, string 单号)
    {
        foreach (var (h, d) in new[] { ("半成品入仓单", "半成品入仓明细单"), ("成品入仓单", "成品入仓明细单") })
        {
            var nos = c.Query<string>($"SELECT [单号] FROM [{h}] WHERE [来源单号]=@n", new { n = 单号 }).ToList();
            foreach (var no in nos)
            {
                c.Execute($"DELETE FROM [{d}] WHERE [单号]=@no", new { no });
                c.Execute($"DELETE FROM [{h}] WHERE [单号]=@no", new { no });
            }
        }
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@n", new { n = 单号 });
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@n", new { n = 单号 });
        CleanMasters(c);
    }

    [SkippableFact]
    public async Task Approve_semi_warehouse_generates_unapproved_semi_receipt()
    {
        using var c = fx.Open();
        Seed(c);
        var 单号 = await Svc().CreateAsync(Dto("半成品仓"), "tester");
        try
        {
            var 结果 = await Svc().GenerateWarehouseReceiptAsync(单号, "tester");
            Assert.NotNull(结果);
            Assert.StartsWith("半成品入仓单 BCP", 结果);
            var 生成单号 = 结果!.Split(' ')[1];
            var h = c.QuerySingle<(string 审核, string? 来源单号, decimal 数量, decimal 金额, string 仓库)>(
                "SELECT ISNULL([审核],'0') AS 审核,[来源单号],[数量],[金额],[仓库] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 生成单号 });
            Assert.Equal("0", h.审核);
            Assert.Equal(单号, h.来源单号);
            Assert.Equal(30m, h.数量);
            Assert.Equal(170m, h.金额);
            Assert.Equal("半成品仓", h.仓库);
            var lines = c.Query<(string? 物料编号, decimal 数量, string? 货号, string? 生产单号, string? 订单单号)>(
                "SELECT [物料编号],[数量],[货号],[生产单号],[订单单号] FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 生成单号 }).ToList();
            Assert.Equal(2, lines.Count);
            var l1 = Assert.Single(lines, x => x.物料编号 == "WHP01");
            Assert.Equal(10m, l1.数量);
            Assert.Equal("H-A", l1.货号);
            Assert.Equal("MO-WH-1", l1.生产单号);
            Assert.Equal("SO-WH-TEST", l1.订单单号);
        }
        finally { Clean(c, 单号); }
    }

    [SkippableFact]
    public async Task Generate_twice_does_not_duplicate()
    {
        using var c = fx.Open();
        Seed(c);
        var 单号 = await Svc().CreateAsync(Dto("半成品仓"), "tester");
        try
        {
            var 第一次 = await Svc().GenerateWarehouseReceiptAsync(单号, "tester");
            var 第二次 = await Svc().GenerateWarehouseReceiptAsync(单号, "tester");
            Assert.Equal(第一次, 第二次);
            Assert.Equal(1, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓单] WHERE [来源单号]=@n", new { n = 单号 }));
        }
        finally { Clean(c, 单号); }
    }

    [SkippableFact]
    public async Task Unapprove_blocked_when_generated_receipt_audited_then_removes_when_not()
    {
        using var c = fx.Open();
        Seed(c);
        var 单号 = await Svc().CreateAsync(Dto("半成品仓"), "tester");
        try
        {
            var 结果 = await Svc().GenerateWarehouseReceiptAsync(单号, "tester");
            var 生成单号 = 结果!.Split(' ')[1];
            // 生成单已被仓库侧审核 → 阻断
            c.Execute("UPDATE [半成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 生成单号 });
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().RemoveGeneratedReceiptIfUnapprovedAsync(单号));
            Assert.Contains(生成单号, ex.Message);
            Assert.Contains("已审核", ex.Message);
            // 生成单反审核后 → 一并删除
            c.Execute("UPDATE [半成品入仓单] SET [审核]='0' WHERE [单号]=@n", new { n = 生成单号 });
            await Svc().RemoveGeneratedReceiptIfUnapprovedAsync(单号);
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓单] WHERE [单号]=@n", new { n = 生成单号 }));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 生成单号 }));
        }
        finally { Clean(c, 单号); }
    }

    [SkippableFact]
    public async Task Plastic_warehouse_does_not_generate()
    {
        using var c = fx.Open();
        Seed(c);
        var 单号 = await Svc().CreateAsync(Dto("塑胶仓"), "tester");
        try
        {
            Assert.Null(await Svc().GenerateWarehouseReceiptAsync(单号, "tester"));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓单] WHERE [来源单号]=@n", new { n = 单号 }));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [成品入仓单] WHERE [来源单号]=@n", new { n = 单号 }));
            // 无生成单时反审核前处理直接放行
            await Svc().RemoveGeneratedReceiptIfUnapprovedAsync(单号);
        }
        finally { Clean(c, 单号); }
    }

    [SkippableFact]
    public async Task Approve_finished_warehouse_generates_unapproved_finished_receipt()
    {
        using var c = fx.Open();
        Seed(c);
        var 单号 = await Svc().CreateAsync(Dto("成品仓"), "tester");
        try
        {
            var 结果 = await Svc().GenerateWarehouseReceiptAsync(单号, "tester");
            Assert.NotNull(结果);
            Assert.StartsWith("成品入仓单 CR", 结果);
            var 生成单号 = 结果!.Split(' ')[1];
            var h = c.QuerySingle<(string 审核, string? 来源单号, decimal 数量, decimal 金额, string 仓库)>(
                "SELECT ISNULL([审核],'0') AS 审核,[来源单号],[数量],[金额],[仓库] FROM [成品入仓单] WHERE [单号]=@n", new { n = 生成单号 });
            Assert.Equal("0", h.审核);
            Assert.Equal(单号, h.来源单号);
            Assert.Equal(30m, h.数量);
            Assert.Equal(170m, h.金额);
            var lines = c.Query<(string? 货号, string? 名称, decimal 数量, string 审核)>(
                "SELECT [货号],[名称],[数量],ISNULL([审核],'0') AS 审核 FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 生成单号 }).ToList();
            Assert.Equal(2, lines.Count);
            var l1 = Assert.Single(lines, x => x.货号 == "H-A");
            Assert.Equal("加工件A", l1.名称);
            Assert.Equal("0", l1.审核);
        }
        finally { Clean(c, 单号); }
    }
}
