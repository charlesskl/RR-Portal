using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseOrderQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    // 两张已审核采购订单：
    //   POQ1(供应商 OPSQ, 日期 2026-03-10)：物料 OPMQ 同规格异色 红100/蓝50；物料 OPMQ2 绿20
    //   POQ2(供应商 OPSQ, 日期 2026-03-20)：物料 OPMQ 红30(与 POQ1 红同 编号+规格+颜色，汇总应累加→130)
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'OPSQ',N'订购查询供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMQ',N'订购查询料',N'规格X',N'米')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMQ2',N'订购查询料2',N'规格Y',N'个')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POQ1','2026-03-10',N'OPSQ',N'订购查询供应商',N'tester','1')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POQ2','2026-03-20',N'OPSQ',N'订购查询供应商',N'tester','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
                    VALUES(N'POQ1','2026-03-10',N'布料',N'OPMQ',N'订购查询料',N'规格X',N'红',N'米',100,2,200,N'备注红'),
                          (N'POQ1','2026-03-10',N'布料',N'OPMQ',N'订购查询料',N'规格X',N'蓝',N'米',50,2,100,N'备注蓝'),
                          (N'POQ1','2026-03-10',N'辅料',N'OPMQ2',N'订购查询料2',N'规格Y',N'绿',N'个',20,5,100,N'备注绿')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
                    VALUES(N'POQ2','2026-03-20',N'布料',N'OPMQ',N'订购查询料',N'规格X',N'红',N'米',30,2,60,N'追加红')");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购明细单] WHERE [单号] IN (N'POQ1',N'POQ2')");
        c.Execute("DELETE FROM [采购订单] WHERE [单号] IN (N'POQ1',N'POQ2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'OPMQ',N'OPMQ2')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'OPSQ'");
    }

    [SkippableFact]
    public async Task Detail_returns_one_row_per_line_with_fields()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().OrderQueryDetailAsync(供应商: "OPSQ", 起: null, 止: null, keyword: null, 物料类别: null);
            Assert.Equal(4, rows.Count);   // POQ1 三行 + POQ2 一行
            var 红1 = rows.First(r => r.单号 == "POQ1" && r.颜色 == "红");
            Assert.Equal("OPMQ", 红1.物料编号);
            Assert.Equal("布料", 红1.物料类别);
            Assert.Equal("规格X", 红1.规格);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("订购查询供应商", 红1.供应商名称);
            Assert.Equal("备注红", 红1.备注);
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
            var rows = await Svc().OrderQuerySummaryAsync(供应商: "OPSQ", 起: null, 止: null, keyword: null, 物料类别: null);
            // 分组键：OPMQ+规格X+红、OPMQ+规格X+蓝、OPMQ2+规格Y+绿 → 3 行
            Assert.Equal(3, rows.Count);
            var 红 = rows.Single(r => r.物料编号 == "OPMQ" && r.颜色 == "红");
            Assert.Equal(130m, 红.订购数量);   // POQ1 红100 + POQ2 红30
            Assert.Equal("规格X", 红.规格);
            Assert.Equal("布料", 红.物料类别);
            Assert.Equal("米", 红.单位);
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").订购数量);
            Assert.Equal(20m, rows.Single(r => r.颜色 == "绿").订购数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_delivery_date_when_date_type_is_交货日期()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POQDLV'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POQDLV'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMDLV'");
        try
        {
            c.Execute(@"INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'OPMDLV',N'交期料',N'米')");
            // 订货日期 03-01，交货日期 03-25
            c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POQDLV','2026-03-01',N'交期供应商','1')");
            c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[交货日期],[物料编号],[物料名称],[单位],[数量])
                        VALUES(N'POQDLV','2026-03-01','2026-03-25',N'OPMDLV',N'交期料',N'米',10)");

            // 按订货日期 [03-20,03-31]：订货 03-01 不在区间 → 空
            Assert.Empty(await Svc().OrderQueryDetailAsync(null, new DateTime(2026,3,20), new DateTime(2026,3,31), "交期料", null, "订货日期"));
            // 按交货日期 [03-20,03-31]：交货 03-25 命中 → 1 行
            var byDelivery = await Svc().OrderQueryDetailAsync(null, new DateTime(2026,3,20), new DateTime(2026,3,31), "交期料", null, "交货日期");
            Assert.Single(byDelivery);
        }
        finally
        {
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POQDLV'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POQDLV'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMDLV'");
        }
    }

    [SkippableFact]
    public async Task Filters_by_date_range_supplier_category_keyword()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 日期 [03-10,03-15] 半开上界 03-16：只含 POQ1 的 3 行
            var inRange = await Svc().OrderQueryDetailAsync("OPSQ", new DateTime(2026,3,10), new DateTime(2026,3,15), null, null);
            Assert.Equal(3, inRange.Count);
            Assert.All(inRange, r => Assert.Equal("POQ1", r.单号));

            // 供应商不匹配 → 空
            Assert.Empty(await Svc().OrderQueryDetailAsync("不存在", null, null, null, null));

            // 物料类别=辅料 → 只剩绿(OPMQ2)那 1 行
            var 辅料 = await Svc().OrderQueryDetailAsync("OPSQ", null, null, null, "辅料");
            var only = Assert.Single(辅料);
            Assert.Equal("OPMQ2", only.物料编号);

            // keyword 命中物料编号 OPMQ2
            var kw = await Svc().OrderQuerySummaryAsync("OPSQ", null, null, "OPMQ2", null);
            Assert.Single(kw);
        }
        finally { Cleanup(c); }
    }
}
