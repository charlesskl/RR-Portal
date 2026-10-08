using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 采购入仓超订单数量拦截：保存(Create)+审核两道。口径=订单单号+物料编号+ISNULL(颜色,'')，只看已审核入仓明细。
[Collection("db")]
public class PurchaseReceiptOrderQtyDbTests(DbFixture fx)
{
    private const string 订单号 = "OQT-CG01";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());
    private PostingEngine Engine() => new(Factory(), new AuditLogger());

    private static void SeedOrder(SqlConnection c)
    {
        CleanOrder(c);
        c.Execute("INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[数量],[审核]) VALUES(@no,GETDATE(),N'P3S01',N'P3测试供应商',100,N'1')", new { no = 订单号 });
        c.Execute("INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量]) VALUES(@no,GETDATE(),N'P3M01',N'P3面料',N'红',N'米',100)", new { no = 订单号 });
    }

    private static void CleanOrder(SqlConnection c)
    {
        c.Execute(@"DELETE FROM [采购入仓明细单] WHERE [订单单号]=@no
                    OR [单号] IN (SELECT [单号] FROM [采购入仓单] WHERE [备注]=N'OQT测试')", new { no = 订单号 });
        c.Execute("DELETE FROM [采购入仓单] WHERE [备注]=N'OQT测试'");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=@no", new { no = 订单号 });
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=@no", new { no = 订单号 });
    }

    private static PurchaseReceiptCreateDto Dto(decimal 数量, string? 订单单号 = 订单号) => new()
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商",
        仓库 = P3TestData.仓库, 付款方式 = "月结", 备注 = "OQT测试",
        明细 =
        [
            new MaterialDocLineDto { 订单单号 = 订单单号, 物料编号 = "P3M01", 物料名称 = "P3面料", 颜色 = "红", 单位 = "米", 数量 = 数量 },
        ]
    };

    [SkippableFact]
    public async Task Create_within_order_qty_passes()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedOrder(c);
        var 单号 = await Svc().CreateAsync(Dto(100), "tester");
        try
        {
            Assert.StartsWith("CG", 单号);
            Assert.Equal(1, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_over_order_qty_rejected_and_nothing_written()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedOrder(c);
        try
        {
            // 本单同键两行先汇总：60+50=110 > 100
            var dto = Dto(60);
            dto.明细.Add(new MaterialDocLineDto { 订单单号 = 订单号, 物料编号 = "P3M01", 物料名称 = "P3面料", 颜色 = "红", 单位 = "米", 数量 = 50 });
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().CreateAsync(dto, "tester"));
            Assert.Contains("超", ex.Message);
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓单] WHERE [备注]=N'OQT测试'"));
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Unapproved_receipts_do_not_consume_quota_but_second_approve_is_blocked()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedOrder(c);
        var svc = Svc();
        var 单A = await svc.CreateAsync(Dto(60), "tester");
        var 单B = await svc.CreateAsync(Dto(50), "tester");   // 未审核不占额度，保存放行
        try
        {
            Assert.True(await Engine().ApproveAsync("采购入仓单", 单A, "tester"));
            // 审核第二张时才被拒（Controller approve 端点调用的同一校验）
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.ValidateOrderQtyAsync(单B));
            Assert.Contains("超", ex.Message);
            Assert.Contains(订单号, ex.Message);
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Lines_without_order_or_with_unknown_order_pass()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c);
        try
        {
            // 无订单单号：手工入仓放行
            var 单1 = await Svc().CreateAsync(Dto(9999, 订单单号: null), "tester");
            Assert.StartsWith("CG", 单1);
            // 订单单号不存在于采购订单：放行
            var 单2 = await Svc().CreateAsync(Dto(9999, 订单单号: "OQT-不存在"), "tester");
            Assert.StartsWith("CG", 单2);
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }

    // 备品(供应商多送):备品行允许超订单入库;不计入订单已入仓累计(不顶欠数);审核后计入可用库存。
    [SkippableFact]
    public async Task Spare_lines_over_receive_and_do_not_consume_order_quota()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedOrder(c);
        var svc = Svc();
        var inv = new MaterialInventoryService(Factory());
        var stock0 = await inv.StockOfAsync("P3M01", null);
        try
        {
            // 备品行(备品='1')超订单数量也放行,审核前校验同样放行
            var dtoA = Dto(20);
            dtoA.明细[0].备品 = "1";
            var 单A = await svc.CreateAsync(dtoA, "tester");
            await svc.ValidateOrderQtyAsync(单A);
            Assert.True(await Engine().ApproveAsync("采购入仓单", 单A, "tester"));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单A AND [备品]='1'", new { 单A }));
            // 旧口径整行备品落库归一化:数量→备品数量,数量置 0(订单部分=0 才不占额度)
            Assert.Equal(0m, c.ExecuteScalar<decimal>(
                "SELECT ISNULL([数量],0) FROM [采购入仓明细单] WHERE [单号]=@单A", new { 单A }));
            Assert.Equal(20m, c.ExecuteScalar<decimal>(
                "SELECT ISNULL([备品数量],0) FROM [采购入仓明细单] WHERE [单号]=@单A", new { 单A }));

            // 备品不占订单额度:正单 100(=订购量)放行;若备品计入已入仓,20+100>100 会被拦
            var 单B = await svc.CreateAsync(Dto(100), "tester");
            Assert.True(await Engine().ApproveAsync("采购入仓单", 单B, "tester"));

            // 满额后再收 1 个(非备品)仍被拦:超量保护对正单不丢
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateAsync(Dto(1), "tester"));
            Assert.Contains("超", ex.Message);

            // 备品审核入仓即进可用库存:库存净增 120(100 正单 + 20 备品)
            var stock1 = await inv.StockOfAsync("P3M01", null);
            Assert.Equal(stock0 + 120, stock1);
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }

    // 备品数量(同单拆分):数量=订单部分(计欠数校验),备品数量=供应商多送(不限量,入库存不占欠数);
    // 旧客户端整行备品(备品='1' 不带备品数量)落库归一化:数量→备品数量,数量置 0。
    [SkippableFact]
    public async Task Spare_qty_split_and_legacy_whole_row_spare_normalized()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        P3TestData.Seed(c); SeedOrder(c);
        var svc = Svc();
        var inv = new MaterialInventoryService(Factory());
        var stock0 = await inv.StockOfAsync("P3M01", null);
        try
        {
            // 拆分行:订单部分 60 + 备品 20 → 放行,订单额度只消 60;单头数量=实物总数 80
            var dtoA = Dto(60);
            dtoA.明细[0].备品 = "1";
            dtoA.明细[0].备品数量 = 20;
            var 单A = await svc.CreateAsync(dtoA, "tester");
            Assert.True(await Engine().ApproveAsync("采购入仓单", 单A, "tester"));
            var rowA = c.QuerySingle<(decimal 数量, decimal? 备品数量)>(
                "SELECT [数量],[备品数量] FROM [采购入仓明细单] WHERE [单号]=@单A", new { 单A });
            Assert.Equal(60m, rowA.数量);
            Assert.Equal(20m, rowA.备品数量);
            Assert.Equal(80m, c.ExecuteScalar<decimal>(
                "SELECT [数量] FROM [采购入仓单] WHERE [单号]=@单A", new { 单A }));

            // 订单部分超量仍被拦:剩 40 额度,收 41 + 备品 5 → 拦(备品数量不影响拦截口径)
            var dtoB = Dto(41);
            dtoB.明细[0].备品 = "1";
            dtoB.明细[0].备品数量 = 5;
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateAsync(dtoB, "tester"));
            Assert.Contains("超", ex.Message);

            // 旧口径整行备品:备品='1' 不带备品数量 → 归一化为 数量=0/备品数量=40,不占额度,审核进库存
            var dtoC = Dto(40);
            dtoC.明细[0].备品 = "1";
            var 单C = await svc.CreateAsync(dtoC, "tester");
            var rowC = c.QuerySingle<(decimal 数量, decimal? 备品数量)>(
                "SELECT [数量],[备品数量] FROM [采购入仓明细单] WHERE [单号]=@单C", new { 单C });
            Assert.Equal(0m, rowC.数量);
            Assert.Equal(40m, rowC.备品数量);
            Assert.True(await Engine().ApproveAsync("采购入仓单", 单C, "tester"));

            // 库存净增 120(订单部分 60 + 备品 20 + 整行备品 40)
            var stock1 = await inv.StockOfAsync("P3M01", null);
            Assert.Equal(stock0 + 120, stock1);

            // 详情返回备品数量(前端查看态显示「备品 20」)
            var detail = await svc.GetAsync(单A);
            Assert.Equal(20m, detail!.明细[0].备品数量);
            Assert.Equal(60m, detail.明细[0].数量);
        }
        finally { CleanOrder(c); P3TestData.Cleanup(c); }
    }
}
