using Dapper;
using ErpApi.Features.Warehouse.Semi.ShortageAnalysis;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

[Collection("db")]
public sealed class SemiFinishedShortageServiceDbTests(DbFixture fx)
{
    [Theory]
    [InlineData("ABC%_[]", "ABC~%~_~[~]")]
    [InlineData("plain", "plain")]
    public void EscapeLikePattern_treats_sql_wildcards_as_literal_text(string value, string expected)
    {
        var method = typeof(SemiFinishedShortageService).GetMethod(
            "EscapeLikePattern",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);

        Assert.NotNull(method);
        Assert.Equal(expected, method.Invoke(null, [value]));
    }

    private static readonly (string Table, string Column)[] RequiredSchema =
    [
        ("生产制单", "生产单号"),
        ("生产制单", "客户名称"),
        ("生产制单", "客户编号"),
        ("生产制单", "款号"),
        ("生产制单", "款式"),
        ("生产制单", "计划数量"),
        ("生产制单", "审核"),
        ("生产制单", "完成"),
        ("半成品共用物料设置", "产品货号"),
        ("半成品共用物料设置", "产品装配名称"),
        ("半成品共用物料设置", "配件编号"),
        ("半成品共用物料设置", "单位"),
        ("半成品入仓单", "单号"),
        ("半成品入仓单", "审核"),
        ("半成品入仓明细单", "单号"),
        ("半成品入仓明细单", "物料编号"),
        ("半成品入仓明细单", "数量"),
        ("半成品领料单", "单号"),
        ("半成品领料单", "审核"),
        ("半成品领料明细单", "单号"),
        ("半成品领料明细单", "物料编号"),
        ("半成品领料明细单", "数量"),
        ("半成品盘点单", "单号"),
        ("半成品盘点单", "审核"),
        ("半成品盘点明细单", "单号"),
        ("半成品盘点明细单", "物料编号"),
        ("半成品盘点明细单", "盈亏数量")
    ];

    private ISqlConnectionFactory Factory()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB"
            })
            .Build();
        return new SqlConnectionFactory(config);
    }

    private SemiFinishedShortageService Service() => new(Factory());

    private SqlConnection OpenConnection()
    {
        Skip.IfNot(fx.Available, "ERP_TEST_DB is not configured");
        try
        {
            return fx.Open();
        }
        catch (SqlException exception)
        {
            Skip.If(true, $"ERP_TEST_DB is unreachable: {exception.Message}");
            throw;
        }
    }

    private static void SkipIfSchemaUnavailable(SqlConnection connection)
    {
        var missing = RequiredSchema
            .Where(requirement => connection.ExecuteScalar<int>(
                """
                SELECT CASE
                    WHEN OBJECT_ID(@TableName, N'U') IS NULL
                      OR COL_LENGTH(@TableName, @ColumnName) IS NULL THEN 1
                    ELSE 0
                END
                """,
                new { TableName = $"[{requirement.Table}]", ColumnName = requirement.Column }) == 1)
            .Select(requirement => $"{requirement.Table}.{requirement.Column}")
            .ToArray();

        Skip.If(missing.Length > 0,
            $"ERP_TEST_DB lacks the semi-finished shortage schema required by the service: {string.Join(", ", missing)}");
    }

    private static void Clean(SqlConnection connection)
    {
        connection.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品入仓单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品领料明细单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品领料单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品盘点单] WHERE [单号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [生产制单] WHERE [生产单号] LIKE N'SFS-%'");
        // 引用行删净后再删 FK 父行：生产制单→客户资料(FK_143)/款号总表(FK_144)，出入仓/领料/盘点明细→物料资料(FK_9/21/13)
        connection.Execute("DELETE FROM [客户资料] WHERE [客户编号] IN (N'C01',N'C02',N'C03',N'C04',N'C-EXPORT',N'C-TIE')");
        connection.Execute("DELETE FROM [款号总表] WHERE [款号] LIKE N'SFS-%'");
        connection.Execute("DELETE FROM [物料资料] WHERE [物料编号] LIKE N'SFS-%'");
    }

    private static void Seed(SqlConnection connection)
    {
        Clean(connection);
        connection.Execute("""
            INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES
            (N'C01',N'客户一'),(N'C02',N'客户二'),(N'C03',N'客户三'),(N'C04',N'客户四'),
            (N'C-EXPORT',N'SFS-EXPORT'),(N'C-TIE',N'SFS-TIE-CUSTOMER');
            INSERT INTO [款号总表]([款号],[款式]) VALUES
            (N'SFS-P1',N'测试产品一'),(N'SFS-P2',N'测试产品二'),(N'SFS-P3',N'测试产品三'),(N'SFS-P4',N'测试产品四'),
            (N'SFS-EXPORT-1',N'Export product one'),(N'SFS-EXPORT-2',N'Export product two'),(N'SFS-TIE',N'Tie product');
            INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES
            (N'SFS-A1',N'配件一',N'PCS');
            INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核],[完成]) VALUES
            (N'SFS-MO-1',N'SFS-P1',N'测试产品一',N'C01',N'客户一',10,'1',N'否'),
            (N'SFS-MO-2',N'SFS-P1',N'测试产品一',N'C01',N'客户一',5,'1',N'否'),
            (N'SFS-MO-3',N'SFS-P2',N'测试产品二',N'C02',N'客户二',8,'0',N'否'),
            (N'SFS-MO-4',N'SFS-P3',N'测试产品三',N'C03',N'客户三',9,'1',N'是'),
            (N'SFS-MO-5',N'SFS-P4',N'测试产品四',N'C04',N'客户四',7,'1',N'否');
            INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[单位]) VALUES
            (N'SFS-P1',N'装配一',N'SFS-A1',N'PCS'),
            (N'SFS-P2',N'装配二',N'SFS-A2',N'PCS'),
            (N'SFS-P3',N'装配三',N'SFS-A3',N'PCS'),
            (N'SFS-P4',N'装配四',N'',N'PCS');
            INSERT INTO [半成品入仓单]([单号],[审核]) VALUES
            (N'SFS-IN-1','1'),
            (N'SFS-IN-2','1'),
            (N'SFS-IN-X','0');
            INSERT INTO [半成品入仓明细单]([单号],[物料编号],[数量]) VALUES
            (N'SFS-IN-1',N'SFS-A1',3),
            (N'SFS-IN-2',N'SFS-A1',4),
            (N'SFS-IN-X',N'SFS-A1',100);
            INSERT INTO [半成品领料单]([单号],[审核]) VALUES
            (N'SFS-OUT-1','1');
            INSERT INTO [半成品领料明细单]([单号],[物料编号],[数量]) VALUES
            (N'SFS-OUT-1',N'SFS-A1',2);
            INSERT INTO [半成品盘点单]([单号],[审核]) VALUES
            (N'SFS-ST-1','1');
            INSERT INTO [半成品盘点明细单]([单号],[物料编号],[盈亏数量]) VALUES
            (N'SFS-ST-1',N'SFS-A1',1);
            """);
    }

    private static void AddExportRows(SqlConnection connection)
    {
        connection.Execute("""
            INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核],[完成]) VALUES
            (N'SFS-MO-EXPORT-1',N'SFS-EXPORT-1',N'Export product one',N'C-EXPORT',N'SFS-EXPORT',4,'1',N'否'),
            (N'SFS-MO-EXPORT-2',N'SFS-EXPORT-2',N'Export product two',N'C-EXPORT',N'SFS-EXPORT',5,'1',N'否');
            INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[单位]) VALUES
            (N'SFS-EXPORT-1',N'Export assembly one',N'SFS-EXPORT-A1',N'PCS'),
            (N'SFS-EXPORT-2',N'Export assembly two',N'SFS-EXPORT-A2',N'PCS');
            """);
    }

    [SkippableFact]
    public async Task List_uses_only_approved_unfinished_demand_and_all_warehouses()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            var result = await Service().ListAsync(new());

            var row = Assert.Single(result.Items);
            Assert.Equal("客户一", row.Customer);
            Assert.Equal("SFS-P1", row.ProductCode);
            Assert.Equal("SFS-A1", row.PartCode);
            Assert.Equal(15m, row.RequiredQuantity);
            Assert.Equal(6m, row.InventoryQuantity);
            Assert.Equal(9m, row.ShortageQuantity);
            Assert.Equal(1, result.Total);
        }
        finally
        {
            Clean(connection);
        }
    }

    [SkippableFact]
    public async Task List_excludes_completed_unapproved_unmapped_and_fully_stocked_rows()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            var result = await Service().ListAsync(new());
            Assert.DoesNotContain(result.Items, row => row.ProductCode is "SFS-P2" or "SFS-P3" or "SFS-P4");

            connection.Execute("UPDATE [半成品入仓明细单] SET [数量]=20 WHERE [单号]=N'SFS-IN-1'");
            Assert.Empty((await Service().ListAsync(new())).Items);
        }
        finally
        {
            Clean(connection);
        }
    }

    [SkippableFact]
    public async Task List_supports_contains_exact_paging_and_stable_primary_order()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            AddExportRows(connection);

            var contains = await Service().ListAsync(new()
            {
                Field = "productName",
                Keyword = "product",
                Page = 1,
                PageSize = 1
            });
            Assert.Equal(2, contains.Total);
            Assert.Single(contains.Items);
            Assert.Equal("SFS-EXPORT-1", contains.Items[0].ProductCode);
            Assert.Equal(1, contains.Page);
            Assert.Equal(1, contains.PageSize);

            var exact = await Service().ListAsync(new()
            {
                Field = "partCode",
                Keyword = "SFS-EXPORT-A2",
                Exact = true
            });
            Assert.Equal("SFS-EXPORT-2", Assert.Single(exact.Items).ProductCode);
        }
        finally
        {
            Clean(connection);
        }
    }

    [SkippableFact]
    public async Task List_uses_secondary_ordering_when_primary_keys_tie()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            connection.Execute("""
                INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核],[完成]) VALUES
                (N'SFS-MO-TIE-1',N'SFS-TIE',N'Zulu product',N'C-TIE',N'SFS-TIE-CUSTOMER',2,'1',N'否'),
                (N'SFS-MO-TIE-2',N'SFS-TIE',N'Alpha product',N'C-TIE',N'SFS-TIE-CUSTOMER',3,'1',N'否');
                INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[单位]) VALUES
                (N'SFS-TIE',N'Tie assembly',N'SFS-TIE-A',N'PCS');
                """);

            var firstPage = await Service().ListAsync(new()
            {
                Field = "productCode",
                Keyword = "SFS-TIE",
                Exact = true,
                Page = 1,
                PageSize = 1
            });
            var secondPage = await Service().ListAsync(new()
            {
                Field = "productCode",
                Keyword = "SFS-TIE",
                Exact = true,
                Page = 2,
                PageSize = 1
            });

            Assert.Equal(2, firstPage.Total);
            Assert.Equal("Alpha product", Assert.Single(firstPage.Items).ProductName);
            Assert.Equal("Zulu product", Assert.Single(secondPage.Items).ProductName);
        }
        finally
        {
            Clean(connection);
        }
    }

    [SkippableFact]
    public async Task Export_ignores_page_size_while_preserving_filter_and_order()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            AddExportRows(connection);
            var query = new SemiFinishedShortageQuery
            {
                Field = "customer",
                Keyword = "SFS-EXPORT",
                Exact = true,
                Page = 2,
                PageSize = 1
            };

            var paged = await Service().ListAsync(query);
            var exported = await Service().ExportAsync(query);

            Assert.Equal(2, paged.Total);
            Assert.Single(paged.Items);
            Assert.Equal(2, exported.Count);
            Assert.Equal(["SFS-EXPORT-1", "SFS-EXPORT-2"], exported.Select(row => row.ProductCode));
        }
        finally
        {
            Clean(connection);
        }
    }

    [SkippableFact]
    public async Task List_preserves_decimal_precision_and_negative_inventory_while_excluding_unapproved_outbound_and_stocktake()
    {
        using var connection = OpenConnection();
        SkipIfSchemaUnavailable(connection);
        Seed(connection);
        try
        {
            connection.Execute("""
                UPDATE [生产制单] SET [计划数量]=10.1250 WHERE [生产单号]=N'SFS-MO-1';
                UPDATE [生产制单] SET [计划数量]=5.2500 WHERE [生产单号]=N'SFS-MO-2';
                UPDATE [半成品入仓明细单] SET [数量]=1.1250 WHERE [单号]=N'SFS-IN-1';
                UPDATE [半成品入仓明细单] SET [数量]=2.2500 WHERE [单号]=N'SFS-IN-2';
                UPDATE [半成品领料明细单] SET [数量]=5.5000 WHERE [单号]=N'SFS-OUT-1';
                UPDATE [半成品盘点明细单] SET [盈亏数量]=-0.1250 WHERE [单号]=N'SFS-ST-1';
                INSERT INTO [半成品领料单]([单号],[审核]) VALUES (N'SFS-OUT-X','0');
                INSERT INTO [半成品领料明细单]([单号],[物料编号],[数量]) VALUES (N'SFS-OUT-X',N'SFS-A1',99.9999);
                INSERT INTO [半成品盘点单]([单号],[审核]) VALUES (N'SFS-ST-X','0');
                INSERT INTO [半成品盘点明细单]([单号],[物料编号],[盈亏数量]) VALUES (N'SFS-ST-X',N'SFS-A1',-88.8888);
                """);

            var row = Assert.Single((await Service().ListAsync(new())).Items);

            Assert.Equal(15.3750m, row.RequiredQuantity);
            Assert.Equal(-2.2500m, row.InventoryQuantity);
            Assert.Equal(17.6250m, row.ShortageQuantity);
        }
        finally
        {
            Clean(connection);
        }
    }
}
