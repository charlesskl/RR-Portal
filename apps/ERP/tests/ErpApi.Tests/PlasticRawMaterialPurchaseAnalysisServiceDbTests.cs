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
        // 明确常用原料保留安全库存建议；需求来自真实SP快照，旧YLX不再叠加。
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存],[常用原料]) VALUES(N'ABS',N'RA-PA',N'ABS粒',N'规X',N'kg',10,5,1)");
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存],[常用原料]) VALUES(N'ABS',N'RA-PB',N'ABS足',N'规Y',N'kg',100,5,1)");
        c.Execute("INSERT INTO [原料生产需求表]([单号],[审核]) VALUES(N'YLX-PA-1','1')");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PA',8,1)");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PB',8,1)");
        MoldingSource(c, "P113A-SPA", "RA-PA", 8);
        MoldingSource(c, "P113A-SPB", "RA-PB", 8);
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=N'YLX-PA-1'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [单号]=N'YLX-PA-1'");
        CleanSource(c, "P113A-SPA"); CleanSource(c, "P113A-SPB");
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
            // onlyBuy: RA-PA(建议补库3)含, RA-PB(建议0)排除。
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
        // 真实已收6形成库存；已保存未审100也占额，不能反复从分析下单。
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存],[每包重量],[常用原料]) VALUES(N'ABS',N'RA-PC',N'ABS在途',N'规T',N'kg',0,0,25,0)");
        c.Execute("INSERT INTO [原料生产需求表]([单号],[审核]) VALUES(N'YLX-PA-2','1')");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-2',N'RA-PC',20,1)");
        MoldingSource(c, "P113A-SPC", "RA-PC", 20);
        c.Execute("INSERT INTO [原料采购订单]([单号],[订购日期],[审核]) VALUES(N'YCD-PA-1',GETDATE(),'1'),(N'YCD-PA-2',GETDATE(),'0')");
        c.Execute("INSERT INTO [原料采购订单明细]([单号],[原料编号],[单位],[订货数量]) VALUES(N'YCD-PA-1',N'RA-PC',N'KG',15),(N'YCD-PA-2',N'RA-PC',N'KG',100)");
        c.Execute("INSERT INTO [原料入仓单]([单号],[订单单号],[审核]) VALUES(N'YRC-PA-1',N'YCD-PA-1','1')");
        c.Execute("INSERT INTO [原料入仓明细单]([单号],[原料编号],[单位],[数量]) VALUES(N'YRC-PA-1',N'RA-PC',N'KG',6)");
    }

    private static void CleanInTransit(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料入仓明细单] WHERE [单号]=N'YRC-PA-1'");
        c.Execute("DELETE FROM [原料入仓单] WHERE [单号]=N'YRC-PA-1'");
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [单号] IN (N'YCD-PA-1',N'YCD-PA-2')");
        c.Execute("DELETE FROM [原料采购订单] WHERE [单号] IN (N'YCD-PA-1',N'YCD-PA-2')");
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=N'YLX-PA-2'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [单号]=N'YLX-PA-2'");
        CleanSource(c, "P113A-SPC");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号]=N'RA-PC'");
    }

    [SkippableFact]
    public async Task Analysis_nets_saved_orders_and_real_receipt_stock_without_double_counting_legacy_demand()
    {
        using var c = fx.Open(); SeedInTransit(c);
        try
        {
            var r = Assert.Single(await Svc().PurchaseAnalysisAsync(null, "RA-PC", false));
            Assert.Equal(20m, r.生产需求);
            Assert.Equal(109m, r.在途数量); // 已审核15-6 + 已保存未审核100。
            Assert.Equal(6m, r.当前库存);
            Assert.Equal(0m, r.可购数量);
            c.Execute("DELETE FROM [原料采购订单明细] WHERE [单号]=N'YCD-PA-2'; DELETE FROM [原料采购订单] WHERE [单号]=N'YCD-PA-2'");
            var remaining = Assert.Single(await Svc().PurchaseAnalysisAsync(null, "RA-PC", false));
            Assert.Equal(9m, remaining.在途数量); Assert.Equal(6m, remaining.当前库存);
            Assert.Equal(5m, remaining.可购数量); // 20-6-(15-6)，收货不被重复扣除。
        }
        finally { CleanInTransit(c); }
    }

    private static void MoldingSource(SqlConnection c, string number, string raw, decimal kg) => c.Execute("""
INSERT INTO [塑胶采购订单]([单号],[日期],[审核],[加工类型],[原料扣减版本],[原料扣减方式]) VALUES(@number,GETDATE(),N'1',N'一次加工',1,N'领料出库');
INSERT INTO [塑胶采购订单明细]([单号],[物料编号],[数量],[原料用量KG],[原料扣减组分数]) VALUES(@number,@raw,1,@kg,1);
DECLARE @line bigint=SCOPE_IDENTITY();
INSERT INTO [塑胶采购原料用量]([采购单号],[采购明细ID],[原料ID],[原料编号],[原料名称],[比例],[总比例],[用量KG],[库存数量],[库存单位],[每库存单位KG])
SELECT @number,@line,[ID],@raw,@raw,1,1,@kg,@kg,N'KG',1 FROM [塑胶原料资料] WHERE [物料编号]=@raw
""", new { number, raw, kg });

    private static void CleanSource(SqlConnection c, string number) => c.Execute("""
DELETE FROM [塑胶采购原料用量] WHERE [采购单号]=@number;
DELETE FROM [塑胶采购订单明细] WHERE [单号]=@number;
DELETE FROM [塑胶采购订单] WHERE [单号]=@number
""", new { number });
}
