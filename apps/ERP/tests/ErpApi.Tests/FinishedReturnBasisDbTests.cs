using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedReturnBasisDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task SalesReturn_basis_brings_out_issue_detail_lines()
    {
        using var c = fx.Open();
        P5TestData.Seed(c); // 客户 P5C01 / 款号 P5K01 / 生产单 P5SC01
        try
        {
            c.Execute(@"INSERT INTO [成品出仓单]([单号],[日期],[客户编号],[客户名称],[仓库],[审核])
                        VALUES(N'RB_CC1',GETDATE(),N'P5C01',N'P5测试客户',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[日期],[客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_CC1',GETDATE(),N'P5C01',N'P5测试客户',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'01',N'黑色',N'M',10,8,80,'1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[日期],[客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_CC1',GETDATE(),N'P5C01',N'P5测试客户',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'02',N'白色',N'L',5,8,40,'1')");

            var rows = await new FinishedSalesReturnService(Factory(), new DocumentNumberGenerator()).BasisAsync("RB_CC1");
            Assert.Equal(2, rows.Count);
            Assert.All(rows, r => Assert.Equal("P5K01", r.款号));
            Assert.Equal("P5C01", rows[0].客户编号);
            Assert.Contains(rows, r => r.数量 == 10m);
            Assert.Contains(rows, r => r.数量 == 5m);
            Assert.Equal(8m, rows[0].单价);
        }
        finally
        {
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=N'RB_CC1'");
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=N'RB_CC1'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task VendorReturn_basis_brings_out_receipt_detail_lines()
    {
        using var c = fx.Open();
        P5TestData.Seed(c); // 款号 P5K01 / 生产单 P5SC01
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'RB_SUP1'");
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'RB_SUP1',N'RB测试供应商')");
        try
        {
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[审核])
                        VALUES(N'RB_CR1',GETDATE(),N'RB_SUP1',N'RB测试供应商',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_CR1',GETDATE(),N'RB_SUP1',N'RB测试供应商',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'01',N'黑色',N'M',12,7,84,'1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
                        VALUES(N'RB_CR1',GETDATE(),N'RB_SUP1',N'RB测试供应商',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'A床',N'02',N'白色',N'L',6,7,42,'1')");

            var rows = await new FinishedVendorReturnService(Factory(), new DocumentNumberGenerator()).BasisAsync("RB_CR1");
            Assert.Equal(2, rows.Count);
            Assert.All(rows, r => Assert.Equal("P5K01", r.款号));
            Assert.Equal("RB_SUP1", rows[0].供应商编号);
            Assert.Contains(rows, r => r.数量 == 12m);
            Assert.Equal(7m, rows[0].单价);
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=N'RB_CR1'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=N'RB_CR1'");
            P5TestData.Cleanup(c);
            c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'RB_SUP1'");
        }
    }
}
