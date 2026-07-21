using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 签发 JWT：把登录用户的最小身份信息（id/username/role）放进 token。
public class JwtService(IConfiguration cfg)
{
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
            expires: DateTime.UtcNow.AddHours(int.Parse(cfg["Jwt:ExpireHours"]!)),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
