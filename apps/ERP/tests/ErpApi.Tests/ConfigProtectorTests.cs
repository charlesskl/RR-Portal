using ErpApi.Infrastructure.Security;
using Xunit;

public class ConfigProtectorTests
{
    private static ConfigProtector P()
    {
        Environment.SetEnvironmentVariable("ERP_CONFIG_KEY", "test-config-key-0123456789");
        return new ConfigProtector();
    }

    [Fact] public void 往返() { var p = P(); var c = p.Encrypt("秘密ABC123"); Assert.Equal("秘密ABC123", p.TryDecrypt(c)); }
    [Fact] public void 随机nonce_两次密文不同() { var p = P(); Assert.NotEqual(p.Encrypt("x"), p.Encrypt("x")); }
    [Fact] public void 篡改返回null() { var p = P(); var c = p.Encrypt("y"); var bad = "A" + c[1..]; Assert.Null(p.TryDecrypt(bad)); }
    [Fact] public void 非base64返回null() { var p = P(); Assert.Null(p.TryDecrypt("!!!notbase64")); }
    [Fact] public void 空串往返() { var p = P(); Assert.Equal("", p.TryDecrypt(p.Encrypt(""))); }
}
