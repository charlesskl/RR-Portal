using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialLabelQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 入仓单 RKLAB1(已审核'1')：物料 MLAB 同规格异色 红100/蓝50 + 物料 MLAB2 绿20
    // 入仓单 RKLAB2(未审核'0')：物料 MLAB 红30(与 RKLAB1 红同 编号+规格+颜色)
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MLAB',N'标签料',N'规格X',N'米')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MLAB2',N'标签料2',N'规格Y',N'个')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[操作员],[审核]) VALUES(N'RKLAB1','2026-03-10',N'tester','1')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[操作员],[审核]) VALUES(N'RKLAB2','2026-03-20',N'tester','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注])
                    VALUES(N'RKLAB1','2026-03-10',N'K1',N'布料',N'MLAB',N'标签料',N'规格X',N'红',N'米',100,N'备注红'),
                          (N'RKLAB1','2026-03-10',N'K1',N'布料',N'MLAB',N'标签料',N'规格X',N'蓝',N'米',50,N'备注蓝'),
                          (N'RKLAB1','2026-03-10',N'K1',N'辅料',N'MLAB2',N'标签料2',N'规格Y',N'绿',N'个',20,N'备注绿')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[日期],[款号],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注])
                    VALUES(N'RKLAB2','2026-03-20',N'K1',N'布料',N'MLAB',N'标签料',N'规格X',N'红',N'米',30,N'追加红')");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号] IN (N'RKLAB1',N'RKLAB2')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKLAB1',N'RKLAB2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'MLAB',N'MLAB2')");
    }

    [SkippableFact]
    public async Task Detail_returns_lines_with_fields()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().LabelQueryDetailAsync(null, null, "标签料", null, null);
            Assert.Equal(4, rows.Count);   // RKLAB1 三行 + RKLAB2 一行
            var 红1 = rows.First(r => r.单号 == "RKLAB1" && r.颜色 == "红");
            Assert.Equal("MLAB", 红1.物料编号);
            Assert.Equal("布料", 红1.物料类别);
            Assert.Equal("K1", 红1.款号);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("备注红", 红1.备注);
            Assert.Equal("1", 红1.审核);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Summary_groups_by_material_spec_color_and_sums()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().LabelQuerySummaryAsync(null, null, "标签料", null, null);
            Assert.Equal(3, rows.Count);   // MLAB红、MLAB蓝、MLAB2绿
            Assert.Equal(130m, rows.Single(r => r.物料编号 == "MLAB" && r.颜色 == "红").数量);  // 100+30(跨已/未审核)
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").数量);
            Assert.Equal(20m, rows.Single(r => r.颜色 == "绿").数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_approval_status()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 已审核：RKLAB1 的 3 行
            var approved = await Svc().LabelQueryDetailAsync(null, null, "标签料", null, "已审核");
            Assert.Equal(3, approved.Count);
            Assert.All(approved, r => Assert.Equal("RKLAB1", r.单号));
            // 未审核：RKLAB2 的 1 行
            var unapproved = await Svc().LabelQueryDetailAsync(null, null, "标签料", null, "未审核");
            var only = Assert.Single(unapproved);
            Assert.Equal("RKLAB2", only.单号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_category_keyword_and_date()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 物料类别=辅料 → 只剩绿(MLAB2)
            var 辅料 = await Svc().LabelQueryDetailAsync(null, null, null, "辅料", null);
            Assert.Equal("MLAB2", Assert.Single(辅料).物料编号);
            // keyword 命中物料编号 MLAB2
            Assert.Single(await Svc().LabelQuerySummaryAsync(null, null, "MLAB2", null, null));
            // 日期 [03-10,03-15] 半开上界 03-16：只含 RKLAB1 的 3 行
            var inRange = await Svc().LabelQueryDetailAsync(new DateTime(2026,3,10), new DateTime(2026,3,15), "标签料", null, null);
            Assert.Equal(3, inRange.Count);
            Assert.All(inRange, r => Assert.Equal("RKLAB1", r.单号));
        }
        finally { Cleanup(c); }
    }
}
