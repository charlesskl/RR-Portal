using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticCustomerTypeStatsServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task CustomerTypeStats_groups_by_customer_and_type_filters_period_and_approval()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号] IN (N'SCT_D0',N'SCT_D1',N'SCT_D2',N'SCT_D9')");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号] IN (N'SCT_D0',N'SCT_D1',N'SCT_D2',N'SCT_D9')");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D1','2026-06-10',N'客SCTA','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D1',N'原胶件',10,100),(N'SCT_D1',N'印喷件',5,50)");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D2','2026-06-12',N'客SCTB','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D2',N'原胶件',3,30)");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D0','2026-05-10',N'客SCTA','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D0',N'原胶件',99,999)");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D9','2026-06-15',N'客SCTA','0')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D9',N'原胶件',88,888)");
        try
        {
            var rows = await Svc().CustomerTypeStatsAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null);
            var a原 = Assert.Single(rows, r => r.客户 == "客SCTA" && r.类型 == "原胶件");
            Assert.Equal(10m, a原.数量); Assert.Equal(100m, a原.金额);
            var a印 = Assert.Single(rows, r => r.客户 == "客SCTA" && r.类型 == "印喷件");
            Assert.Equal(5m, a印.数量); Assert.Equal(50m, a印.金额);
            var b原 = Assert.Single(rows, r => r.客户 == "客SCTB" && r.类型 == "原胶件");
            Assert.Equal(3m, b原.数量);
            Assert.DoesNotContain(rows, r => r.数量 == 99m);
            Assert.DoesNotContain(rows, r => r.数量 == 88m);
            var ja = await Svc().CustomerTypeStatsAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "客SCTA");
            Assert.Equal(2, ja.Count);
            Assert.All(ja, r => Assert.Equal("客SCTA", r.客户));
        }
        finally { Clean(); }
    }
}
