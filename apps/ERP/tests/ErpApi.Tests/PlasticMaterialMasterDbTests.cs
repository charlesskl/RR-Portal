using Dapper;
using ErpApi.Features.Plastics.PlasticMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticMaterialMasterDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialMasterService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[仓位号],[单价],[销售价],[库存],[最低库存],[供应商名称])
                    VALUES(N'啤料PM',N'PM001',N'ABS粒',N'规X',N'kg',N'A-01',10,15,100,5,N'供A'),
                          (N'啤料PM',N'PM002',N'PP粒',N'规Y',N'kg',N'A-02',12,0,0,0,N'供A'),
                          (N'色种PM',N'PM003',N'黑色种',N'规Z',N'kg',N'B-01',0.5,1,500,50,N'供B'),
                          (NULL,      N'PM999',N'无类别料',N'规W',N'个',NULL,1,2,0,0,N'供C')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号] IN (N'PM001',N'PM002',N'PM003',N'PM999')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            Assert.Equal(2, cats.Single(x => x.类别 == "啤料PM").数量);
            Assert.Equal(1, cats.Single(x => x.类别 == "色种PM").数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_category_and_carries_仓位号()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync("啤料PM", null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("啤料PM", r.物料类别));
            Assert.Contains(page.Items, r => r.物料编号 == "PM001" && r.仓位号 == "A-01" && r.库存 == 100m && r.供应商名称 == "供A");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_keyword_within_all()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "黑色种", 1, 20);
            Assert.Equal("PM003", Assert.Single(page.Items).物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_no_filter_returns_all_including_uncategorized()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, null, 1, 200);
            var seeded = page.Items.Where(r => new[] { "PM001", "PM002", "PM003", "PM999" }.Contains(r.物料编号)).ToList();
            Assert.Equal(4, seeded.Count);
            Assert.Contains(seeded, r => r.物料编号 == "PM999" && r.物料类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_款号_fuzzy()
    {
        using var c = fx.Open();
        c.Execute(@"INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[款号])
                    VALUES(N'PMSTY1',N'款号料A',N'92125'),(N'PMSTY2',N'款号料B',N'92119/92125'),(N'PMSTY3',N'款号料C',N'77772')");
        try
        {
            var page = await Svc().ListAsync(null, null, 1, 20, false, false, "92125");
            var codes = page.Items.Select(r => r.物料编号).ToList();
            Assert.Contains("PMSTY1", codes);
            Assert.Contains("PMSTY2", codes);
            Assert.DoesNotContain("PMSTY3", codes);
        }
        finally
        {
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号] IN (N'PMSTY1',N'PMSTY2',N'PMSTY3')");
        }
    }
}
