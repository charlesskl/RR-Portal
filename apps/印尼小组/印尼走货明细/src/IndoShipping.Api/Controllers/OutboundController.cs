using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/outbound")]
public class OutboundController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? po_no)
    {
        using var c = factory.Create();
        var where = string.IsNullOrWhiteSpace(po_no) ? "" : "WHERE o.po_no=@po_no";
        var rows = await c.QueryAsync($@"
            SELECT o.*, m.name_zh AS material_name
            FROM dbo.outbound o
            LEFT JOIN dbo.materials m ON m.id = o.material_id
            {where} ORDER BY o.out_date DESC, o.id DESC", new { po_no });
        return Ok(rows);
    }

    public class CreateBody
    {
        public string? po_no { get; set; }
        public int? material_id { get; set; }
        public decimal? qty { get; set; }
        public DateTime? out_date { get; set; }
        public string? notes { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateBody body)
    {
        using var c = factory.Create();
        await c.ExecuteAsync(@"
INSERT INTO dbo.outbound(po_no, material_id, qty, out_date, notes)
VALUES (@po_no, @material_id, @qty, @out_date, @notes)",
            new { po_no = body.po_no ?? "", body.material_id, qty = body.qty ?? 0, body.out_date, notes = body.notes ?? "" });
        return Ok(new { ok = true });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] CreateBody body)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var n = await c.ExecuteAsync(@"UPDATE dbo.outbound SET po_no=@po_no, material_id=@material_id,
                qty=@qty, out_date=@out_date, notes=@notes WHERE id=@id",
                new { id, po_no = body.po_no ?? "", body.material_id, qty = body.qty ?? 0, body.out_date, notes = body.notes ?? "" }, tx);
            if (n == 0) { tx.Rollback(); return NotFound(new { error = "出库记录不存在" }); }
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("DELETE FROM dbo.outbound WHERE id=@id", new { id });
        return Ok(new { ok = true });
    }

    [HttpGet("summary/by-po")]
    public async Task<IActionResult> SummaryByPo()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT po_no, material_id, SUM(qty) AS total_out
            FROM dbo.outbound GROUP BY po_no, material_id");
        return Ok(rows);
    }

    // 按物料汇总出库（供走货明细「从出库拉物料」选择器）：total_out=Σ出库量，po_nos 去重拼接
    [HttpGet("by-material")]
    public async Task<IActionResult> ByMaterial()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT s.material_id, m.product_code AS code, m.name_zh,
                   s.total_out, s.last_out_date,
                   STRING_AGG(d.po_no, '; ') AS po_nos
            FROM (SELECT material_id, SUM(qty) AS total_out, MAX(out_date) AS last_out_date
                  FROM dbo.outbound WHERE material_id IS NOT NULL GROUP BY material_id) s
            LEFT JOIN dbo.materials m ON m.id = s.material_id
            LEFT JOIN (SELECT DISTINCT material_id, po_no FROM dbo.outbound
                       WHERE po_no IS NOT NULL AND po_no <> '') d ON d.material_id = s.material_id
            GROUP BY s.material_id, m.product_code, m.name_zh, s.total_out, s.last_out_date
            ORDER BY m.product_code, m.name_zh");
        return Ok(rows);
    }
}
