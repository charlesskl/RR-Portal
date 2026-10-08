using ErpApi.Features.Admin;
using ErpApi.Features.MasterData;
using ErpApi.Features.SystemConfig;
using ErpApi.Features.Warehouse;
using Xunit;

public class SystemSettingsAndToolsTests
{
    // —— 功能设置校验 ——
    [Theory]
    [InlineData("HKD")] [InlineData("RMB")] [InlineData("usd")]
    public void 功能设置_合法货币通过(string v)
        => Assert.Null(FeatureSettingsRules.校验(FeatureSettingsRules.默认货币键, v));

    [Theory]
    [InlineData("JPY")] [InlineData("")] [InlineData(null)]
    public void 功能设置_非法货币拒绝(string? v)
        => Assert.NotNull(FeatureSettingsRules.校验(FeatureSettingsRules.默认货币键, v));

    [Theory]
    [InlineData("0")] [InlineData("2")] [InlineData("6")]
    public void 功能设置_合法小数位通过(string v)
        => Assert.Null(FeatureSettingsRules.校验(FeatureSettingsRules.单价小数位键, v));

    [Theory]
    [InlineData("-1")] [InlineData("7")] [InlineData("abc")] [InlineData(null)]
    public void 功能设置_非法小数位拒绝(string? v)
        => Assert.NotNull(FeatureSettingsRules.校验(FeatureSettingsRules.数量小数位键, v));

    [Fact]
    public void 功能设置_未知键拒绝()
        => Assert.NotNull(FeatureSettingsRules.校验("系统.不存在", "1"));

    // —— 仓库位置校验 ——
    [Fact] public void 仓库位置_编号必填() => Assert.NotNull(WarehouseLocationRules.校验(" ", "A仓"));
    [Fact] public void 仓库位置_编号超长拒绝() => Assert.NotNull(WarehouseLocationRules.校验(new string('A', 21), null));
    [Fact] public void 仓库位置_合法通过() => Assert.Null(WarehouseLocationRules.校验("A-01", "A仓1号位"));

    // —— 啤机机型啤工表校验 ——
    [Fact] public void 啤机_机型必填() => Assert.NotNull(InjectionMachineRateRules.校验("", 100m));
    [Fact] public void 啤机_负价拒绝() => Assert.NotNull(InjectionMachineRateRules.校验("120T", -0.01m));
    [Fact] public void 啤机_合法通过() => Assert.Null(InjectionMachineRateRules.校验("120T", 0m));
    [Fact] public void 啤机_价可空() => Assert.Null(InjectionMachineRateRules.校验("168T", null));

    // —— 备份计划 ——
    [Fact]
    public void 备份_文件名含库名时间戳()
    {
        var f = BackupPlan.生成文件名("ERP", new DateTime(2026, 7, 28, 9, 5, 3));
        Assert.Equal("ERP_20260728_090503.bak", f);
    }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("   ")]
    public void 备份_未配置目录拒绝(string? dir) => Assert.NotNull(BackupPlan.校验目录(dir));

    [Fact] public void 备份_相对路径拒绝() => Assert.NotNull(BackupPlan.校验目录("backups/daily"));
    [Fact] public void 备份_绝对路径通过() => Assert.Null(BackupPlan.校验目录("/var/opt/mssql/backup"));

    [Fact]
    public void 备份_库名转义防注入()
    {
        Assert.Equal("[ERP]", BackupPlan.引用库名("ERP"));
        Assert.Equal("[a]]b]", BackupPlan.引用库名("a]b"));
    }
}
