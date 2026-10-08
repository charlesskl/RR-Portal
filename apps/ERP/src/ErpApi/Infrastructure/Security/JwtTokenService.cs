using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
namespace ErpApi.Infrastructure.Security;

public sealed class JwtTokenService(IConfiguration config) : IJwtTokenService
{
    public static string KeyEnvVar => "ERP_JWT_KEY";

    public string Issue(string userName)
    {
        var key = Environment.GetEnvironmentVariable(KeyEnvVar)
            ?? throw new InvalidOperationException($"JWT 密钥未配置：请设置环境变量 {KeyEnvVar}。");
        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var minutes = int.TryParse(config["Erp:Jwt:ExpireMinutes"], out var m) ? m : 480;
        var token = new JwtSecurityToken(
            issuer: config["Erp:Jwt:Issuer"],
            audience: config["Erp:Jwt:Audience"],
            claims: new[] { new Claim(JwtRegisteredClaimNames.Sub, userName) },
            expires: DateTime.UtcNow.AddMinutes(minutes),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
