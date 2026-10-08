using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PostingEngineDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string,string?>{ ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Approve_then_unapprove_flips_flag_and_audits()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P0TEST'");
        c.Execute("DELETE FROM [c操作记录] WHERE [操作记录]=N'单号=P0TEST'");
        c.Execute("INSERT INTO [成品入仓单]([单号],[审核]) VALUES('P0TEST','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("成品入仓单", "P0TEST", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P0TEST'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品入仓单] WHERE [单号]='P0TEST'"));

        Assert.False(await engine.ApproveAsync("成品入仓单", "P0TEST", "tester")); // 已是1，重复审核返回false
        Assert.True(await engine.UnapproveAsync("成品入仓单", "P0TEST", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P0TEST'"));

        Assert.True(c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [c操作记录] WHERE [操作记录]=N'单号=P0TEST'") >= 2);
    }

    [SkippableFact]
    public async Task Approve_生产制单_uses_生产单号_column()
    {
        using var c = fx.Open();
        // FK: 生产制单.款号 → 款号总表.款号，先种父行
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]='P2POST01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2POSTK'");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P2POSTK',N'过账测试款')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[审核]) VALUES(N'P2POST01',N'P2POSTK','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("生产制单", "P2POST01", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]='P2POST01'"));
        Assert.Equal("tester", c.ExecuteScalar<string>(
            "SELECT [审核人] FROM [生产制单] WHERE [生产单号]='P2POST01'"));

        Assert.False(await engine.ApproveAsync("生产制单", "P2POST01", "tester")); // 已是1，重复审核返回false

        Assert.True(await engine.UnapproveAsync("生产制单", "P2POST01", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]='P2POST01'"));

        // 清理（FK 顺序：先子后父）
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]='P2POST01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2POSTK'");
    }

    [SkippableFact]
    public async Task Approve_裁床总表_uses_裁床单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P4CBK'");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P4CBK',N'裁床过账测试款')");
        c.Execute("INSERT INTO [裁床总表]([裁床单号],[款号],[审核]) VALUES(N'P4CBPOST1',N'P4CBK','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("裁床总表", "P4CBPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));
        Assert.False(await engine.ApproveAsync("裁床总表", "P4CBPOST1", "tester"));  // 重复审核返回false
        Assert.True(await engine.UnapproveAsync("裁床总表", "P4CBPOST1", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));

        // 清理（FK 顺序：先子后父，裁床总表.款号→款号总表）
        c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P4CBK'");
    }

    [SkippableFact]
    public async Task Approve_发外加工单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [发外加工单] WHERE [单号]='P4FWPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FWF'");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P4FWF',N'发外过账测试厂')");
        c.Execute("INSERT INTO [发外加工单]([单号],[加工厂编号],[审核]) VALUES(N'P4FWPOST1',N'P4FWF','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));
        Assert.False(await engine.ApproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.True(await engine.UnapproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));

        c.Execute("DELETE FROM [发外加工单] WHERE [单号]='P4FWPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FWF'");
    }

    [SkippableFact]
    public async Task Approve_发外回收单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [发外回收单] WHERE [单号]='P4FHPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FHF'");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P4FHF',N'回收过账测试厂')");
        c.Execute("INSERT INTO [发外回收单]([单号],[加工厂编号],[审核]) VALUES(N'P4FHPOST1',N'P4FHF','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("发外回收单", "P4FHPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [发外回收单] WHERE [单号]='P4FHPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [发外回收单] WHERE [单号]='P4FHPOST1'"));
        Assert.False(await engine.ApproveAsync("发外回收单", "P4FHPOST1", "tester"));
        Assert.True(await engine.UnapproveAsync("发外回收单", "P4FHPOST1", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [发外回收单] WHERE [单号]='P4FHPOST1'"));

        c.Execute("DELETE FROM [发外回收单] WHERE [单号]='P4FHPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FHF'");
    }

    [SkippableFact]
    public async Task Approve_成品入仓单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKPOST1'");
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKPOST1',N'P5成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品入仓单", "P5RKPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P5RKPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品入仓单] WHERE [单号]='P5RKPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品入仓单", "P5RKPOST1", "tester"));
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKPOST1'");
    }

    [SkippableFact]
    public async Task Approve_成品盘点单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品盘点单] WHERE [单号]='P5PDPOST1'");
        c.Execute("INSERT INTO [成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5PDPOST1',N'P5成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品盘点单", "P5PDPOST1", "tester"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品盘点单] WHERE [单号]='P5PDPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品盘点单", "P5PDPOST1", "tester"));
        c.Execute("DELETE FROM [成品盘点单] WHERE [单号]='P5PDPOST1'");
    }

    [SkippableFact]
    public async Task Approve_成品调拨单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'");
        c.Execute("INSERT INTO [成品调拨单]([单号],[审核]) VALUES(N'P5BCDPOST1','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品调拨单", "P5BCDPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品调拨单", "P5BCDPOST1", "tester"));
        c.Execute("DELETE FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'");
    }

    [SkippableFact]
    public async Task Approve_半成品入仓单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'");
        c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CBRPOST1',N'P5c半成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("半成品入仓单", "P5CBRPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'"));
        Assert.True(await engine.UnapproveAsync("半成品入仓单", "P5CBRPOST1", "tester"));
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'");
    }
}
