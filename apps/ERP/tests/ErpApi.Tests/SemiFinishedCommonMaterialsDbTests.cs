using Dapper;
using ErpApi.Features.Warehouse.Semi.CommonMaterials;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class SemiFinishedCommonMaterialsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SemiFinishedCommonMaterialService Svc() => new(Factory());

    private static void SkipIfSchemaUnavailable(SqlConnection c)
    {
        var available = c.ExecuteScalar<int>(
            "SELECT CASE WHEN OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NULL THEN 0 ELSE 1 END") == 1;
        Skip.IfNot(available, "ERP_TEST_DB 未应用半成品共用物料设置迁移");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] IN (N'STYLE-1',N'STYLE-2',N'STYLE-3')");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] IN (N'STYLE-1',N'STYLE-2',N'STYLE-3')");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] IN (N'STYLE-1',N'STYLE-2',N'STYLE-3')");
    }

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [款号总表]([款号],[款式])
                    VALUES(N'STYLE-1',N'最新产品名'),
                          (N'STYLE-2',N'产品二'),
                          (N'STYLE-3',N'待设置产品')");
        c.Execute(@"INSERT INTO [款号物料总表]([日期],[客户名称],[产品编号],[款号],[款式],[备注])
                    VALUES('2026-07-01',N'客户一',N'OLD-PART',N'STYLE-1',N'旧产品名',N'旧备注'),
                          ('2026-07-02',N'客户一',N'PART-1',N'STYLE-1',N'最新产品名',N'新备注'),
                          ('2026-07-02',N'客户二',N'PART-2',N'STYLE-2',N'产品二',N'产品二备注'),
                          ('2026-07-02',N'客户三',N'PART-3',N'STYLE-3',N'待设置产品',N'待设置备注')");
        c.Execute(@"INSERT INTO [半成品共用物料设置]
                    ([产品货号],[产品装配名称],[配件编号],[共用物料编号],[库存单价HK],[备注内容],[调整审核])
                    VALUES(N'STYLE-1',N'产品一装配',N'PART-1',N'COMMON-1',12.5,N'已设置已审核',1),
                          (N'STYLE-2',N'产品二装配',N'PART-2',N'COMMON-1',8.5,N'已设置未审核',0)");
    }

    [SkippableFact]
    public async Task List_uses_latest_header_and_one_row_per_style()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SkipIfSchemaUnavailable(c);
        Seed(c);
        try
        {
            var result = await Svc().ListAsync(new() { Page = 1, Size = 20 }, true);

            Assert.Single(result.Items.Where(x => x.产品货号 == "STYLE-1"));
            Assert.Equal("最新产品名", result.Items.Single(x => x.产品货号 == "STYLE-1").产品名称);
        }
        finally
        {
            Cleanup(c);
        }
    }

    [SkippableTheory]
    [InlineData("显示重复", null, null, 2)]
    [InlineData(null, "待设置", null, 1)]
    [InlineData(null, "已设置", "已审核", 1)]
    public async Task List_applies_server_filters(string? duplicate, string? pending, string? audit, int count)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SkipIfSchemaUnavailable(c);
        // 库里已有真实款号/共用物料设置行,先取基线再断言种子带来的相对增量
        Cleanup(c);
        var baseCount = (await Svc().ListAsync(new()
        {
            重复内容 = duplicate,
            待操作物料 = pending,
            审核情况 = audit,
            Page = 1,
            Size = 20
        }, true)).Total;
        Seed(c);
        try
        {
            var result = await Svc().ListAsync(new()
            {
                重复内容 = duplicate,
                待操作物料 = pending,
                审核情况 = audit,
                Page = 1,
                Size = 20
            }, true);

            Assert.Equal(baseCount + count, result.Total);
            Assert.Equal(baseCount + count, result.Items.Count);
        }
        finally
        {
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task List_redacts_price_without_price_permission()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        SkipIfSchemaUnavailable(c);
        Seed(c);
        try
        {
            var result = await Svc().ListAsync(new() { Page = 1, Size = 20 }, false);

            Assert.All(result.Items, row => Assert.Null(row.库存单价));
        }
        finally
        {
            Cleanup(c);
        }
    }
}
