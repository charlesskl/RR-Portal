using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReceiptOrderLinkDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Receipt() => new(Factory(), new DocumentNumberGenerator());
    private PurchaseOrderService Order() => new(Factory(), new DocumentNumberGenerator(), new MaterialInventoryService(Factory()));

    private static PurchaseReceiptCreateDto Dto(MaterialDocLineDto line) => new()
    {
        供应商编号 = "ROLSUP", 供应商名称 = "选单测试供应商", 仓库 = "物料仓", 明细 = [line],
    };

    private static void SeedSupplier(SqlConnection c)
        => c.Execute("IF NOT EXISTS(SELECT 1 FROM [供应商资料] WHERE [供应商编号]='ROLSUP') INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES('ROLSUP','选单测试供应商')");

    private static void SeedMaterial(SqlConnection c, string 物料编号, string 物料名称)
        => c.Execute("IF NOT EXISTS(SELECT 1 FROM [物料资料] WHERE [物料编号]=@n) INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(@n,@m,N'米')",
            new { n = 物料编号, m = 物料名称 });

    private static void CleanupMaterial(SqlConnection c, string 物料编号)
        => c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=@n", new { n = 物料编号 });

    [SkippableFact]
    public async Task Create_persists_order_fields_on_detail()
    {
        using var c = fx.Open();
        SeedSupplier(c);
        SeedMaterial(c, "ROL01", "选单料");
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        {
            物料编号 = "ROL01", 物料名称 = "选单料", 规格 = "规A", 颜色 = "红", 单位 = "米",
            数量 = 30, 单价 = 5, 订单单号 = "POROL1", 生产单号 = "MOROL", 款号 = "KROL",
        }), "tester");
        try
        {
            var row = await c.QueryFirstAsync<(string 订单单号, string 生产单号, string 款号, decimal 数量)>(
                "SELECT [订单单号],[生产单号],[款号],[数量] FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            Assert.Equal("POROL1", row.订单单号);
            Assert.Equal("MOROL", row.生产单号);
            Assert.Equal("KROL", row.款号);
            Assert.Equal(30m, row.数量);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
            CleanupMaterial(c, "ROL01");
        }
    }

    [SkippableFact]
    public async Task Create_without_order_fields_leaves_them_null()
    {
        using var c = fx.Open();
        SeedSupplier(c);
        SeedMaterial(c, "ROL02", "无单料");
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        { 物料编号 = "ROL02", 物料名称 = "无单料", 单位 = "米", 数量 = 10 }), "tester");
        try
        {
            var v = c.ExecuteScalar<string?>(
                "SELECT [订单单号] FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            Assert.Null(v);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
            CleanupMaterial(c, "ROL02");
        }
    }

    [SkippableFact]
    public async Task Receipt_with_订单单号_feeds_order_progress()
    {
        using var c = fx.Open();
        SeedSupplier(c);
        SeedMaterial(c, "ROL09", "联动料");
        // 种采购订单 POROL9(已审核) + 明细(物料 ROL09 红 订购100)
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]='POROL9'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]='POROL9'");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POROL9',SYSDATETIME(),N'选单供应商','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'POROL9',SYSDATETIME(),N'ROL09',N'联动料',N'红',N'米',100)");
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        { 物料编号 = "ROL09", 物料名称 = "联动料", 颜色 = "红", 单位 = "米", 数量 = 30, 订单单号 = "POROL9" }), "tester");
        try
        {
            // 入仓需已审核才计入进度
            c.Execute("UPDATE [采购入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            var rows = await Order().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "ROL09", onlyOwed: false);
            var row = Assert.Single(rows);
            Assert.Equal(100m, row.订购数量);
            Assert.Equal(30m, row.入仓数量);   // 入仓带订单号→被进度表关联上
            Assert.Equal(70m, row.欠数);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]='POROL9'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]='POROL9'");
            CleanupMaterial(c, "ROL09");
        }
    }
}
