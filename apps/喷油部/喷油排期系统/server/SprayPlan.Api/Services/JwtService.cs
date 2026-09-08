using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 签发 JWT：把登录用户的最小身份信息（id/username/role）放进 token。
public class JwtService(IConfiguration cfg)
{
    // 登录令牌与浏览器持久 Cookie 共用同一有效期，避免两边到期时间不一致。
    public TimeSpan Lifetime => TimeSpan.FromDays(
        int.TryParse(cfg["Jwt:ExpireDays"], out var days) && days > 0 ? days : 30);

    public string Issue(User user)
    {
        var secret = cfg["Jwt:Secret"]!;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim("userId", user.Id.ToString()),
            new Claim("username", user.Username),
            new Claim(ClaimTypes.Role, user.Role),
        };
        var token = new JwtSecurityToken(
            issuer: cfg["Jwt:Issuer"],
            claims: claims,
            expires: DateTime.UtcNow.Add(Lifetime),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
