using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

// 物料编号列宽防御（db/56 评估结论：物料资料.物料编号 不加宽，保持 nvarchar(20)）：
// 半成品款号可超过 20 字，调入 BOM 时 款号物料明细表.物料编号 nvarchar(20) 放不下；
// 截断会让半成品行判定（编号 ∈ 半成品共用物料设置.产品货号）失效。保存时直接拒绝超长半成品款号。
[Collection("db")]
public class SemiCodeLengthGuardDbTests(DbFixture fx)
{
    private const string StyleNo = "K-LEN";
    private const string LongSemiCode = "SEMI-VERY-LONG-CODE-0001"; // 24 字 > 20

    private ISqlConnectionFactory SqlFactory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Svc() => new(SqlFactory(), Ctx());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(@StyleNo,N'长度防御测试款')", new { StyleNo });
        c.Execute("INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称]) VALUES(@LongSemiCode,N'超长半成品')", new { LongSemiCode });
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=@StyleNo", new { StyleNo });
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号]=@LongSemiCode", new { LongSemiCode });
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=@StyleNo", new { StyleNo });
    }

    [SkippableFact]
    public async Task Save_bom_rejects_semi_code_longer_than_material_code_column()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var dto = new BomSaveDto(null, null, null, null,
                [new StyleMaterialDto(LongSemiCode, "超长半成品", null, null, null, "PCS", 1m)]);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => Svc().ReplaceMaterialsAsync(StyleNo, dto));
            Assert.Contains("20 字", ex.Message);
            Assert.Contains(LongSemiCode, ex.Message);

            // 未写入任何明细（拒绝发生在删除/插入之前）
            Assert.Equal(0, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=@StyleNo", new { StyleNo }));
        }
        finally { Clean(c); }
    }
}
