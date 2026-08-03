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
                   SUM(CASE WHEN m.active THEN 1 ELSE 0 END) AS active_count,
                   COUNT(m.id) AS total_count
            FROM products p
            LEFT JOIN materials m ON m.product_code = p.code
            WHERE (@includeInactive OR p.active)
            GROUP BY p.code, p.name, p.hs_cn, p.hs_id, p.customer, p.updated_at, p.active
            ORDER BY p.updated_at DESC", new { includeInactive });
        return Ok(rows);
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> Get(string code)
    {
        using var c = factory.Create();
        var prod = await c.QueryFirstOrDefaultAsync("SELECT * FROM products WHERE code=@code", new { code });
        if (prod == null) return NotFound(new { error = "not found" });
        var mats = (await c.QueryAsync(@"
            SELECT m.*, i.data_url AS image
            FROM materials m LEFT JOIN images i ON i.id = m.image_id
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
INSERT INTO products(code, name, hs_cn, hs_id, customer, moldings, updated_at)
VALUES (@code, @name, @hs_cn, @hs_id, @customer, CAST(@moldings AS jsonb), now())
ON CONFLICT (code) DO UPDATE SET
    name=EXCLUDED.name, hs_cn=EXCLUDED.hs_cn, hs_id=EXCLUDED.hs_id,
    customer=EXCLUDED.customer, moldings=EXCLUDED.moldings, updated_at=now();",
            new { code, name = body.name ?? "", hs_cn = body.hs_cn ?? "", hs_id = body.hs_id ?? "", customer = body.customer ?? "", moldings });
        return Ok(new { ok = true });
    }

    [HttpPost("{code}/restore")]
    public async Task<IActionResult> Restore(string code)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("UPDATE products SET active=true, updated_at=now() WHERE code=@code", new { code });
        return Ok(new { ok = true });
    }

    [HttpDelete("{code}")]
    public async Task<IActionResult> Delete(string code, [FromQuery] bool hard = false)
    {
        using var c = factory.Create();
        if (!hard)
        {
            await c.ExecuteAsync("UPDATE products SET active=false, updated_at=now() WHERE code=@code", new { code });
            return Ok(new { ok = true, softDeleted = true });
        }
        var refCount = await c.ExecuteScalarAsync<int>(@"
SELECT
 (SELECT COUNT(*) FROM po_items pi JOIN materials m ON pi.material_id=m.id WHERE m.product_code=@code)
+(SELECT COUNT(*) FROM outbound o JOIN materials m ON o.material_id=m.id WHERE m.product_code=@code)
+(SELECT COUNT(*) FROM shipment_items si JOIN materials m ON si.material_id=m.id WHERE m.product_code=@code)",
            new { code });
        if (refCount > 0)
            return Conflict(new { error = $"该货号的物料被 {refCount} 处单据引用，无法彻底删除；可改为停用。" });
        await c.ExecuteAsync("DELETE FROM products WHERE code=@code", new { code }); // materials cascade via FK
        return Ok(new { ok = true, hardDeleted = true });
    }
}
