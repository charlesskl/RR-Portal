using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using StitchCostPro.Api.Entities;

namespace StitchCostPro.Api.Features.Auth;

public class JwtOptions
{
    public string Secret { get; set; } = null!;
    public string Issuer { get; set; } = "StitchCostPro";
    public string Audience { get; set; } = "StitchCostPro";
    public int ExpiresMinutes { get; set; } = 480;   // 单厂内网，默认 8 小时
}

public class JwtTokenService(IConfiguration config)
{
    private readonly JwtOptions _opt = config.GetSection("Jwt").Get<JwtOptions>()
        ?? throw new InvalidOperationException("缺少 Jwt 配置");

    public (string token, DateTime expires) Create(SysUser user)
    {
        var expires = DateTime.UtcNow.AddMinutes(_opt.ExpiresMinutes);
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.UserId.ToString()),
            new(ClaimTypes.Name, user.Username),
            new("dept_id", user.DeptId.ToString()),
            new("userbqrpower", user.Userbqrpower ?? new string('0', 9)),
            new(ClaimTypes.Role, user.Role ?? ""),       // 角色：供 [Authorize(Roles=...)] 使用
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opt.Secret));
        var jwt = new JwtSecurityToken(
            issuer: _opt.Issuer,
            audience: _opt.Audience,
            claims: claims,
            expires: expires,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(jwt), expires);
    }
}
