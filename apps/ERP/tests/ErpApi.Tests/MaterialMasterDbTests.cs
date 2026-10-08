using Dapper;
using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Features.MasterData;
using ErpApi.Features.Materials.MaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialMasterDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialMasterService Svc() => new(Factory());

    // 分类「面料MM」2 个物料、「辅料MM」1 个、1 个无类别物料
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[单价],[销售价],[库存],[最低库存],[供应商名称])
                    VALUES(N'面料MM',N'MM001',N'面料甲',N'规X',N'米',10,15,100,5,N'供A'),
                          (N'面料MM',N'MM002',N'面料乙',N'规Y',N'米',12,0,0,0,N'供A'),
                          (N'辅料MM',N'MM003',N'纽扣',N'规Z',N'粒',0.5,1,500,50,N'供B'),
                          (NULL,      N'MM999',N'无类别料',N'规W',N'个',1,2,0,0,N'供C')");
    }

    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'MM001',N'MM002',N'MM003',N'MM999')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            var 面料 = cats.Single(x => x.类别 == "面料MM");
            var 辅料 = cats.Single(x => x.类别 == "辅料MM");
            Assert.Equal(2, 面料.数量);
            Assert.Equal(1, 辅料.数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_category()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync("面料MM", null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("面料MM", r.物料类别));
            Assert.Contains(page.Items, r => r.物料编号 == "MM001" && r.库存 == 100m && r.供应商名称 == "供A");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_keyword_within_all()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "纽扣", 1, 20);
            var row = Assert.Single(page.Items);
            Assert.Equal("MM003", row.物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_no_filter_returns_all_including_uncategorized()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, null, 1, 1000);
            // 种子 4 行(面料MM×2 + 辅料MM×1 + 无类别 MM999×1)全在结果中;DB 已有数百行真实物料,页长取满 1000 上限
            var seeded = page.Items.Where(r => new[] { "MM001", "MM002", "MM003", "MM999" }.Contains(r.物料编号)).ToList();
            Assert.Equal(4, seeded.Count);
            Assert.Contains(seeded, r => r.物料编号 == "MM999" && r.物料类别 is null);
        }
        finally { Cleanup(c); }
    }

    // ---- 类别树 / 编号自动生成 ----

    private static void SeedTree(SqlConnection c)
    {
        CleanTree(c);
        c.Execute(@"INSERT INTO [物料类别]([编号],[名称],[类别]) VALUES
                    (N'TMC1',N'树测面料',NULL),
                    (N'TMC2',N'树测棉布',N'TMC1'),
                    (N'TMK', N'号测类别',NULL)");
        c.Execute(@"INSERT INTO [物料资料]([物料类别],[物料编号],[物料名称]) VALUES
                    (N'树测面料',N'TMT003',N'树测料丙'),
                    (N'树测棉布',N'TMT001',N'树测料甲'),
                    (N'树测外来',N'TMT002',N'树测料乙'),
                    (N'号测类别',N'TMK001',N'号测料一'),
                    (N'号测类别',N'TMK003',N'号测料三'),
                    (N'名测类',  N'名测001',N'名测料')");
    }

    private static void CleanTree(SqlConnection c)
    {
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'TMT001',N'TMT002',N'TMT003',N'TMK001',N'TMK003',N'名测001')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料类别] IN (N'生成测')");
        c.Execute("DELETE FROM [物料类别] WHERE [编号] IN (N'TMC1',N'TMC2',N'TMK')");
    }

    [SkippableFact]
    public async Task Categories_builds_tree_from_master_and_keeps_material_only()
    {
        using var c = fx.Open();
        SeedTree(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            var 棉布 = cats.Single(x => x.编号 == "TMC2");
            Assert.Equal("树测棉布", 棉布.类别);
            Assert.Equal("TMC1", 棉布.父级);          // 父级规范化为父类别编号
            Assert.Equal(1, 棉布.数量);
            Assert.Null(cats.Single(x => x.编号 == "TMC1").父级);
            var 外来 = cats.Single(x => x.类别 == "树测外来");   // 物料行自带、主数据没有 → 顶级
            Assert.Null(外来.编号);
            Assert.Null(外来.父级);
        }
        finally { CleanTree(c); }
    }

    [SkippableFact]
    public async Task List_includeChildren_covers_descendant_categories()
    {
        using var c = fx.Open();
        SeedTree(c);
        try
        {
            var withChildren = await Svc().ListAsync("树测面料", null, 1, 50, 含子级: true);
            var codes = withChildren.Items.Select(r => r.物料编号).ToList();
            Assert.Contains("TMT003", codes);   // 本级
            Assert.Contains("TMT001", codes);   // 子级 树测棉布
            Assert.DoesNotContain("TMT002", codes); // 非后代类别

            var exact = await Svc().ListAsync("树测面料", null, 1, 50);
            Assert.DoesNotContain(exact.Items.Select(r => r.物料编号), x => x == "TMT001");
        }
        finally { CleanTree(c); }
    }

    [SkippableFact]
    public async Task NextCode_uses_master_code_prefix_and_increments()
    {
        using var c = fx.Open();
        SeedTree(c);
        try
        {
            Assert.Equal("TMK004", await Svc().NextCodeAsync("号测类别")); // 前缀取主数据编号
            Assert.Equal("名测类001", await Svc().NextCodeAsync("名测类")); // 无主数据 → 类别名做前缀（仅匹配同前缀编号）
        }
        finally { CleanTree(c); }
    }

    [SkippableFact]
    public async Task Create_generates_distinct_codes_when_blank()
    {
        using var c = fx.Open();
        SeedTree(c);
        var db = new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
        var crud = new MasterCrudService<物料资料>(db);
        try
        {
            var a = await Svc().CreateWithGeneratedCodeAsync(new 物料资料 { 物料类别 = "生成测", 物料名称 = "生成甲" }, crud);
            var b = await Svc().CreateWithGeneratedCodeAsync(new 物料资料 { 物料类别 = "生成测", 物料名称 = "生成乙" }, crud);
            Assert.False(string.IsNullOrWhiteSpace(a.物料编号));
            Assert.False(string.IsNullOrWhiteSpace(b.物料编号));
            Assert.NotEqual(a.物料编号, b.物料编号);
            Assert.StartsWith("生成测", a.物料编号);
        }
        finally { CleanTree(c); }
    }

    [SkippableFact]
    public async Task List_onlyStock_excludes_zero_stock()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var all = await Svc().ListAsync(null, "MM00", 1, 50, onlyStock: false);
            Assert.Contains(all.Items, r => r.物料编号 == "MM002");   // 库存0,不过滤时在

            var inStock = await Svc().ListAsync(null, "MM00", 1, 50, onlyStock: true);
            Assert.Contains(inStock.Items, r => r.物料编号 == "MM001");   // 库存100
            Assert.Contains(inStock.Items, r => r.物料编号 == "MM003");   // 库存500
            Assert.DoesNotContain(inStock.Items, r => r.物料编号 == "MM002");   // 库存0被滤
        }
        finally { Cleanup(c); }
    }
}
