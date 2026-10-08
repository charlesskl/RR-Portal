using ErpApi.Integrations.SprayPlan;
using Xunit;

// 喷油排期入库申请单 → ERP塑胶入仓单 映射纯函数测试(不连真服务器/数据库)。
public class SprayPlanSyncMappingTests
{
    [Theory]
    [InlineData(100, true)]
    [InlineData(0.0001, true)]
    [InlineData(0, false)]     // 零数量跳过
    [InlineData(-50, false)]   // 负数=调减单,跳过(ERP入仓单不支持负数量)
    public void 数量过滤(decimal 数量, bool 期望)
        => Assert.Equal(期望, SprayPlanSyncMapper.要同步(数量));

    [Theory]
    [InlineData("E-11-04", "35MM眼扣", "E-11-04/35MM眼扣")]   // itemName 非空 → 组合
    [InlineData(null, "35MM眼扣", "35MM眼扣")]                // itemName 空 → partName
    [InlineData("", "35MM眼扣", "35MM眼扣")]
    [InlineData("  ", "35MM眼扣", "35MM眼扣")]
    [InlineData("E-11-04", null, "E-11-04")]                  // partName 空 → itemName 不带斜杠
    [InlineData(null, null, null)]
    public void 物料名称拼接(string? itemName, string? partName, string? 期望)
        => Assert.Equal(期望, SprayPlanSyncMapper.物料名称(itemName, partName));

    [Fact]
    public void 采购单号候选_无横杠只试精确()
    {
        Assert.Equal(["SP20260907001"], SprayPlanSyncMapper.采购单号候选("SP20260907001"));
        Assert.Equal(["CMC2600129"], SprayPlanSyncMapper.采购单号候选("CMC2600129"));
    }

    [Fact]
    public void 采购单号候选_多款号追加最后一个横杠前缀()
    {
        // 多款号推送 externalOrderNo=SPxxx-款号
        Assert.Equal(["SP20260907001-K1", "SP20260907001"], SprayPlanSyncMapper.采购单号候选("SP20260907001-K1"));
        // 款号本身含 '-' 时取最后一个 '-' 前的前缀
        Assert.Equal(["SP20260907001-92125-S001", "SP20260907001-92125"],
            SprayPlanSyncMapper.采购单号候选("SP20260907001-92125-S001"));
        // 首字符是 '-' 不算前缀
        Assert.Equal(["-K1"], SprayPlanSyncMapper.采购单号候选("-K1"));
    }

    [Fact]
    public void 采购单号候选_空单号无候选()
    {
        Assert.Empty(SprayPlanSyncMapper.采购单号候选(null));
        Assert.Empty(SprayPlanSyncMapper.采购单号候选(""));
        Assert.Empty(SprayPlanSyncMapper.采购单号候选("  "));
    }
}
