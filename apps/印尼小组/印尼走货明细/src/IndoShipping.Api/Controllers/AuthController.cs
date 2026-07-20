using IndoShipping.Infrastructure.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, IPasswordHasher hasher, IJwtTokenService jwt) : ControllerBase
{
    public record LoginRequest(string Username, string Password);
    public record LoginResponse(string Token, string DisplayName, string Userbqrpower, string Usereditpower);

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == req.Username && u.IsActive);
        if (user is null || !hasher.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { error = "用户名或密码错误" });

        var token = jwt.Issue(user);
        return Ok(new LoginResponse(token, user.DisplayName, user.Userbqrpower, user.Usereditpower));
    }
}
