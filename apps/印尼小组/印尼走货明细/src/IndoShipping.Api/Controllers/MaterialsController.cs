using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/materials")]
public class MaterialsController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
            return BadRequest(new { error = "code required" });
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT m.*, i.data_url AS image
            FROM dbo.materials m LEFT JOIN dbo.images i ON i.id = m.image_id
            WHERE m.product_code=@code ORDER BY m.sort_order, m.id", new { code });
        return Ok(rows);
    }

    // 按 id 批量取物料（走货明细核对警告需要已存明细的 gross/net 等）
    [HttpGet("by-ids")]
    public async Task<IActionResult> ByIds([FromQuery] string? ids)
    {
        var idList = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var n) ? n : (int?)null)
            .Where(n => n.HasValue).Select(n => n!.Value).Distinct().ToArray();
        if (idList.Length == 0) return Ok(Array.Empty<object>());
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT m.*, i.data_url AS image
            FROM dbo.materials m LEFT JOIN dbo.images i ON i.id = m.image_id
            WHERE m.id IN @ids", new { ids = idList });
        return Ok(rows);
    }

    public class DimsBody
    {
        public decimal? length { get; set; }
        public decimal? width { get; set; }
        public decimal? height { get; set; }
        public decimal? weight_per_carton { get; set; }
        public decimal? gross_per_pc { get; set; }
        public decimal? net_per_pc { get; set; }
        public string? unit_kg { get; set; }
    }

    // 走货明细写回货号库：仅尺寸/毛净重/单位（旧系统 s3SaveMatField/s3SaveUnit 行为）
    [HttpPut("{id:int}/dims")]
    public async Task<IActionResult> UpdateDims(int id, [FromBody] DimsBody body)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
            UPDATE dbo.materials SET
                length=@length, width=@width, height=@height,
                weight_per_carton=@weight_per_carton, gross_per_pc=@gross_per_pc, net_per_pc=@net_per_pc,
                unit_kg=ISNULL(NULLIF(@unit_kg,''),'KGM')
            WHERE id=@id",
            new
            {
                id,
                length = body.length ?? 0m, width = body.width ?? 0m, height = body.height ?? 0m,
                weight_per_carton = body.weight_per_carton ?? 0m,
                gross_per_pc = body.gross_per_pc ?? 0m, net_per_pc = body.net_per_pc ?? 0m,
                unit_kg = body.unit_kg ?? "",
            });
        if (n == 0) return NotFound(new { error = "物料不存在" });
        return Ok(new { ok = true, id });
    }

    public class BulkBody
    {
        public List<Dictionary<string, object?>>? materials { get; set; }
    }

    [HttpPut("bulk/{code}")]
    public async Task<IActionResult> BulkReplace(string code, [FromBody] BulkBody body)
    {
        var list = body?.materials ?? new();
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var existing = (await c.QueryAsync<int>("SELECT id FROM dbo.materials WHERE product_code=@code", new { code }, tx)).ToHashSet();
            var keepIds = new HashSet<int>();
            for (int i = 0; i < list.Count; i++)
            {
                var m = list[i];
                object? Get(string k) => m.TryGetValue(k, out var v) ? v : null;
                decimal Dec(string k) => decimal.TryParse(Get(k)?.ToString(), out var d) ? d : 0m;
                decimal usageVal = Dec("usage");
                if (usageVal == 0m) usageVal = Dec("usage_qty");
                if (usageVal == 0m) usageVal = 1m;
                int? id = int.TryParse(Get("id")?.ToString(), out var pid) ? pid : (int?)null;

                if (id is int x && existing.Contains(x))
                {
                    await c.ExecuteAsync(@"
                        UPDATE dbo.materials SET item_no=@itemNo, name_zh=@nameZh, name_en=@nameEn, spec=@spec,
                            category=@category, material_code=@materialCode, hs_cn=@hsCN, hs_id=@hsID,
                            supplier=@supplier, customs_company=@customsCompany, unit_kg=@unitKg,
                            gross_per_pc=@grossPerPc, net_per_pc=@netPerPc, length=@length, width=@width, height=@height,
                            qty_per_carton=@qtyPerCarton, weight_per_carton=@weightPerCarton,
                            image_id=@imageId, active=@active, sort_order=@sortOrder, usage_qty=@usageQty
                        WHERE id=@id",
                        new
                        {
                            id = x,
                            itemNo = Get("itemNo")?.ToString() ?? "",
                            nameZh = Get("nameZh")?.ToString() ?? "",
                            nameEn = Get("nameEn")?.ToString() ?? "",
                            spec = Get("spec")?.ToString() ?? "",
                            category = Get("category")?.ToString() ?? "",
                            materialCode = Get("materialCode")?.ToString() ?? "",
                            hsCN = Get("hsCN")?.ToString() ?? "",
                            hsID = Get("hsID")?.ToString() ?? "",
                            supplier = Get("supplier")?.ToString() ?? "",
                            customsCompany = Get("customsCompany")?.ToString() ?? "",
                            unitKg = Get("unitKg")?.ToString() ?? "KGM",
                            grossPerPc = Dec("grossPerPc"),
                            netPerPc = Dec("netPerPc"),
                            length = Dec("length"),
                            width = Dec("width"),
                            height = Dec("height"),
                            qtyPerCarton = Dec("qtyPerCarton"),
                            weightPerCarton = Dec("weightPerCarton"),
                            imageId = Get("imageId")?.ToString(),
                            active = Get("active") is bool b ? (b ? 1 : 0) : 1,
                            sortOrder = i,
                            usageQty = usageVal,
                        }, tx);
                    keepIds.Add(x);
                }
                else
                {
                    var newId = await c.ExecuteScalarAsync<int>(@"
                        INSERT INTO dbo.materials(product_code, item_no, name_zh, name_en, spec, category, material_code,
                            hs_cn, hs_id, supplier, customs_company, unit_kg,
                            gross_per_pc, net_per_pc, length, width, height, qty_per_carton, weight_per_carton,
                            image_id, active, sort_order, usage_qty)
                        OUTPUT INSERTED.id
                        VALUES (@product_code, @itemNo, @nameZh, @nameEn, @spec, @category, @materialCode,
                            @hsCN, @hsID, @supplier, @customsCompany, @unitKg,
                            @grossPerPc, @netPerPc, @length, @width, @height, @qtyPerCarton, @weightPerCarton,
                            @imageId, @active, @sortOrder, @usageQty)",
                        new
                        {
                            product_code = code,
                            itemNo = Get("itemNo")?.ToString() ?? "",
                            nameZh = Get("nameZh")?.ToString() ?? "",
                            nameEn = Get("nameEn")?.ToString() ?? "",
                            spec = Get("spec")?.ToString() ?? "",
                            category = Get("category")?.ToString() ?? "",
                            materialCode = Get("materialCode")?.ToString() ?? "",
                            hsCN = Get("hsCN")?.ToString() ?? "",
                            hsID = Get("hsID")?.ToString() ?? "",
                            supplier = Get("supplier")?.ToString() ?? "",
                            customsCompany = Get("customsCompany")?.ToString() ?? "",
                            unitKg = Get("unitKg")?.ToString() ?? "KGM",
                            grossPerPc = Dec("grossPerPc"),
                            netPerPc = Dec("netPerPc"),
                            length = Dec("length"),
                            width = Dec("width"),
                            height = Dec("height"),
                            qtyPerCarton = Dec("qtyPerCarton"),
                            weightPerCarton = Dec("weightPerCarton"),
                            imageId = Get("imageId")?.ToString(),
                            active = Get("active") is bool b ? (b ? 1 : 0) : 1,
                            sortOrder = i,
                            usageQty = usageVal,
                        }, tx);
                    keepIds.Add(newId);
                }
            }

            foreach (var oldId in existing.Where(e => !keepIds.Contains(e)))
            {
                var refd = await c.ExecuteScalarAsync<int>(
                    "SELECT (SELECT COUNT(*) FROM dbo.po_items WHERE material_id=@id)+(SELECT COUNT(*) FROM dbo.outbound WHERE material_id=@id)+(SELECT COUNT(*) FROM dbo.shipment_items WHERE material_id=@id)",
                    new { id = oldId }, tx);
                if (refd > 0)
                    await c.ExecuteAsync("UPDATE dbo.materials SET active=0 WHERE id=@id", new { id = oldId }, tx);
                else
                    await c.ExecuteAsync("DELETE FROM dbo.materials WHERE id=@id", new { id = oldId }, tx);
            }

            tx.Commit();
            return Ok(new { ok = true, count = list.Count });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Patch(int id, [FromBody] Dictionary<string, object?> body)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "name_zh","name_en","spec","category","supplier","customs_company","unit_kg",
            "gross_per_pc","net_per_pc","length","width","height","qty_per_carton","weight_per_carton",
            "hs_cn","hs_id","active","image_id","usage_qty"
        };
        body ??= new();
        var cols = body.Keys.Where(k => allowed.Contains(k)).ToList();
        if (cols.Count == 0) return Ok(new { ok = true, noop = true });
        using var c = factory.Create();
        var sets = string.Join(",", cols.Select(k => $"[{k}]=@{k}"));
        var dyn = new DynamicParameters();
        foreach (var k in cols) dyn.Add(k, body[k]);
        dyn.Add("id", id);
        await c.ExecuteAsync($"UPDATE dbo.materials SET {sets} WHERE id=@id", dyn);
        return Ok(new { ok = true });
    }
}
