using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Features.Basic;

/// <summary>
/// 工序对照表 CRUD：/api/craft-aliases
/// 权限：GET 全员已登录；POST/PATCH/DELETE 只限 clerk 和 admin
/// </summary>
[ApiController]
[Route("api/craft-aliases")]
[Authorize]
public class CraftAliasesController(AppDbContext db) : ControllerBase
{
    // GET /api/craft-aliases — 列出全部，按 category 再按 alias 排序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var items = await db.CraftAliases
            .OrderBy(x => x.Category)
            .ThenBy(x => x.Alias)
            .ToListAsync();

        return Ok(items.Select(x => new CraftAliasDto(x.Id, x.Alias, x.Category)));
    }

    // POST /api/craft-aliases — 新建一条工序对照
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateCraftAliasRequest req)
    {
        // alias 必填校验
        var alias = req.Alias?.Trim();
        if (string.IsNullOrEmpty(alias))
            return BadRequest(new { error = "小类名必填" });

        // category 必须是 4 大类之一
        if (!CraftTypes.IsValid(req.Category))
            return BadRequest(new { error = "大类无效（手喷/移印/自动喷/UV）" });

        // 唯一性校验：alias 已存在 → 409
        if (await db.CraftAliases.AnyAsync(x => x.Alias == alias))
            return Conflict(new { error = "该小类已存在" });

        var createdBy = User.FindFirst("username")?.Value;
        var entity = new CraftAlias
        {
            Alias = alias,
            Category = req.Category!,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow
        };
        db.CraftAliases.Add(entity);
        await db.SaveChangesAsync();

        return StatusCode(201, new CraftAliasDto(entity.Id, entity.Alias, entity.Category));
    }

    // PATCH /api/craft-aliases/{id} — 编辑（alias 和/或 category 可选传）
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateCraftAliasRequest req)
    {
        var entity = await db.CraftAliases.FindAsync(id);
        if (entity is null) return NotFound(new { error = "对照不存在" });

        // 更新 alias：去空格后非空，且不与其他记录重名
        if (req.Alias is not null)
        {
            var alias = req.Alias.Trim();
            if (string.IsNullOrEmpty(alias))
                return BadRequest(new { error = "小类名必填" });

            // 检查是否与其他记录（不含自身）重名
            if (alias != entity.Alias && await db.CraftAliases.AnyAsync(x => x.Alias == alias && x.Id != id))
                return Conflict(new { error = "该小类已存在" });

            entity.Alias = alias;
        }

        // 更新 category：必须合法
        if (req.Category is not null)
        {
            if (!CraftTypes.IsValid(req.Category))
                return BadRequest(new { error = "大类无效（手喷/移印/自动喷/UV）" });
            entity.Category = req.Category;
        }

        await db.SaveChangesAsync();
        return Ok(new CraftAliasDto(entity.Id, entity.Alias, entity.Category));
    }

    // DELETE /api/craft-aliases/{id} — 硬删除
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var entity = await db.CraftAliases.FindAsync(id);
        if (entity is null) return NotFound(new { error = "对照不存在" });

        db.CraftAliases.Remove(entity);
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }
}
