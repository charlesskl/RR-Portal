using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using IndoShipping.Domain.Entities;
using Microsoft.IdentityModel.Tokens;

namespace IndoShipping.Infrastructure.Auth;

public class JwtOptions
{
    public string Issuer { get; set; } = "IndoShipping";
    public string Audience { get; set; } = "IndoShipping";
    public string Key { get; set; } = "";
    public int ExpiresMinutes { get; set; } = 480;
}

public interface IJwtTokenService
{
    string Issue(User user);
}

public class JwtTokenService(JwtOptions opts) : IJwtTokenService
{
    public const string PermissionClaim = "userbqrpower";
    public const string EditPermissionClaim = "usereditpower";

    public string Issue(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(opts.Key));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(PermissionClaim, user.Userbqrpower),
            new Claim(EditPermissionClaim, user.Usereditpower)
        };
        var token = new JwtSecurityToken(
            issuer: opts.Issuer,
            audience: opts.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(opts.ExpiresMinutes),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
