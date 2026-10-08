using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Sales;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SalesReturnServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Basis_带出原销售明细_then_建退货()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [客户资料] WHERE [客户编号]=N'P6AC2') INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P6AC2',N'P6A退客')");
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'P6AM1') INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'P6AM1',N'成品甲')");
        // 造一张销售出货作基准源
        c.Execute("INSERT INTO [销售出货单]([单号],[仓库],[客户编号],[客户名称],[数量],[金额],[审核]) VALUES(N'XSBASE1',N'P6A仓',N'P6AC2',N'P6A退客',10,80,'1')");
        c.Execute("INSERT INTO [销售出货明细单]([单号],[仓库],[客户编号],[客户名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额]) VALUES(N'XSBASE1',N'P6A仓',N'P6AC2',N'P6A退客',N'P6AM1',N'成品甲',N'M',N'黑',N'件',10,8,80)");
        var svc = new SalesReturnService(Factory(), new DocumentNumberGenerator());
        string? rno = null;
        try
        {
            var basis = await svc.BasisAsync("XSBASE1");
            Assert.Single(basis);
            Assert.Equal(10m, basis[0].数量);
            Assert.Equal(8m, basis[0].单价);

            rno = await svc.CreateAsync(new SalesReturnCreateDto
            {
                仓库 = "P6A仓", 销售单号 = "XSBASE1", 客户编号 = "P6AC2", 客户名称 = "P6A退客",
                明细 = [ new SalesReturnLineDto { 物料编号 = "P6AM1", 物料名称 = "成品甲", 规格 = "M", 颜色 = "黑", 单位 = "件", 数量 = 3, 单价 = 8 } ]
            }, "tester");
            Assert.StartsWith("XR", rno);
            var h = c.QueryFirst<(decimal 数量, decimal 金额, string 销售单号)>("SELECT [数量],[金额],[销售单号] FROM [销售退货单] WHERE [单号]=@no", new { no = rno });
            Assert.Equal(3m, h.数量);
            Assert.Equal(24m, h.金额);
            Assert.Equal("XSBASE1", h.销售单号);
        }
        finally
        {
            if (rno != null) { c.Execute("DELETE FROM [销售退货明细单] WHERE [单号]=@no", new { no = rno }); c.Execute("DELETE FROM [销售退货单] WHERE [单号]=@no", new { no = rno }); }
            c.Execute("DELETE FROM [销售出货明细单] WHERE [单号]='XSBASE1'");
            c.Execute("DELETE FROM [销售出货单] WHERE [单号]='XSBASE1'");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P6AM1'");
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P6AC2'");
        }
    }
}
