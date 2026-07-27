using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Auth;

public record LoginRequest(string Username, string Password);
public record LoginResponse(string Token, DateTime Expires, UserInfo User);
public record UserInfo(int UserId, string Username, string DisplayName, int DeptId, string? Userbqrpower, string? Role);

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, JwtTokenService jwt) : ControllerBase
{
    /// <summary>登录：bcrypt 验证密码，签发 JWT。</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<LoginResponse>>> Login(LoginRequest req)
    {
        var user = await db.SysUsers
            .FirstOrDefaultAsync(u => u.Username == req.Username && u.IsActive);

        if (user is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(ApiResponse<LoginResponse>.Fail("账号或密码错误"));

        var (token, expires) = jwt.Create(user);
        var info = new UserInfo(user.UserId, user.Username, user.DisplayName, user.DeptId, user.Userbqrpower, user.Role);
        return Ok(ApiResponse<LoginResponse>.Ok(new LoginResponse(token, expires, info)));
    }

    /// <summary>取当前登录用户（前端刷新校验 token 用）。</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<UserInfo>>> Me([FromServices] ICurrentUser current)
    {
        if (current.UserId is null)
            return Unauthorized(ApiResponse<UserInfo>.Fail("未登录"));

        var user = await db.SysUsers.FindAsync(current.UserId.Value);
        if (user is null)
            return Unauthorized(ApiResponse<UserInfo>.Fail("用户不存在"));

        return Ok(ApiResponse<UserInfo>.Ok(
            new UserInfo(user.UserId, user.Username, user.DisplayName, user.DeptId, user.Userbqrpower, user.Role)));
    }
}
