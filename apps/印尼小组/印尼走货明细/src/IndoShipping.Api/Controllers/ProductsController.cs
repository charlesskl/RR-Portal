using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/products")]
public class ProductsController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool includeInactive = false)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT p.code, p.name, p.hs_cn, p.hs_id, p.customer, p.updated_at, p.active,
                   SUM(CASE WHEN m.active=1 THEN 1 ELSE 0 END) AS active_count,
                   COUNT(m.id) AS total_count
            FROM dbo.products p
            LEFT JOIN dbo.materials m ON m.product_code = p.code
            WHERE (@includeInactive = 1 OR p.active = 1)
            GROUP BY p.code, p.name, p.hs_cn, p.hs_id, p.customer, p.updated_at, p.active
            ORDER BY p.updated_at DESC", new { includeInactive });
        return Ok(rows);
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> Get(string code)
    {
        using var c = factory.Create();
        var prod = await c.QueryFirstOrDefaultAsync("SELECT * FROM dbo.products WHERE code=@code", new { code });
        if (prod == null) return NotFound(new { error = "not found" });
        var mats = (await c.QueryAsync(@"
            SELECT m.*, i.data_url AS image
            FROM dbo.materials m LEFT JOIN dbo.images i ON i.id = m.image_id
            WHERE m.product_code=@code ORDER BY m.sort_order, m.id", new { code })).ToList();
        var dict = (IDictionary<string, object?>)prod!;
        object? moldings = new List<object>();
        if (dict.TryGetValue("moldings", out var raw) && raw is string s && !string.IsNullOrWhiteSpace(s))
        {
            try { moldings = System.Text.Json.JsonSerializer.Deserialize<object>(s); } catch { }
        }
        dict["moldings"] = moldings;
        dict["materials"] = mats;
        return Ok(dict);
    }

    public record ProductBody(string? name, string? hs_cn, string? hs_id, string? customer, object? moldings);

    [HttpPut("{code}")]
    public async Task<IActionResult> Upsert(string code, [FromBody] ProductBody body)
    {
        var moldings = body.moldings == null ? null : System.Text.Json.JsonSerializer.Serialize(body.moldings);
        using var c = factory.Create();
        await c.ExecuteAsync(@"
MERGE dbo.products AS t
USING (SELECT @code AS code) s ON t.code = s.code
WHEN MATCHED THEN UPDATE SET name=@name, hs_cn=@hs_cn, hs_id=@hs_id, customer=@customer, moldings=@moldings, updated_at=SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (code, name, hs_cn, hs_id, customer, moldings, updated_at)
    VALUES (@code, @name, @hs_cn, @hs_id, @customer, @moldings, SYSUTCDATETIME());",
            new { code, name = body.name ?? "", hs_cn = body.hs_cn ?? "", hs_id = body.hs_id ?? "", customer = body.customer ?? "", moldings });
        return Ok(new { ok = true });
    }

    [HttpPost("{code}/restore")]
    public async Task<IActionResult> Restore(string code)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("UPDATE dbo.products SET active=1, updated_at=SYSUTCDATETIME() WHERE code=@code", new { code });
        return Ok(new { ok = true });
    }

    [HttpDelete("{code}")]
    public async Task<IActionResult> Delete(string code, [FromQuery] bool hard = false)
    {
        using var c = factory.Create();
        if (!hard)
        {
            await c.ExecuteAsync("UPDATE dbo.products SET active=0, updated_at=SYSUTCDATETIME() WHERE code=@code", new { code });
            return Ok(new { ok = true, softDeleted = true });
        }
        var refCount = await c.ExecuteScalarAsync<int>(@"
SELECT
 (SELECT COUNT(*) FROM dbo.po_items pi JOIN dbo.materials m ON pi.material_id=m.id WHERE m.product_code=@code)
+(SELECT COUNT(*) FROM dbo.outbound o JOIN dbo.materials m ON o.material_id=m.id WHERE m.product_code=@code)
+(SELECT COUNT(*) FROM dbo.shipment_items si JOIN dbo.materials m ON si.material_id=m.id WHERE m.product_code=@code)",
            new { code });
        if (refCount > 0)
            return Conflict(new { error = $"该货号的物料被 {refCount} 处单据引用，无法彻底删除；可改为停用。" });
        await c.ExecuteAsync("DELETE FROM dbo.products WHERE code=@code", new { code }); // materials cascade via FK
        return Ok(new { ok = true, hardDeleted = true });
    }
}
