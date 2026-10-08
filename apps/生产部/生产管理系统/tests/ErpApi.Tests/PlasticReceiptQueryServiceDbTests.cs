using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;
using ErpApi.Integrations.Paiji;

[Collection("db")]
public class PlasticReceiptQueryServiceDbTests(DbFixture fx)
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

    [SkippableFact]
    public async Task ReceiptQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'RC_D1'");
            c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'RC_D1'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'RCPM'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'RCPM'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[塑胶货号],[共用原料编号]) VALUES(N'RCPM',N'H-RC',N'CR-RC')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'RCPM',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[供应商名称],[审核],[订单单号]) VALUES(N'RC_D1','2026-06-10',N'供A','1',N'ZCS-RC')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[订单单号],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[颜色],[塑胶货号],[单位],[数量],[单价],[金额]) VALUES" +
            "(N'RC_D1',N'ZCS-RC',N'RC-MO',N'K-RC',N'GM-RC',N'RCPM',N'ABS粒',N'黑',N'H-RC',N'kg',5,2,10)," +
            "(N'RC_D1',N'ZCS-RC',N'RC-MO',N'K-RC',N'GM-RC',N'RCPM',N'ABS粒',N'黑',N'H-RC',N'kg',3,2,6)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().ReceiptQueryDetailAsync(qi, qe, "RCPM", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("ZCS-RC", r.订单单号); Assert.Equal("GM-RC", r.工模编号);
                Assert.Equal("供A", r.供应商); Assert.Equal("H-RC", r.共用货号);
                Assert.Equal("H-RC", r.塑胶货号); Assert.Equal("1", r.审核);
            });
            var sum = await Svc().ReceiptQuerySummaryAsync(qi, qe, "RCPM", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "RCPM");   // 汇总按物料编号·单行
            Assert.Equal("H-RC", s.共用货号);
            Assert.Equal("CR-RC", s.共用物料);
            Assert.Equal("ABS", s.物料类别);
            Assert.Equal(8m, s.数量);          // 5+3
            // 审核情况
            Assert.Empty(await Svc().ReceiptQueryDetailAsync(qi, qe, "RCPM", "未审核", null));
            Assert.Equal(2, (await Svc().ReceiptQueryDetailAsync(qi, qe, "RCPM", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().ReceiptQueryDetailAsync(qi, qe, "RCPM", null, "不存在类"));
            Assert.Equal(2, (await Svc().ReceiptQueryDetailAsync(qi, qe, "RCPM", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().ReceiptQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "RCPM", null, null));
        }
        finally { Clean(); }
    }
}
