using SprayPlan.Api.Services.Import;
using Xunit;

namespace SprayPlan.Api.Tests.Import;

public class CraftClassifierTests
{
    [Theory]
    [InlineData("移印", "移印")]
    [InlineData("UV", "UV")]
    [InlineData("平板机打印", "UV")]
    [InlineData("自动", "自动喷")]
    [InlineData("自动机", "自动喷")]
    [InlineData("机喷", "自动喷")]
    [InlineData("炒货机", "自动喷")]
    [InlineData("手喷", "手喷")]
    [InlineData("喷油", "手喷")]
    [InlineData("喷油（边）", "手喷")]
    [InlineData("散枪", "手喷")]
    [InlineData("PP水", "手喷")]
    [InlineData("画油", "手喷")]
    [InlineData("洗油", "手喷")]
    public void Classify_KnownCrafts(string raw, string expected)
        => Assert.Equal(expected, CraftClassifier.Classify(raw));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("包装")]
    [InlineData("摆货")]
    [InlineData("炒货")]   // 单独「炒货」无法判定（≠「炒货机」），需人工
    public void Classify_Unknown_ReturnsNull(string? raw)
        => Assert.Null(CraftClassifier.Classify(raw));
}
