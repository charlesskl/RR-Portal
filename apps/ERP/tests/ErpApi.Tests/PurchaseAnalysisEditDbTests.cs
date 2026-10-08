using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Production;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 采购分析明细修改(详情页保存):仅分析未审核可改;需订数量/供应商回写 生产BOM物料清单(下单 basis 同源)
[Collection("db")]
public class PurchaseAnalysisEditDbTests(DbFixture fx)
{
    private const string 生产单号 = "PAE-MO";
    private const string 供应商A = "PAES01";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ProductionReportService Svc() => new(Factory(), new MaterialInventoryService(Factory()));

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [生产制单]([生产单号],[审核],[合同号]) VALUES(@mo,'1',N'HT-PAE')", new { mo = 生产单号 });
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(@s,N'PAE供应商')", new { s = 供应商A });
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'PAE-M1',N'PAE物料一',N'个',2)");
        c.Execute(@"INSERT INTO [生产BOM物料清单]([生产单号],[物料编号],[物料名称],[单位],[总数量],[库存数量],[可用库存],[需订数量],[预算单价])
                    VALUES(@mo,N'PAE-M1',N'PAE物料一',N'个',100,0,0,80,2)", new { mo = 生产单号 });
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购分析审核] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=@mo", new { mo = 生产单号 });
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PAE-M1'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=@s", new { s = 供应商A });
    }

    private long RowId(SqlConnection c) => c.ExecuteScalar<long>(
        "SELECT [ID] FROM [生产BOM物料清单] WHERE [生产单号]=@mo AND [物料编号]=N'PAE-M1'", new { mo = 生产单号 });

    [SkippableFact]
    public async Task Update_writes_需订数量_and_supplier_when_unaudited()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var id = RowId(c);
            var n = await Svc().UpdatePurchaseAnalysisAsync(new PurchaseAnalysisSaveDto
            {
                生产单号 = 生产单号,
                明细 = [new PurchaseAnalysisSaveLine { ID = id, 需订数量 = 66, 供应商编号 = 供应商A }],
            });
            Assert.Equal(1, n);
            var row = c.QueryFirst(
                "SELECT [需订数量],[供应商编号],[供应商名称] FROM [生产BOM物料清单] WHERE [ID]=@id", new { id });
            Assert.Equal(66m, (decimal)row.需订数量);
            Assert.Equal(供应商A, (string)row.供应商编号);
            Assert.Equal("PAE供应商", (string)row.供应商名称); // 名称以供应商资料为准
            // 分析查询同步反映
            var analysis = await Svc().PurchaseAnalysisAsync(生产单号);
            Assert.Equal(66m, analysis.Single(r => r.ID == id).需订数量);
            Assert.Equal(供应商A, analysis.Single(r => r.ID == id).供应商编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Update_blocked_when_audited_and_bad_supplier_rejected()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var id = RowId(c);
            // 供应商不存在 → 400 参数错
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().UpdatePurchaseAnalysisAsync(
                new PurchaseAnalysisSaveDto
                {
                    生产单号 = 生产单号,
                    明细 = [new PurchaseAnalysisSaveLine { ID = id, 需订数量 = 1, 供应商编号 = "NO-SUCH" }],
                }));
            // 已审核 → 409 冲突
            c.Execute("INSERT INTO [采购分析审核]([生产单号],[审核],[审核人],[审核时间]) VALUES(@mo,'1',N't',GETDATE())",
                new { mo = 生产单号 });
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().UpdatePurchaseAnalysisAsync(
                new PurchaseAnalysisSaveDto
                {
                    生产单号 = 生产单号,
                    明细 = [new PurchaseAnalysisSaveLine { ID = id, 需订数量 = 66 }],
                }));
            Assert.Contains("反审核", ex.Message);
            // 值未被改动
            Assert.Equal(80m, c.ExecuteScalar<decimal>(
                "SELECT [需订数量] FROM [生产BOM物料清单] WHERE [ID]=@id", new { id }));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Update_with_sync_writes_material_default_supplier_unbind_keeps_master()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            var id = RowId(c);
            // 绑定 + 同步:物料资料.默认供应商被写入(日后新单自动带出)
            await Svc().UpdatePurchaseAnalysisAsync(new PurchaseAnalysisSaveDto
            {
                生产单号 = 生产单号, 同步物料默认供应商 = true,
                明细 = [new PurchaseAnalysisSaveLine { ID = id, 需订数量 = 80, 供应商编号 = 供应商A }],
            });
            Assert.Equal(供应商A, c.ExecuteScalar<string?>(
                "SELECT [供应商编号] FROM [物料资料] WHERE [物料编号]=N'PAE-M1'"));
            // 解绑:行清掉,主档不动(默认供应商保留给日后用)
            await Svc().UpdatePurchaseAnalysisAsync(new PurchaseAnalysisSaveDto
            {
                生产单号 = 生产单号,
                明细 = [new PurchaseAnalysisSaveLine { ID = id, 需订数量 = 80, 供应商编号 = null }],
            });
            var row = c.QueryFirst(
                "SELECT [供应商编号] FROM [生产BOM物料清单] WHERE [ID]=@id", new { id });
            Assert.True(row.供应商编号 == null || ((string)row.供应商编号).Trim() == "");
            Assert.Equal(供应商A, c.ExecuteScalar<string?>(
                "SELECT [供应商编号] FROM [物料资料] WHERE [物料编号]=N'PAE-M1'"));
        }
        finally { Cleanup(c); }
    }

    // 来料仓口径:物料类别含「塑胶」的行 + 未建档物料不进来料分析(归塑胶仓/塑胶采购分析)
    [SkippableFact]
    public async Task Analysis_excludes_plastic_and_unfiled()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[物料类别]) VALUES(N'PAE-PL',N'PAE塑胶件',N'个',N'ZURU塑胶')");
        c.Execute(@"INSERT INTO [生产BOM物料清单]([生产单号],[物料编号],[物料名称],[单位],[总数量],[需订数量])
                    VALUES(@mo,N'PAE-PL',N'PAE塑胶件',N'个',10,10),
                          (@mo,N'PAE-XX',N'未建档件',N'个',5,5)", new { mo = 生产单号 });
        try
        {
            var rows = await Svc().PurchaseAnalysisAsync(生产单号);
            var row = Assert.Single(rows); // 只剩 PAE-M1(无类别)
            Assert.Equal("PAE-M1", row.物料编号);
        }
        finally
        {
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PAE-PL'");
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Analysis_rows_carry_已订数量()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        // 该生产单已下过 30 个 PAE-M1(采购订单+明细)
        c.Execute("INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'PAE-PO1',GETDATE(),@s,N'PAE供应商','1')", new { s = 供应商A });
        c.Execute("INSERT INTO [采购明细单]([单号],[生产单号],[物料编号],[物料名称],[单位],[数量]) VALUES(N'PAE-PO1',@mo,N'PAE-M1',N'PAE物料一',N'个',30)", new { mo = 生产单号 });
        try
        {
            var rows = await Svc().PurchaseAnalysisAsync(生产单号);
            Assert.Equal(30m, rows.Single(r => r.物料编号 == "PAE-M1").已订数量);
        }
        finally
        {
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PAE-PO1'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PAE-PO1'");
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Update_only_touches_rows_of_that_mo()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 别的生产单的行 ID:不在本单下 → 更新 0 行
            c.Execute("INSERT INTO [生产制单]([生产单号],[审核]) VALUES(N'PAE-OTHER','1')");
            c.Execute(@"INSERT INTO [生产BOM物料清单]([生产单号],[物料编号],[物料名称],[单位],[总数量],[需订数量])
                        VALUES(N'PAE-OTHER',N'PAE-M1',N'PAE物料一',N'个',10,10)");
            var otherId = c.ExecuteScalar<long>(
                "SELECT [ID] FROM [生产BOM物料清单] WHERE [生产单号]=N'PAE-OTHER'");
            var n = await Svc().UpdatePurchaseAnalysisAsync(new PurchaseAnalysisSaveDto
            {
                生产单号 = 生产单号,
                明细 = [new PurchaseAnalysisSaveLine { ID = otherId, 需订数量 = 999 }],
            });
            Assert.Equal(0, n);
            Assert.Equal(10m, c.ExecuteScalar<decimal>(
                "SELECT [需订数量] FROM [生产BOM物料清单] WHERE [ID]=@otherId", new { otherId }));
            c.Execute("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=N'PAE-OTHER'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'PAE-OTHER'");
        }
        finally { Cleanup(c); }
    }
}
