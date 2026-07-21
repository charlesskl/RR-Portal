using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Auth;

// 密码校验单测：确认 .NET 端 bcrypt 与现有哈希互通
public class PasswordServiceTests
{
    [Fact]
    public void Verify_ReturnsTrue_ForCorrectPassword()
    {
        var hash = PasswordService.Hash("admin123");
        Assert.True(PasswordService.Verify("admin123", hash));
    }

    [Fact]
    public void Verify_ReturnsFalse_ForWrongPassword()
    {
        var hash = PasswordService.Hash("admin123");
        Assert.False(PasswordService.Verify("wrong", hash));
    }
}
