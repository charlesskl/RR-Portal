using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

// 半成品入仓齐套检查(KitCheckAsync):组成需要=使用数量×入仓数;已回=该生产单已审核塑胶入仓(加工回仓)累计。
[Collection("db")]
public class SemiReceiptKitCheckDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private const string Semi = "KIT-SEMI-A";
    private const string 货号 = "KIT-K1";
    private const string MO = "KIT-MO1";

    private static void SeedDef(System.Data.IDbConnection c)
    {
        c.Execute("INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[操作员]) VALUES(@货号,@名称,N'半成品',99,N'kit-test')",
            new { 货号, 名称 = Semi });
        var headId = c.ExecuteScalar<long>("SELECT [ID] FROM [半成品设置] WHERE [名称]=@n", new { n = Semi });
        c.Execute(@"INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[单位],[使用数量]) VALUES
(@h,N'KIT-M1',N'套件料一',N'个',2),(@h,N'KIT-M2',N'套件料二',N'个',1)", new { h = headId });
    }

    private static void SeedReceipt(System.Data.IDbConnection c, string 单号, string 审核, string 物料, decimal 数量)
    {
        c.Execute(@"INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[数量],[操作员],[审核])
VALUES(@no,'2026-09-01',N'塑胶仓',@qty,N'kit-test',@审核)", new { no = 单号, qty = 数量, 审核 });
        c.Execute(@"INSERT INTO [塑胶入仓明细单]([单号],[日期],[物料编号],[物料名称],[单位],[数量],[生产单号])
VALUES(@no,'2026-09-01',@mat,N'齐套测试料',N'个',@qty,@mo)", new { no = 单号, mat = 物料, qty = 数量, mo = MO });
    }

    private static void Cleanup(System.Data.IDbConnection c)
    {
        c.Execute("DELETE d FROM [半成品设置明细] d JOIN [半成品设置] h ON h.[ID]=d.[头ID] WHERE h.[名称]=@n", new { n = Semi });
        c.Execute("DELETE FROM [半成品设置] WHERE [名称]=@n", new { n = Semi });
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号] LIKE 'KIT-RCV-%'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号] LIKE 'KIT-RCV-%'");
    }

    [SkippableFact]
    public async Task KitCheck_部分已回_列出还差且不齐套()
    {
        using var c = fx.Open();
        Cleanup(c);
        SeedDef(c);
        SeedReceipt(c, "KIT-RCV-1", "1", "KIT-M1", 150m); // M1 需 200 回 150;M2 需 100 回 0
        try
        {
            var r = await Svc().KitCheckAsync(Semi, 货号, MO, 100m);
            Assert.True(r.有定义);
            Assert.False(r.齐套);
            Assert.Equal(2, r.组成.Count);
            var m1 = Assert.Single(r.组成, x => x.物料编号 == "KIT-M1");
            Assert.Equal(2m, m1.每件用量); Assert.Equal(200m, m1.需要); Assert.Equal(150m, m1.已回); Assert.Equal(50m, m1.还差);
            var m2 = Assert.Single(r.组成, x => x.物料编号 == "KIT-M2");
            Assert.Equal(100m, m2.需要); Assert.Equal(0m, m2.已回); Assert.Equal(100m, m2.还差);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task KitCheck_回齐则齐套()
    {
        using var c = fx.Open();
        Cleanup(c);
        SeedDef(c);
        SeedReceipt(c, "KIT-RCV-2", "1", "KIT-M1", 200m);
        SeedReceipt(c, "KIT-RCV-3", "1", "KIT-M2", 100m);
        try
        {
            var r = await Svc().KitCheckAsync(Semi, 货号, MO, 100m);
            Assert.True(r.齐套);
            Assert.All(r.组成, x => Assert.Equal(0m, x.还差));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task KitCheck_未审核入仓不计入已回()
    {
        using var c = fx.Open();
        Cleanup(c);
        SeedDef(c);
        SeedReceipt(c, "KIT-RCV-4", "0", "KIT-M1", 500m); // 未审核 → 不算
        try
        {
            var r = await Svc().KitCheckAsync(Semi, 货号, MO, 100m);
            Assert.False(r.齐套);
            Assert.Equal(0m, Assert.Single(r.组成, x => x.物料编号 == "KIT-M1").已回);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task KitCheck_无定义返回有定义false()
    {
        using var c = fx.Open();
        var r = await Svc().KitCheckAsync("KIT-不存在", null, MO, 1m);
        Assert.False(r.有定义);
        Assert.Empty(r.组成);
    }
}
