using System.ComponentModel.DataAnnotations;
using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/materials/tools")]
public class ToolMaterialsController(ISqlConnectionFactory factory) : ControllerBase
{
    public sealed class ToolBody
    {
        public int? id { get; set; }
        public int revision { get; set; }
        [Range(0, 999999999)] public decimal? purchase_price { get; set; }
        [StringLength(3)] public string? purchase_currency { get; set; }
        [Required, StringLength(16), RegularExpression("^(工具|机器设备)$")]
        public string tool_kind { get; set; } = "工具";
        [StringLength(64)] public string related_product_code { get; set; } = "";
        [Required, StringLength(256)] public string name_zh { get; set; } = "";
        [StringLength(256)] public string name_en { get; set; } = "";
        [StringLength(256)] public string spec { get; set; } = "";
        [StringLength(64)] public string material_code { get; set; } = "";
        [StringLength(64)] public string hs_cn { get; set; } = "";
        [StringLength(64)] public string hs_id { get; set; } = "";
        [StringLength(256)] public string supplier { get; set; } = "";
        [StringLength(256)] public string customs_company { get; set; } = "";
        [Required, StringLength(16)] public string unit_kg { get; set; } = "PCE";
        [Range(0, 999999999)] public decimal gross_per_pc { get; set; }
        [Range(0, 999999999)] public decimal net_per_pc { get; set; }
        [Range(0, 999999999)] public decimal length { get; set; }
        [Range(0, 999999999)] public decimal width { get; set; }
        [Range(0, 999999999)] public decimal height { get; set; }
        [Range(0, 999999999)] public decimal qty_per_carton { get; set; }
        [Range(0, 999999999)] public decimal weight_per_carton { get; set; }
        public bool active { get; set; } = true;
        // Only a new image is submitted. Otherwise the existing image is retained.
        [StringLength(8000000)] public string? image { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync("""
            SELECT m.*, t.related_product_code, t.tool_kind, t.revision,
                t.purchase_price, t.purchase_currency, i.data_url AS image
            FROM tool_materials t JOIN materials m ON m.id=t.material_id
            LEFT JOIN images i ON i.id=m.image_id ORDER BY m.id
            """);
        return Ok(rows);
    }

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] List<ToolBody> rows)
    {
        if (rows.Count is 0 or > 500)
            return BadRequest(new { error = "每次保存 1–500 条物料" });
        if (rows.Any(r => r.purchase_price < 0 || r.purchase_price > 999999999 ||
            (r.purchase_currency != null && !new[] { "CNY", "USD", "HKD", "IDR" }.Contains(r.purchase_currency)) ||
            (r.purchase_price.HasValue && r.purchase_currency == null)))
            return BadRequest(new { error = "填写采购单价时必须选择币种（人民币、美金、港币或印尼盾）" });
        if (rows.Any(r => string.IsNullOrWhiteSpace(r.name_zh) ||
            (r.image != null && !System.Text.RegularExpressions.Regex.IsMatch(
                r.image, @"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\r\n]+$"))))
            return BadRequest(new { error = "请填写物料名称；图片仅支持 PNG/JPEG/GIF/WebP" });
        if (rows.Where(r => r.id.HasValue).GroupBy(r => r.id).Any(g => g.Count() > 1))
            return BadRequest(new { error = "同一物料不能重复更新，请检查导入选择" });
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        // Serialize imports so two previews cannot append identical materials concurrently.
        await c.ExecuteAsync("LOCK TABLE tool_materials IN SHARE ROW EXCLUSIVE MODE", transaction: tx);
        var ids = new List<int>();
        foreach (var r in rows)
        {
            r.name_zh = r.name_zh.Trim();
            r.related_product_code = (r.related_product_code ?? "").Trim();
            if (r.id is int existingId)
            {
                var version = await c.QuerySingleOrDefaultAsync<int?>(
                    "SELECT revision FROM tool_materials WHERE material_id=@id",
                    new { id = existingId }, tx);
                if (version == null || version != r.revision)
                    return Conflict(new { error = "物料不存在或已被更新，请刷新后重新核对" });
            }
            else
            {
                var duplicate = await c.ExecuteScalarAsync<bool>("""
                    SELECT EXISTS (
                        SELECT 1 FROM materials m JOIN tool_materials t ON t.material_id=m.id
                        WHERE (length(trim(@material_code)) > 0 AND lower(trim(m.material_code))=lower(trim(@material_code)))
                          OR (lower(trim(m.name_zh))=lower(trim(@name_zh))
                              AND lower(trim(COALESCE(m.spec,'')))=lower(trim(@spec))
                              AND lower(trim(COALESCE(m.supplier,'')))=lower(trim(@supplier))
                              AND t.related_product_code=@related_product_code AND t.tool_kind=@tool_kind)
                    )
                    """, r, tx);
                if (duplicate) return Conflict(new { error = $"“{r.name_zh}”已存在，请刷新并选择更新，不能重复新增" });
            }
            var p = new DynamicParameters(r);
            string? newImageId = null;
            if (!string.IsNullOrWhiteSpace(r.image))
            {
                newImageId = "img_" + Guid.NewGuid().ToString("N");
                await c.ExecuteAsync("INSERT INTO images(id,mime,data_url) VALUES(@id,@mime,@image)",
                    new { id = newImageId, mime = r.image[5..r.image.IndexOf(';')], r.image }, tx);
            }
            p.Add("newImageId", newImageId);
            int id;
            if (r.id.HasValue)
            {
                id = r.id.Value;
                await c.ExecuteAsync("""
                    UPDATE materials SET name_zh=@name_zh,name_en=@name_en,spec=@spec,category=@tool_kind,
                        material_code=@material_code,hs_cn=@hs_cn,hs_id=@hs_id,supplier=@supplier,
                        customs_company=@customs_company,unit_kg=@unit_kg,gross_per_pc=@gross_per_pc,
                        net_per_pc=@net_per_pc,length=@length,width=@width,height=@height,
                        qty_per_carton=@qty_per_carton,weight_per_carton=@weight_per_carton,active=@active,
                        image_id=COALESCE(@newImageId,image_id)
                    WHERE id=@id AND product_code IS NULL;
                    UPDATE tool_materials SET related_product_code=@related_product_code,
                        tool_kind=@tool_kind,purchase_price=@purchase_price,purchase_currency=@purchase_currency,
                        revision=revision+1 WHERE material_id=@id;
                    """, p, tx);
            }
            else
            {
                id = await c.ExecuteScalarAsync<int>("""
                    INSERT INTO materials(name_zh,name_en,spec,category,material_code,hs_cn,hs_id,supplier,
                        customs_company,unit_kg,gross_per_pc,net_per_pc,length,width,height,qty_per_carton,
                        weight_per_carton,active,image_id)
                    VALUES(@name_zh,@name_en,@spec,@tool_kind,@material_code,@hs_cn,@hs_id,@supplier,
                        @customs_company,@unit_kg,@gross_per_pc,@net_per_pc,@length,@width,@height,
                        @qty_per_carton,@weight_per_carton,@active,@newImageId) RETURNING id
                    """, p, tx);
                await c.ExecuteAsync("""
                    INSERT INTO tool_materials(material_id,related_product_code,tool_kind,purchase_price,purchase_currency)
                    VALUES(@id,@related_product_code,@tool_kind,@purchase_price,@purchase_currency)
                    """, new { id, r.related_product_code, r.tool_kind, r.purchase_price, r.purchase_currency }, tx);
            }
            ids.Add(id);
        }
        tx.Commit();
        return Ok(new { ids });
    }
}
