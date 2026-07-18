using System.Text.Json;
using IndoShipping.Api.Auth;
using IndoShipping.Domain.Auth;
using IndoShipping.Domain.Entities;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/quotes")]
[RequirePermission(PermissionPosition.Quotes)]
public class QuotesController(AppDbContext db) : SettingsBlobController(db, "quotes");

[ApiController]
[Route("api/molding-pos")]
[RequirePermission(PermissionPosition.MoldingPos)]
public class MoldingPosController(AppDbContext db) : SettingsBlobController(db, "moldingPOs");

public abstract class SettingsBlobController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly string _key;
    protected SettingsBlobController(AppDbContext db, string key) { _db = db; _key = key; }

    [HttpGet("blob")]
    public async Task<IActionResult> GetBlob()
    {
        var row = await _db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == _key);
        var ver = (row?.UpdatedAt.Ticks ?? 0).ToString();
        Response.Headers["X-Blob-Version"] = ver;
        var raw = row?.Value;
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try
        {
            using var _ = JsonDocument.Parse(raw);
            return Content(raw, "application/json");
        }
        catch
        {
            return Content("[]", "application/json");
        }
    }

    [HttpPut("blob")]
    public async Task<IActionResult> PutBlob([FromBody] JsonElement body)
    {
        var expected = Request.Headers["X-Expected-Version"].FirstOrDefault();
        var raw = body.GetRawText();
        var row = await _db.Settings.FirstOrDefaultAsync(s => s.Key == _key);
        if (!string.IsNullOrEmpty(expected) && row != null && row.UpdatedAt.Ticks.ToString() != expected)
            return Conflict(new { error = "数据已被他人修改，请刷新后重试" });
        if (row == null)
        {
            row = new SettingEntry { Key = _key, Value = raw, UpdatedAt = DateTime.UtcNow };
            _db.Settings.Add(row);
        }
        else
        {
            row.Value = raw;
            row.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        Response.Headers["X-Blob-Version"] = (row?.UpdatedAt.Ticks ?? DateTime.UtcNow.Ticks).ToString();
        return Ok(new { ok = true });
    }
}
