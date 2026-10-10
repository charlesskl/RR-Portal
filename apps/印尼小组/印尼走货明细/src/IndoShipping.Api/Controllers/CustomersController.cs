using IndoShipping.Api.Auth;
using IndoShipping.Domain.Auth;
using IndoShipping.Domain.Entities;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/customers")]
[RequirePermission(PermissionPosition.Customers)]
public class CustomersController(AppDbContext db) : ControllerBase
{
    public record CreateBody(string Name);

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool includeInactive = false, [FromQuery] bool detailed = false)
    {
        var query = db.Customers.AsNoTracking();
        if (!includeInactive) query = query.Where(x => x.Active);
        query = query.OrderBy(x => x.Name);
        if (detailed)
            return Ok(await query.Select(x => new { name = x.Name, active = x.Active }).ToListAsync());
        return Ok(await query.Select(x => x.Name).ToListAsync());   // back-compat: string[]
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateBody body)
    {
        if (string.IsNullOrWhiteSpace(body.Name)) return BadRequest(new { error = "name required" });
        var name = body.Name.Trim();
        var exists = await db.Customers.AnyAsync(x => x.Name == name);
        if (!exists)
        {
            db.Customers.Add(new Customer { Name = name, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }
        return Ok(new { ok = true });
    }

    // Keep names out of route segments: proxies may decode an encoded slash.
    [HttpPost("restore")]
    public Task<IActionResult> RestoreByName([FromQuery] string name)
        => Restore(name);

    [HttpDelete]
    public Task<IActionResult> DeleteByName([FromQuery] string name, [FromQuery] bool hard = false)
        => Delete(name, hard);

    [HttpPost("{name}/restore")]
    public async Task<IActionResult> Restore(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return BadRequest(new { error = "name required" });
        var c = await db.Customers.FirstOrDefaultAsync(x => x.Name == name);
        if (c != null) { c.Active = true; await db.SaveChangesAsync(); }
        return Ok(new { ok = true });
    }

    [HttpDelete("{name}")]
    public async Task<IActionResult> Delete(string name, [FromQuery] bool hard = false)
    {
        if (string.IsNullOrWhiteSpace(name)) return BadRequest(new { error = "name required" });
        var customer = await db.Customers.FirstOrDefaultAsync(x => x.Name == name);
        if (customer == null) return Ok(new { ok = true });
        if (!hard)
        {
            customer.Active = false;
            await db.SaveChangesAsync();
            return Ok(new { ok = true, softDeleted = true });
        }
        db.Customers.Remove(customer);
        await db.SaveChangesAsync();
        return Ok(new { ok = true, hardDeleted = true });
    }
}
