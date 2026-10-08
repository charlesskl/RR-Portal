using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using Xunit;

public class FactoryProcessMatchTests
{
    [Theory]
    [InlineData("印刷加工", "移印")]
    [InlineData("印刷加工", "印喷")]
    [InlineData("印刷加工", "喷油")]
    [InlineData("印刷加工", "UV打印")]
    [InlineData("电镀加工", "电镀")]
    [InlineData("镭雕", "镭射")]
    [InlineData("车发加工", "车缝")]
    [InlineData("啤机加工", "啤塑")]
    [InlineData("打磨加工", "打磨抛光")] // 未知类别:去「加工」后缀包含匹配
    public void Match_true(string cat, string content) => Assert.True(FactoryProcessMatch.Matches(cat, content));

    [Theory]
    [InlineData("电镀加工", "移印")]
    [InlineData("印刷加工", "电镀")]
    [InlineData("打磨加工", "电镀")]
    [InlineData("电镀加工", null)]   // 行无加工内容=不匹配
    [InlineData("电镀加工", "  ")]
    public void Match_false(string cat, string? content) => Assert.False(FactoryProcessMatch.Matches(cat, content));

    [Theory]
    [InlineData(null, "移印")] // 厂无类别=不限制
    [InlineData("", "移印")]
    public void No_category_means_no_limit(string? cat, string content) => Assert.True(FactoryProcessMatch.Matches(cat, content));
}
