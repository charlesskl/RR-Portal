using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

// 排产入库行 → ERP塑胶入仓单 共享同步服务(PaijiReceiptSyncService)的 DB 集成测试。
// 测试数据标记:送货单号 delivery_code 用 WHUT- 前缀,排产入库ID 用 990000xxx 段,便于清理且不撞真实数据。
[Collection("db")]
public class PaijiReceiptSyncDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PaijiReceiptSyncService Svc() => new(
        new PlasticReceiptService(Factory(), new DocumentNumberGenerator(),
            new PaijiPushService(new HttpClient(), Options.Create(new PaijiOptions()),
                NullLogger<PaijiPushService>.Instance)),
        Factory(), NullLogger<PaijiReceiptSyncService>.Instance);

    private const string Tag = "WHUT-";
    private const string 送货单号 = "WHUT-TEST";
    private const long Id1 = 990000001;
    private const long Id2 = 990000002;
    private const long Id3 = 990000003;

    private static void Cleanup(SqlConnection c)
    {
        c.Execute(@"DELETE FROM [排产同步记录] WHERE [ERP单号] IN (SELECT [单号] FROM [塑胶入仓单] WHERE [入仓单号] LIKE @tag + N'%')
                    OR [排产入库ID] BETWEEN 990000000 AND 990000999;", new { tag = Tag });
        c.Execute(@"DELETE FROM [塑胶入仓明细单] WHERE [单号] IN (SELECT [单号] FROM [塑胶入仓单] WHERE [入仓单号] LIKE @tag + N'%');", new { tag = Tag });
        c.Execute(@"DELETE FROM [塑胶入仓单] WHERE [入仓单号] LIKE @tag + N'%';", new { tag = Tag });
    }

    private static PaijiWarehouseInRow 行(long id, string? notes = null, string status = "checked-in",
        string? partName = null, string? deliveryCode = null) => new()
    {
        Id = id,
        Workshop = "AT",
        DeliveryDate = "2026-09-10",
        DeliveryCode = deliveryCode ?? 送货单号,
        OrderNo = "WHUT-SC-001",
        MoldNo = "WHUT-001",
        PartName = partName ?? "webhook测试件",
        Color = "红",
        DeliveryPcs = 100,
        Cavity = 4,
        UnitPrice = 0.8m,
        Status = status,
        Notes = notes,
    };

    [SkippableFact]
    public async Task SyncRows_同送货单号两行建一张未审核单且幂等()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(Id1), 行(Id2)], "AT");
            var 单号 = Assert.Single(建单);

            var 单头 = await c.QuerySingleAsync<(string 审核, string 操作员, DateTime 日期, string 入仓单号, string? 订单单号)>(
                "SELECT [审核],[操作员],[日期],[入仓单号],[订单单号] FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal("0", 单头.审核);                       // 未审核
            Assert.Equal("排产同步", 单头.操作员);
            Assert.Equal(new DateTime(2026, 9, 10), 单头.日期);  // 单头日期改写为送货日期
            Assert.Equal(送货单号, 单头.入仓单号);
            // 订单单号必须留空:排产只给得到生产单号,误填会让采购单欠数两条核销路径都匹配不上
            Assert.Null(单头.订单单号);
            var 明细订单号 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓明细单] WHERE [单号]=@单号 AND [订单单号] IS NOT NULL", new { 单号 });
            Assert.Equal(0, 明细订单号);

            var 明细数 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(2, 明细数);
            var 同步记录 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [排产同步记录] WHERE [ERP单号]=@单号", new { 单号 });
            Assert.Equal(2, 同步记录);

            // 幂等:同样的行再同步一次,不再建单
            var 再同步 = await svc.SyncRowsAsync([行(Id1), 行(Id2)], "AT");
            Assert.Empty(再同步);
            Assert.Equal(1, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓单] WHERE [入仓单号]=@code", new { code = 送货单号 }));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_ERP回推行与非checkedIn行被跳过()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            // notes 以 ERP:SR 开头 = ERP 回推入仓行,防回环跳过
            var r1 = await svc.SyncRowsAsync([行(Id3, notes: "ERP:SR20260910001 回推行")], "AT");
            Assert.Empty(r1);
            // 非 checked-in 状态跳过
            var r2 = await svc.SyncRowsAsync([行(Id3, status: "pending")], "AT");
            Assert.Empty(r2);
            Assert.Equal(0, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓单] WHERE [入仓单号] LIKE @tag + N'%'", new { tag = Tag }));
            Assert.Equal(0, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [排产同步记录] WHERE [排产入库ID]=@id", new { id = Id3 }));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_按模具颜色解析物料_同模具同颜色两轮转()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号]=N'WHUT-PO'");
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号]=N'WHUT-PO'");
        try
        {
            // 同生产单已审核采购单:两条 模具+颜色 完全相同的行(左右件),只能按剩余可收轮转
            c.Execute("INSERT INTO [塑胶采购订单]([单号],[日期],[供应商编号],[供应商名称],[数量],[审核]) VALUES(N'WHUT-PO','2026-09-01',N'292',N'兴信A(测试版)',200,'1')");
            c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[颜色],[数量]) VALUES(N'WHUT-PO',N'WHUT-SC-001',N'WHUT-款',N'WHUT-M1',N'左耳',N'GM-UT',N'红',100)");
            c.Execute("INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[颜色],[数量]) VALUES(N'WHUT-PO',N'WHUT-SC-001',N'WHUT-款',N'WHUT-M2',N'右耳',N'GM-UT',N'红',100)");

            var svc = Svc();
            var 单号1 = Assert.Single(await svc.SyncRowsAsync([行(990000004, partName: "GM-UT")], "AT"));
            var l1 = await c.QuerySingleAsync<(string? 物料编号, string? 物料名称, string? 工模编号, string? 款号, string? 订单单号)>(
                "SELECT [物料编号],[物料名称],[工模编号],[款号],[订单单号] FROM [塑胶入仓明细单] WHERE [单号]=@单号1", new { 单号1 });
            Assert.Equal("WHUT-M1", l1.物料编号);      // 并列取 ID 最小
            Assert.Equal("左耳", l1.物料名称);
            Assert.Equal("GM-UT", l1.工模编号);        // part_name(模号)落工模编号
            Assert.Equal("WHUT-001", l1.款号);         // mold_no(货号)落款号
            Assert.Null(l1.订单单号);

            // 第二次送货(另一张送货单):第一张虽未审核,剩余口径含未审核行 → 轮转到 WHUT-M2
            var 单号2 = Assert.Single(await svc.SyncRowsAsync([行(990000005, partName: "GM-UT", deliveryCode: "WHUT-TEST2")], "AT"));
            var l2 = await c.QuerySingleAsync<(string? 物料编号, string? 物料名称)>(
                "SELECT [物料编号],[物料名称] FROM [塑胶入仓明细单] WHERE [单号]=@单号2", new { 单号2 });
            Assert.Equal("WHUT-M2", l2.物料编号);
            Assert.Equal("右耳", l2.物料名称);
        }
        finally
        {
            Cleanup(c);
            c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号]=N'WHUT-PO'");
            c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号]=N'WHUT-PO'");
        }
    }
}
