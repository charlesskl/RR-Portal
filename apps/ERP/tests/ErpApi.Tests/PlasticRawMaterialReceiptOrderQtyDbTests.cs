using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 原料入仓超订单数量拦截：保存(Create)+审核两道。原料入仓明细单 无 订单单号 列，订单号取单头；
// 口径=单头订单单号+原料编号，只看已审核入仓明细(同 PlasticRawMaterialPurchaseOrderService.ProgressAsync)。
[Collection("db")]
public class PlasticRawMaterialReceiptOrderQtyDbTests(DbFixture fx)
{
    private const string 订单号 = "OQT-YRC01";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());
    private PostingEngine Engine() => new(Factory(), new AuditLogger());

    private static void SeedOrder(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [原料采购订单]([单号],[供应商名称],[订购日期],[数量],[审核]) VALUES(@no,N'OQT供应商',GETDATE(),100,N'1')", new { no = 订单号 });
        c.Execute("INSERT INTO [原料采购订单明细]([单号],[原料编号],[原料名称],[单位],[订货数量]) VALUES(@no,N'OQT-PM',N'OQT-ABS粒',N'kg',100)", new { no = 订单号 });
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [原料编号]=N'OQT-PM'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [备注]=N'OQT测试'");
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [单号]=@no", new { no = 订单号 });
        c.Execute("DELETE FROM [原料采购订单] WHERE [单号]=@no", new { no = 订单号 });
    }

    private static PlasticRawMaterialReceiptCreateDto Dto(decimal 数量, string? 订单单号 = 订单号) => new()
    {
        供应商编号 = "S01", 供应商名称 = "OQT供应商", 单价类型 = "格式HK$/Lb", 订单单号 = 订单单号, 备注 = "OQT测试",
        明细 =
        {
            new() { 原料编号 = "OQT-PM", 原料名称 = "OQT-ABS粒", 单位 = "kg", 数量 = 数量 },
        }
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
            Assert.StartsWith("YRC", 单号);
            Assert.Equal(1, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [原料入仓明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Create_over_order_qty_rejected_and_nothing_written()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SeedOrder(c);
        try
        {
            // 本单同原料两行先汇总：60+50=110 > 100
            var dto = Dto(60);
            dto.明细.Add(new() { 原料编号 = "OQT-PM", 原料名称 = "OQT-ABS粒", 单位 = "kg", 数量 = 50 });
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().CreateAsync(dto, "tester"));
            Assert.Contains("超", ex.Message);
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [原料入仓单] WHERE [备注]=N'OQT测试'"));
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
        var 单B = await svc.CreateAsync(Dto(50), "tester");   // 未审核不占额度，保存放行
        try
        {
            Assert.True(await Engine().ApproveAsync("原料入仓单", 单A, "tester"));
            // 审核第二张时才被拒（Controller approve 端点调用的同一校验）
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.ValidateOrderQtyAsync(单B));
            Assert.Contains("超", ex.Message);
            Assert.Contains(订单号, ex.Message);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task No_order_no_or_unknown_order_passes()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        try
        {
            var 单1 = await Svc().CreateAsync(Dto(9999, 订单单号: null), "tester");
            Assert.StartsWith("YRC", 单1);
            var 单2 = await Svc().CreateAsync(Dto(9999, 订单单号: "OQT-不存在"), "tester");
            Assert.StartsWith("YRC", 单2);
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
            Assert.True(await Engine().ApproveAsync("原料入仓单", 单A, "tester"));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [原料入仓明细单] WHERE [单号]=@单A AND [备品]='1'", new { 单A }));

            // 备品不占订单额度:正单 100(=订货量)放行;若备品计入已入仓,20+100>100 会被拦
            var 单B = await svc.CreateAsync(Dto(100), "tester");
            Assert.True(await Engine().ApproveAsync("原料入仓单", 单B, "tester"));

            // 满额后再收 1 个(非备品)仍被拦:超量保护对正单不丢
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateAsync(Dto(1), "tester"));
            Assert.Contains("超", ex.Message);
        }
        finally { Clean(c); }
    }
}
