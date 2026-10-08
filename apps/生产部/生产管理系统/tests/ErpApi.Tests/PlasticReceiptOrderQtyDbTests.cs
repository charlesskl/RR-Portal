using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 塑胶入仓超订单数量拦截：保存(Create)+审核两道。口径=订单单号+物料编号+ISNULL(颜色,'')，只看已审核入仓明细。
// 订单单号 不存在于 塑胶采购订单(如指向加工单)时放行。
[Collection("db")]
public class PlasticReceiptOrderQtyDbTests(DbFixture fx)
{
    private const string 订单号 = "OQT-SR01";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator(),
        new PaijiPushService(new HttpClient(), Microsoft.Extensions.Options.Options.Create(new PaijiOptions()),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PaijiPushService>.Instance));
    private PostingEngine Engine() => new(Factory(), new AuditLogger());

    private static void SeedOrder(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [塑胶采购订单]([单号],[日期],[供应商名称],[数量],[审核]) VALUES(@no,GETDATE(),N'OQT供应商',100,N'1')", new { no = 订单号 });
        c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[物料编号],[物料名称],[颜色],[数量]) VALUES(@no,N'OQT-SRPM',N'OQT胶件',N'黑',100)", new { no = 订单号 });
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'OQT-SRPM'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [备注]=N'OQT测试'");
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号]=@no", new { no = 订单号 });
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号]=@no", new { no = 订单号 });
    }

    private static PlasticReceiptCreateDto Dto(decimal 数量, string? 行订单号 = 订单号, string? 头订单号 = null) => new()
    {
        供应商编号 = "S1", 供应商名称 = "OQT供应商", 仓库 = "塑胶仓", 备注 = "OQT测试", 订单单号 = 头订单号,
        明细 =
        [
            new PlasticReceiptCreateLineDto { 订单单号 = 行订单号, 物料编号 = "OQT-SRPM", 物料名称 = "OQT胶件", 颜色 = "黑", 单位 = "个", 数量 = 数量 },
        ]
    };

    [SkippableFact]
    public async Task Create_within_order_qty_passes()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        var 单号 = await Svc().CreateAsync(Dto(100), "tester");
        try
        {
            Assert.StartsWith("SR", 单号);
            Assert.Equal(1, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Create_over_order_qty_rejected()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        try
        {
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().CreateAsync(Dto(101), "tester"));
            Assert.Contains("超", ex.Message);
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [塑胶入仓单] WHERE [备注]=N'OQT测试'"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Header_order_no_fallback_is_validated()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        try
        {
            // 明细行 订单单号 空、回落单头：同样拦截
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().CreateAsync(Dto(101, 行订单号: null, 头订单号: 订单号), "tester"));
            Assert.Contains("超", ex.Message);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Unapproved_receipts_do_not_consume_quota_but_second_approve_is_blocked()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        var svc = Svc();
        var 单A = await svc.CreateAsync(Dto(60), "tester");
        var 单B = await svc.CreateAsync(Dto(50), "tester");
        try
        {
            Assert.True(await Engine().ApproveAsync("塑胶入仓单", 单A, "tester"));
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.ValidateOrderQtyAsync(单B));
            Assert.Contains("超", ex.Message);
            Assert.Contains(订单号, ex.Message);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Lines_without_order_or_pointing_to_process_order_pass()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        try
        {
            // 无订单单号：放行
            var 单1 = await Svc().CreateAsync(Dto(9999, 行订单号: null), "tester");
            Assert.StartsWith("SR", 单1);
            // 订单单号 指向加工单(不存在于 塑胶采购订单)：放行
            var 单2 = await Svc().CreateAsync(Dto(9999, 行订单号: "OQT-加工单"), "tester");
            Assert.StartsWith("SR", 单2);
        }
        finally { Clean(c); }
    }

    // 备品(供应商多送):备品行允许超订单入库;不计入订单已入仓累计(不顶欠数)。
    [SkippableFact]
    public async Task Spare_lines_over_receive_and_do_not_consume_order_quota()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        var svc = Svc();
        try
        {
            // 备品行(备品='1')超订单数量也放行,审核前校验同样放行
            var dtoA = Dto(20);
            dtoA.明细[0].备品 = "1";
            var 单A = await svc.CreateAsync(dtoA, "tester");
            await svc.ValidateOrderQtyAsync(单A);
            Assert.True(await Engine().ApproveAsync("塑胶入仓单", 单A, "tester"));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [塑胶入仓明细单] WHERE [单号]=@单A AND [备品]='1'", new { 单A }));

            // 备品不占订单额度:正单 100(=订购量)放行;若备品计入已入仓,20+100>100 会被拦
            var 单B = await svc.CreateAsync(Dto(100), "tester");
            Assert.True(await Engine().ApproveAsync("塑胶入仓单", 单B, "tester"));

            // 满额后再收 1 个(非备品)仍被拦:超量保护对正单不丢
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateAsync(Dto(1), "tester"));
            Assert.Contains("超", ex.Message);
        }
        finally { Clean(c); }
    }
}
