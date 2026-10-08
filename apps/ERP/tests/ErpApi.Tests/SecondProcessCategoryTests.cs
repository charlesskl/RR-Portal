using ErpApi.Features.Plastics;
using Xunit;

public class SecondProcessCategoryTests
{
    [Theory]
    // 三种映射(按说明书工序顺序)
    [InlineData("电镀", "印喷", "BD")]
    [InlineData("印喷", "植绒", "AF")]
    [InlineData("印喷", "植发", "AH")]
    // 顺序容错: 先喷油后电镀默认为是先电镀后喷油,仍归 BD
    [InlineData("印喷", "电镀", "BD")]
    [InlineData("喷油", "电镀", "BD")]
    [InlineData("电镀", "喷油", "BD")]
    // "喷油"视同"印喷"
    [InlineData("喷油", "植绒", "AF")]
    [InlineData("喷油", "植发", "AH")]
    // "移印"视同"印喷"
    [InlineData("移印", "植绒", "AF")]
    [InlineData("移印", "电镀", "BD")]
    [InlineData("移印", "植发", "AH")]
    // 带额外描述的文本按包含匹配
    [InlineData("电镀(挂镀)", "印喷色", "BD")]
    public void 推导后缀_三种映射与顺序容错(string 加工内容, string 二次加工内容, string 预期)
        => Assert.Equal(预期, SecondProcessCategory.推导后缀(加工内容, 二次加工内容));

    [Theory]
    // 非二次加工组合 → 无后缀
    [InlineData("电镀", "植绒")]
    [InlineData("植绒", "植发")]
    [InlineData("电镀", "抛光")]
    [InlineData("喷油", "印喷")]   // 同一工序不算二次加工
    [InlineData("移印", "喷油")]   // 归一后同为印喷
    [InlineData("移印", "印喷")]
    [InlineData("抛光", "植绒")]
    public void 推导后缀_非二次加工组合返回空(string 加工内容, string 二次加工内容)
        => Assert.Null(SecondProcessCategory.推导后缀(加工内容, 二次加工内容));

    [Theory]
    [InlineData(null, "植绒")]
    [InlineData("印喷", null)]
    [InlineData("", "")]
    [InlineData("  ", "植绒")]
    public void 推导后缀_缺任一边返回空(string? 加工内容, string? 二次加工内容)
        => Assert.Null(SecondProcessCategory.推导后缀(加工内容, 二次加工内容));

    [Theory]
    // BD 类: 电镀=B(第一次), 印喷=D(第二次);字母绑定工序本身,与录入次序无关
    [InlineData("BD", "电镀", "B")]
    [InlineData("BD", "印喷", "D")]
    [InlineData("BD", "喷油", "D")]
    [InlineData("BD", "移印", "D")]   // 移印视同印喷
    // AF 类: 印喷=A, 植绒=F
    [InlineData("AF", "印喷", "A")]
    [InlineData("AF", "移印", "A")]
    [InlineData("AF", "植绒", "F")]
    // AH 类: 印喷=A, 植发=H
    [InlineData("AH", "印喷", "A")]
    [InlineData("AH", "植发", "H")]
    public void 加工字母_各类别映射(string 类别, string 加工内容, string 预期)
        => Assert.Equal(预期, SecondProcessCategory.加工字母(类别, 加工内容));

    [Theory]
    [InlineData("BD", "植绒")]     // 工序不属于该类别
    [InlineData("AF", "电镀")]
    [InlineData("XX", "印喷")]     // 未知类别
    [InlineData(null, "印喷")]
    [InlineData("BD", null)]
    public void 加工字母_无法识别返回空(string? 类别, string? 加工内容)
        => Assert.Null(SecondProcessCategory.加工字母(类别, 加工内容));
}
