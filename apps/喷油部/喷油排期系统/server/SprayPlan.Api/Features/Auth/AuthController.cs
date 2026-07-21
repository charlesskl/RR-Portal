using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, JwtService jwt) : ControllerBase
{
    [Authorize]
    [HttpGet("session")]
    public IActionResult Session() => NoContent();

    // POST /api/auth/login —— 行为严格对齐现有 src/app/api/auth/login/route.ts
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        // 1. 入参校验 → 400
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "用户名和密码必填" });

        // 2. 查用户 + 校验（不区分"不存在/已禁用/密码错"，统一 401，防枚举）
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == req.Username);
        if (user is null || !user.IsActive || !PasswordService.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { error = "用户名或密码错误" });

        // 3. 签发 JWT，写 HttpOnly Cookie（体验等同现有 iron-session）
        var token = jwt.Issue(user);
        Response.Cookies.Append("sprayplan_session", token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = false, // 生产环境改 true
            Path = Environment.GetEnvironmentVariable("SPRAYPLAN_BASE_PATH") ?? "/",
        });

        // 4. 更新 lastLoginAt（用于后台审计/活跃统计）
        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        // 5. 返回必要信息（不含 passwordHash）
        return Ok(new LoginResponse(user.Id, user.Username, user.DisplayName, user.Role));
    }
}
