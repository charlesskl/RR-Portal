using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReturnQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 退仓单 CTQ1(已审核)：物料 MCTQ 红100/蓝50；退仓单 CTQ2(未审核)：红30
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'SCTQ',N'退仓查询供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MCTQ',N'退仓查询料',N'规格X',N'米')");
        c.Execute("INSERT INTO [采购退仓单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'CTQ1','2026-03-10',N'SCTQ',N'退仓查询供应商','1')");
        c.Execute("INSERT INTO [采购退仓单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'CTQ2','2026-03-20',N'SCTQ',N'退仓查询供应商','0')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[生产单号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注])
                    VALUES(N'CTQ1',N'SC1','2026-03-10',N'K1',N'布料',N'MCTQ',N'退仓查询料',N'规格X',N'红',N'米',100,N'红备注'),
                          (N'CTQ1',N'SC1','2026-03-10',N'K1',N'布料',N'MCTQ',N'退仓查询料',N'规格X',N'蓝',N'米',50,N'')");
        c.Execute(@"INSERT INTO [采购退仓明细单]([单号],[生产单号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'CTQ2',N'SC2','2026-03-20',N'K1',N'布料',N'MCTQ',N'退仓查询料',N'规格X',N'红',N'米',30)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购退仓明细单] WHERE [单号] IN (N'CTQ1',N'CTQ2')");
        c.Execute("DELETE FROM [采购退仓单] WHERE [单号] IN (N'CTQ1',N'CTQ2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MCTQ'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'SCTQ'");
    }

    [SkippableFact]
    public async Task Detail_returns_lines_with_supplier_and_fields()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ReturnQueryDetailAsync(null, null, "退仓查询料", null, null);
            Assert.Equal(3, rows.Count);
            var 红1 = rows.First(r => r.单号 == "CTQ1" && r.颜色 == "红");
            Assert.Equal("退仓查询供应商", 红1.供应商名称);
            Assert.Equal("SC1", 红1.生产单号);
            Assert.Equal("K1", 红1.款号);
            Assert.Equal("布料", 红1.物料类别);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("红备注", 红1.备注);
            Assert.Equal("1", 红1.审核);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Summary_groups_and_labels_退仓数量()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ReturnQuerySummaryAsync(null, null, "退仓查询料", null, null);
            Assert.Equal(2, rows.Count);  // MCTQ红、MCTQ蓝
            Assert.Equal(130m, rows.Single(r => r.颜色 == "红").退仓数量);  // 100+30(跨已/未审核)
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").退仓数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_approval_category_date()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 已审核 → CTQ1 的 2 行；未审核 → CTQ2 的 1 行
            Assert.Equal(2, (await Svc().ReturnQueryDetailAsync(null, null, null, null, "已审核")).Count);
            Assert.Single(await Svc().ReturnQueryDetailAsync(null, null, null, null, "未审核"));
            // 类别=辅料 → 空
            Assert.Empty(await Svc().ReturnQueryDetailAsync(null, null, null, "辅料", null));
            // 日期 [03-10,03-15] 半开上界 03-16：只含 CTQ1 的 2 行
            var inRange = await Svc().ReturnQueryDetailAsync(new DateTime(2026,3,10), new DateTime(2026,3,15), "退仓查询料", null, null);
            Assert.Equal(2, inRange.Count);
        }
        finally { Cleanup(c); }
    }
}
