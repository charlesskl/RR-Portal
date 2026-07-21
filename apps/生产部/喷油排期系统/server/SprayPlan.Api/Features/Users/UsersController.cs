using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Users;

// 用户管理（全部仅主管 admin）——对应现有 /api/users + /api/users/[id]，
// 类级 [Authorize(Roles="admin")] 等价于现有每个方法开头的 requireAdmin()。
// 未登录 → 401（认证失败）；已登录但非 admin → 403（越权），行为与旧逻辑等价。
[ApiController]
[Route("api/users")]
[Authorize(Roles = "admin")]
public class UsersController(AppDbContext db) : ControllerBase
{
    static readonly string[] ValidRoles = ["admin", "clerk", "viewer"];

    // GET /api/users —— 列出所有用户（不含 passwordHash），按 id 升序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var users = await db.Users.OrderBy(u => u.Id)
            .Select(u => new UserListItem(u.Id, u.Username, u.DisplayName, u.Role,
                u.IsActive, u.CreatedAt, u.LastLoginAt))
            .ToListAsync();
        return Ok(users);
    }

    // POST /api/users —— 新建。校验顺序对齐旧逻辑：字段齐全 → 角色合法 → 用户名唯一 → 哈希入库
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password)
            || string.IsNullOrWhiteSpace(req.DisplayName) || string.IsNullOrWhiteSpace(req.Role))
            return BadRequest(new { error = "字段缺失" });

        if (!ValidRoles.Contains(req.Role))
            return BadRequest(new { error = "角色无效" });

        if (await db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict(new { error = "用户名已存在" });

        var now = DateTime.UtcNow;
        var user = new User
        {
            Username = req.Username,
            PasswordHash = PasswordService.Hash(req.Password),
            DisplayName = req.DisplayName,
            Role = req.Role,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return StatusCode(201, new UserItem(user.Id, user.Username, user.DisplayName, user.Role, user.IsActive));
    }

    // GET /api/users/{id} —— 读单个，不存在 404
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var u = await db.Users.FindAsync(id);
        if (u is null) return NotFound(new { error = "用户不存在" });
        return Ok(new UserItem(u.Id, u.Username, u.DisplayName, u.Role, u.IsActive));
    }

    // PATCH /api/users/{id} —— 部分更新，只改请求里给了的字段（null=不改）
    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserRequest req)
    {
        var u = await db.Users.FindAsync(id);
        if (u is null) return NotFound(new { error = "用户不存在" });

        if (req.DisplayName is not null) u.DisplayName = req.DisplayName;
        if (req.Role is not null)
        {
            if (!ValidRoles.Contains(req.Role)) return BadRequest(new { error = "角色无效" });
            u.Role = req.Role;
        }
        if (req.IsActive is not null) u.IsActive = req.IsActive.Value;
        if (!string.IsNullOrEmpty(req.NewPassword)) u.PasswordHash = PasswordService.Hash(req.NewPassword);
        u.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(new UserItem(u.Id, u.Username, u.DisplayName, u.Role, u.IsActive));
    }

    // DELETE /api/users/{id} —— 删除，禁止删自己（避免主管把自己删掉后无人可管）
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var currentId = int.Parse(User.FindFirst("userId")!.Value);
        if (currentId == id) return BadRequest(new { error = "不能删除自己" });

        var u = await db.Users.FindAsync(id);
        if (u is null) return NotFound(new { error = "用户不存在" });

        db.Users.Remove(u);
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }
}
