using Dapper;
using ErpApi.Features.Production;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MoTrackingDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MoTrackingService Svc() => new(Factory());

    [SkippableFact]
    public async Task Save_Get_replace_and_skip_empty()
    {
        using var c = fx.Open();
        const string 单号 = "MO_S1";
        c.Execute("DELETE FROM [生产通知单MO单] WHERE [生产单号]=@n", new { n = 单号 });
        var svc = Svc();
        try
        {
            // 2 行（含 1 全空行 → 应被跳过，故有效 2 行）
            await svc.SaveAsync(单号, new List<MoLineDto>
            {
                new() { 正单合同号 = "HT001", 产品货号 = "A-001", 产品名称 = "上衣", 接单数量 = 100m, 装箱方式 = "CTN", 订单总箱数 = 10 },
                new() { 正单合同号 = "HT002", 产品货号 = "A-002", 产品名称 = "裤子", 接单数量 = 50m },
                new() { 备注 = "全空行(无合同/货号/名称/数量)应跳过" },
            });

            var rows = await svc.GetAsync(单号);
            Assert.Equal(2, rows.Count);
            Assert.Equal(1, rows[0].序号);
            Assert.Equal("A-001", rows[0].产品货号);
            Assert.Equal(100m, rows[0].接单数量);
            Assert.Equal(2, rows[1].序号);
            Assert.Equal("A-002", rows[1].产品货号);
            Assert.Equal(50m, rows[1].接单数量);

            // 重存 1 行 → 整组替换为 1 行
            await svc.SaveAsync(单号, new List<MoLineDto>
            {
                new() { 正单合同号 = "HT003", 产品货号 = "B-001", 产品名称 = "外套", 接单数量 = 7m },
            });
            var after = await svc.GetAsync(单号);
            Assert.Single(after);
            Assert.Equal(1, after[0].序号);
            Assert.Equal("B-001", after[0].产品货号);
            Assert.Equal(7m, after[0].接单数量);
        }
        finally
        {
            c.Execute("DELETE FROM [生产通知单MO单] WHERE [生产单号]=@n", new { n = 单号 });
        }
    }
}
