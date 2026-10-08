using ErpApi.Infrastructure.Security;
using Xunit;

public class PasswordHasherTests
{
    private readonly IPasswordHasher _h = new BcryptPasswordHasher();

    [Fact]
    public void Hash_then_verify_true()
    {
        var hash = _h.Hash("S3cret!");
        Assert.True(_h.Verify("S3cret!", hash));
        Assert.True(hash.Length <= 60); // 适配 sysfileuser.密码 nvarchar(60)
    }

    [Fact]
    public void Wrong_password_verify_false()
    {
        var hash = _h.Hash("S3cret!");
        Assert.False(_h.Verify("wrong", hash));
    }

    [Fact]
    public void Backdoor_string_is_not_special()
    {
        var hash = _h.Hash("RealPassword");
        Assert.False(_h.Verify("zsbqr.com!#(", hash)); // 原软件万能密码后门必须无效
    }
}
