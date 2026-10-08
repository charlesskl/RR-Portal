using Dapper;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialMasterDbTests(DbFixture fx)
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
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[商品名称],[单价],[销售价],[起订量],[安全库存],[库存],[供应商名称])
                    VALUES(N'ABS',N'R-T1',N'ABS粒',N'规X',N'kg',N'韩国LG',10,15,25,5,100,N'供A'),
                          (N'ABS',N'R-T2',N'ABS黑',N'规Y',N'kg',N'台化',12,0,30,0,0,N'供A'),
                          (N'PP', N'R-T3',N'PP粒', N'规Z',N'kg',N'中油',8,9,20,10,500,N'供B'),
                          (NULL,  N'R-T9',N'无类别',N'规W',N'个',N'X',1,2,0,0,0,N'供C')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号] IN (N'R-T1',N'R-T2',N'R-T3',N'R-T9')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open();
        // 库里已有 92125 导入的真实原料,断言种子带来的相对增量而不是绝对数
        Cleanup(c);
        var baseline = await Svc().CategoriesAsync();
        var absBase = baseline.SingleOrDefault(x => x.类别 == "ABS")?.数量 ?? 0;
        var ppBase = baseline.SingleOrDefault(x => x.类别 == "PP")?.数量 ?? 0;
        Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            Assert.Equal(absBase + 2, cats.Single(x => x.类别 == "ABS").数量);
            Assert.Equal(ppBase + 1, cats.Single(x => x.类别 == "PP").数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_by_category_carries_new_fields()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // 类别 ABS 下已有真实原料,用关键词 R-T 锁定种子行
            var page = await Svc().ListAsync("ABS", "R-T", 1, 20);
            Assert.Equal(2, page.Total);
            var r = Assert.Single(page.Items, x => x.物料编号 == "R-T1");
            Assert.Equal("韩国LG", r.商品名称);
            Assert.Equal(25m, r.起订量);
            Assert.Equal(5m, r.安全库存);
            Assert.Equal(100m, r.库存);
            Assert.Equal("供A", r.供应商名称);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_keyword_and_onlyStock()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            Assert.Equal("R-T3", Assert.Single((await Svc().ListAsync(null, "PP粒", 1, 20)).Items).物料编号);
            var stock = await Svc().ListAsync(null, null, 1, 200, true);
            var seeded = stock.Items.Where(r => new[] { "R-T1", "R-T2", "R-T3", "R-T9" }.Contains(r.物料编号)).ToList();
            Assert.DoesNotContain(seeded, r => r.物料编号 == "R-T2"); // 库存0 被 onlyStock 过滤
        }
        finally { Cleanup(c); }
    }
}
