using IndoShipping.Api.Contracts;
using IndoShipping.Domain.Entities;
using IndoShipping.Infrastructure.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(AppDbContext db, IPasswordHasher hasher) : ControllerBase
{
    public record UserDto(int Id, string Username, string DisplayName, string Userbqrpower, string Usereditpower, bool IsActive, DateTime CreatedAt);
    public record UserCreate(string Username, string Password, string? DisplayName, string? Userbqrpower, string? Usereditpower);
    public record UserUpdate(string? DisplayName, string? Userbqrpower, string? Usereditpower, bool? IsActive);
    public record PasswordChange(string OldPassword, string NewPassword);
    public record AdminPasswordReset(string NewPassword);

    // 简单的"管理员"判定: 9 位权限全 1 = 超管。无此条件不能管账号
    private bool IsAdmin() =>
        User.FindFirst(JwtTokenService.PermissionClaim)?.Value == "111111111" &&
        User.FindFirst(JwtTokenService.EditPermissionClaim)?.Value == "111111111";

    private int CurrentUserId() =>
        int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                  ?? "0");

    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> Me()
    {
        var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == CurrentUserId());
        return u is null ? NotFound() : ToDto(u);
    }

    [HttpPost("me/password")]
    public async Task<IActionResult> ChangeMyPassword(PasswordChange body)
    {
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == CurrentUserId());
        if (u is null) return NotFound();
        if (!hasher.Verify(body.OldPassword, u.PasswordHash))
            return BadRequest(new { error = "原密码错误" });
        if (string.IsNullOrEmpty(body.NewPassword) || body.NewPassword.Length < 6)
            return BadRequest(new { error = "新密码至少 6 位" });
        u.PasswordHash = hasher.Hash(body.NewPassword);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<UserDto>>> List([FromQuery] PagedQuery q)
    {
        if (!IsAdmin()) return Forbid();
        var page = Math.Max(1, q.Page);
        var size = Math.Clamp(q.PageSize, 1, 500);
        var query = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q.Keyword))
        {
            var kw = $"%{q.Keyword.Trim()}%";
            query = query.Where(x => EF.Functions.Like(x.Username, kw) || EF.Functions.Like(x.DisplayName, kw));
        }
        var total = await query.CountAsync();
        var items = await query.OrderBy(x => x.Id)
            .Skip((page - 1) * size).Take(size)
            .Select(x => new UserDto(x.Id, x.Username, x.DisplayName, x.Userbqrpower, x.Usereditpower, x.IsActive, x.CreatedAt))
            .ToListAsync();
        return new PagedResult<UserDto>(items, total, page, size);
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(UserCreate body)
    {
        if (!IsAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrEmpty(body.Password))
            return BadRequest(new { error = "用户名和密码必填" });
        if (body.Password.Length < 6) return BadRequest(new { error = "密码至少 6 位" });

        var power = NormalizePower(body.Userbqrpower);
        var editPower = NormalizePower(body.Usereditpower);

        if (await db.Users.AnyAsync(x => x.Username == body.Username))
            return Conflict(new { error = "用户名已存在" });

        var u = new User
        {
            Username = body.Username.Trim(),
            DisplayName = body.DisplayName ?? body.Username,
            PasswordHash = hasher.Hash(body.Password),
            Userbqrpower = power,
            Usereditpower = editPower,
            IsActive = true,
        };
        db.Users.Add(u);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Me), null, ToDto(u));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, UserUpdate body)
    {
        if (!IsAdmin()) return Forbid();
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (u is null) return NotFound();
        if (id == CurrentUserId() &&
            ((body.Userbqrpower != null && NormalizePower(body.Userbqrpower) != "111111111") ||
             (body.Usereditpower != null && NormalizePower(body.Usereditpower) != "111111111")))
            return BadRequest(new { error = "不能移除自己的管理员权限" });
        if (body.DisplayName != null) u.DisplayName = body.DisplayName;
        if (body.Userbqrpower != null) u.Userbqrpower = NormalizePower(body.Userbqrpower);
        if (body.Usereditpower != null) u.Usereditpower = NormalizePower(body.Usereditpower);
        if (body.IsActive.HasValue)
        {
            // 不能停用自己
            if (id == CurrentUserId() && !body.IsActive.Value)
                return BadRequest(new { error = "不能停用自己的账号" });
            u.IsActive = body.IsActive.Value;
        }
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/password")]
    public async Task<IActionResult> ResetPassword(int id, AdminPasswordReset body)
    {
        if (!IsAdmin()) return Forbid();
        if (string.IsNullOrEmpty(body.NewPassword) || body.NewPassword.Length < 6)
            return BadRequest(new { error = "新密码至少 6 位" });
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (u is null) return NotFound();
        u.PasswordHash = hasher.Hash(body.NewPassword);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!IsAdmin()) return Forbid();
        if (id == CurrentUserId()) return BadRequest(new { error = "不能删除自己" });
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (u is null) return NotFound();
        db.Users.Remove(u);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string NormalizePower(string? p)
    {
        if (string.IsNullOrEmpty(p)) return "000000000";
        var s = new string(p.Where(c => c == '0' || c == '1').Take(9).ToArray());
        return s.PadRight(9, '0');
    }

    private static UserDto ToDto(User u) =>
        new(u.Id, u.Username, u.DisplayName, u.Userbqrpower, u.Usereditpower, u.IsActive, u.CreatedAt);
}
