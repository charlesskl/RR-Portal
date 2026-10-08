using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReceiptQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 入仓单 RKQ1(已审核)：物料 MRKQ 红100(条码 BC-1)/蓝50；入仓单 RKQ2(未审核)：红30
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'SRKQ',N'入仓查询供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MRKQ',N'入仓查询料',N'规格X',N'米')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'RKQ1','2026-03-10',N'SRKQ',N'入仓查询供应商','1')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'RKQ2','2026-03-20',N'SRKQ',N'入仓查询供应商','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[条码号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注])
                    VALUES(N'RKQ1',N'PO-1',N'BC-1','2026-03-10',N'K1',N'布料',N'MRKQ',N'入仓查询料',N'规格X',N'红',N'米',100,N'红备注'),
                          (N'RKQ1',N'PO-1',N'BC-2','2026-03-10',N'K1',N'布料',N'MRKQ',N'入仓查询料',N'规格X',N'蓝',N'米',50,N'')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[条码号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'RKQ2',N'PO-2',N'BC-3','2026-03-20',N'K1',N'布料',N'MRKQ',N'入仓查询料',N'规格X',N'红',N'米',30)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号] IN (N'RKQ1',N'RKQ2')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKQ1',N'RKQ2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MRKQ'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'SRKQ'");
    }

    [SkippableFact]
    public async Task Detail_maps_入库单号_单号_供应商_and_fields()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ReceiptQueryDetailAsync(null, null, "入仓查询料", null, null);
            Assert.Equal(3, rows.Count);
            var 红1 = rows.First(r => r.入库单号 == "RKQ1" && r.颜色 == "红");
            Assert.Equal("BC-1", 红1.单号);           // 单号 = 条码号
            Assert.Equal("RKQ1", 红1.入库单号);        // 入库单号 = 采购入仓单号(双击键)
            Assert.Equal("PO-1", 红1.订单单号);
            Assert.Equal("入仓查询供应商", 红1.供应商名称);
            Assert.Equal("布料", 红1.物料类别);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("红备注", 红1.备注);
            Assert.Equal("1", 红1.审核);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Detail_filters_by_approval_category_keyword_date()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 已审核 → RKQ1 的 2 行(带种子关键词,避免把库里真实入仓单算进来)
            Assert.Equal(2, (await Svc().ReceiptQueryDetailAsync(null, null, "入仓查询料", null, "已审核")).Count);
            // 未审核 → RKQ2 的 1 行
            Assert.Single(await Svc().ReceiptQueryDetailAsync(null, null, "入仓查询料", null, "未审核"));
            // keyword 命中订单单号 PO-2 → 仅 RKQ2 行
            var byOrder = await Svc().ReceiptQueryDetailAsync(null, null, "PO-2", null, null);
            Assert.Equal("RKQ2", Assert.Single(byOrder).入库单号);
            // 日期 [03-10,03-15] 半开上界 03-16：只含 RKQ1 的 2 行
            var inRange = await Svc().ReceiptQueryDetailAsync(new DateTime(2026,3,10), new DateTime(2026,3,15), "入仓查询料", null, null);
            Assert.Equal(2, inRange.Count);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Summary_shared_groups_by_material_spec_color()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().LabelQuerySummaryAsync(null, null, "入仓查询料", null, null);
            Assert.Equal(2, rows.Count);   // MRKQ红、MRKQ蓝
            Assert.Equal(130m, rows.Single(r => r.颜色 == "红").数量);  // 100+30(跨已/未审核)
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").数量);
        }
        finally { Cleanup(c); }
    }
}
