using ErpApi.Features.Plastics.PlasticCommonMaterial;
using Xunit;

// 四量一致性规则(套数 = 出模数 ÷ 用量)纯单元测试,不依赖数据库。
public class PlasticCommonMaterialValidationTests
{
    [Fact]
    public void 任一为空时不校验()
    {
        Assert.Null(塑胶共用物料校验.校验套数(null, 4, 1));
        Assert.Null(塑胶共用物料校验.校验套数(4, null, 1));
        Assert.Null(塑胶共用物料校验.校验套数(4, 4, null));
        Assert.Null(塑胶共用物料校验.校验套数(null, null, null));
    }

    [Fact]
    public void 整数关系通过()
    {
        Assert.Null(塑胶共用物料校验.校验套数(4, 4, 1));
        Assert.Null(塑胶共用物料校验.校验套数(2, 8, 4));
    }

    [Fact]
    public void 小数套数通过()
    {
        Assert.Null(塑胶共用物料校验.校验套数(1.5m, 3, 2));
        Assert.Null(塑胶共用物料校验.校验套数(0.5m, 1, 2));
    }

    [Fact]
    public void 不一致时返回中文错误()
    {
        Assert.Equal(塑胶共用物料校验.套数错误消息, 塑胶共用物料校验.校验套数(2, 3, 1));
        Assert.Equal("套数必须等于 出模数 ÷ 用量", 塑胶共用物料校验.套数错误消息);
    }

    [Fact]
    public void 用量为零视为不一致()
    {
        Assert.Equal(塑胶共用物料校验.套数错误消息, 塑胶共用物料校验.校验套数(1, 2, 0));
    }

    [Fact]
    public void 按四位小数精度比较()
    {
        // 1÷3=0.3333…,存 0.3333 视为一致;0.3334 不一致
        Assert.Null(塑胶共用物料校验.校验套数(0.3333m, 1, 3));
        Assert.Equal(塑胶共用物料校验.套数错误消息, 塑胶共用物料校验.校验套数(0.3334m, 1, 3));
    }

    [Fact]
    public void 工模编号留空不校验存在性()
    {
        Assert.False(塑胶共用物料校验.需校验工模编号(null));
        Assert.False(塑胶共用物料校验.需校验工模编号(""));
        Assert.False(塑胶共用物料校验.需校验工模编号("   "));
        Assert.True(塑胶共用物料校验.需校验工模编号("M01"));
    }

    [Fact]
    public void 工模编号不存在消息为中文固定文案()
    {
        Assert.Equal("工模编号不存在于工模表", 塑胶共用物料校验.工模编号不存在消息);
    }
}
