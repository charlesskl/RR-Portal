using Dapper;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialPurchaseAnalysisServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialMasterService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        // 缺料原料:库存10/安全库存5/需求8 → 可购=8+5-10=3
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存]) VALUES(N'ABS',N'RA-PA',N'ABS粒',N'规X',N'kg',10,5)");
        // 充足原料:库存100/安全5/需求8 → 可购=8+5-100=-87 (onlyBuy 排除)
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存]) VALUES(N'ABS',N'RA-PB',N'ABS足',N'规Y',N'kg',100,5)");
        c.Execute("INSERT INTO [原料生产需求表]([单号],[审核]) VALUES(N'YLX-PA-1','1')");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PA',8,1)");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PB',8,1)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=N'YLX-PA-1'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [单号]=N'YLX-PA-1'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号] IN (N'RA-PA',N'RA-PB')");
    }

    [SkippableFact]
    public async Task Analysis_computes_可购数量_with_safety_stock()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var r = Assert.Single((await Svc().PurchaseAnalysisAsync("ABS", "RA-PA", false)).Where(x => x.原料编号 == "RA-PA"));
            Assert.Equal(8m, r.生产需求);
            Assert.Equal(10m, r.当前库存);
            Assert.Equal(5m, r.安全库存);
            Assert.Equal(3m, r.可购数量); // 8+5-10
            Assert.Equal("ABS", r.物料类别);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Analysis_filters_onlyBuy_and_category()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // onlyBuy: RA-PA(可购3>0)含, RA-PB(可购-87)排除
            var buy = await Svc().PurchaseAnalysisAsync(null, null, true);
            Assert.Contains(buy, x => x.原料编号 == "RA-PA");
            Assert.DoesNotContain(buy, x => x.原料编号 == "RA-PB");
            // 物料类别不命中
            Assert.DoesNotContain(await Svc().PurchaseAnalysisAsync("不存在", null, false), x => x.原料编号 == "RA-PA");
            // 不过滤含两者
            var all = await Svc().PurchaseAnalysisAsync(null, "RA-P", false);
            Assert.Contains(all, x => x.原料编号 == "RA-PA");
            Assert.Contains(all, x => x.原料编号 == "RA-PB");
        }
        finally { Clean(c); }
    }

    private static void SeedInTransit(SqlConnection c)
    {
        CleanInTransit(c);
        // 库存0/安全0/需求20;已审核采购单订货15已收6(在途9)+未审核采购单订货100(不计) → 可购=20-9=11
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存]) VALUES(N'ABS',N'RA-PC',N'ABS在途',N'规T',N'kg',0,0)");
        c.Execute("INSERT INTO [原料生产需求表]([单号],[审核]) VALUES(N'YLX-PA-2','1')");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-2',N'RA-PC',20,1)");
        c.Execute("INSERT INTO [原料采购订单]([单号],[订购日期],[审核]) VALUES(N'YCD-PA-1',GETDATE(),'1'),(N'YCD-PA-2',GETDATE(),'0')");
        c.Execute("INSERT INTO [原料采购订单明细]([单号],[原料编号],[订货数量]) VALUES(N'YCD-PA-1',N'RA-PC',15),(N'YCD-PA-2',N'RA-PC',100)");
        c.Execute("INSERT INTO [原料入仓单]([单号],[订单单号],[审核]) VALUES(N'YRC-PA-1',N'YCD-PA-1','1')");
        c.Execute("INSERT INTO [原料入仓明细单]([单号],[原料编号],[数量]) VALUES(N'YRC-PA-1',N'RA-PC',6)");
    }

    private static void CleanInTransit(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [单号]=N'YRC-PA-1'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [单号]=N'YRC-PA-1'");
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [单号] IN (N'YCD-PA-1',N'YCD-PA-2')");
        c.Execute("DELETE FROM [原料采购订单] WHERE [单号] IN (N'YCD-PA-1',N'YCD-PA-2')");
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=N'YLX-PA-2'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [单号]=N'YLX-PA-2'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RA-PC'");
    }

    [SkippableFact]
    public async Task Analysis_nets_in_transit_from_approved_orders()
    {
        using var c = fx.Open(); SeedInTransit(c);
        try
        {
            var r = Assert.Single(await Svc().PurchaseAnalysisAsync(null, "RA-PC", false));
            Assert.Equal(20m, r.生产需求);
            Assert.Equal(9m, r.在途数量);   // 已审核单 15-6;未审核单不计
            Assert.Equal(11m, r.可购数量);  // 0+20-0-9
        }
        finally { CleanInTransit(c); }
    }
}
