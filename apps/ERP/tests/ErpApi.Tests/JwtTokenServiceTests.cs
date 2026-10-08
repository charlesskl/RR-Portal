using System.IdentityModel.Tokens.Jwt;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

public class JwtTokenServiceTests
{
    private static IJwtTokenService Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
            ["Erp:Jwt:Issuer"]="ErpApi", ["Erp:Jwt:Audience"]="ErpClient", ["Erp:Jwt:ExpireMinutes"]="480"
        }).Build();
        return new JwtTokenService(cfg);
    }

    [Fact]
    public void Token_contains_username_claim()
    {
        var token = Make().Issue("zhangsan");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("zhangsan", jwt.Subject);
        Assert.Equal("ErpApi", jwt.Issuer);
    }
}
