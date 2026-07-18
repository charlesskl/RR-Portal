using System.Text.Json;
using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

// Mounted at /api/purchase to match old Node route exactly
[ApiController]
[Route("api/purchase")]
public class PurchaseOrdersController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet("blob")]
    public async Task<IActionResult> GetBlob()
    {
        using var c = factory.Create();
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM dbo.settings WHERE [key]='purchaseOrders'");
        if (string.IsNullOrWhiteSpace(raw)) return Content("[]", "application/json");
        try { using var _ = JsonDocument.Parse(raw); return Content(raw, "application/json"); }
        catch { return Content("[]", "application/json"); }
    }

    // 排期「已下单」精确关联：返回所有 (tomy_po, product_code) 去重键
    [HttpGet("placed-keys")]
    public async Task<IActionResult> PlacedKeys()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT DISTINCT tomy_po, product_code FROM dbo.po_items
            WHERE tomy_po IS NOT NULL AND tomy_po <> '' AND product_code IS NOT NULL AND product_code <> ''");
        return Ok(rows);
    }

    // 排期「物料单价合计」：按货号在所有 PO 明细聚合 Σ(单价 × 用量)
    [HttpGet("material-cost-by-code")]
    public async Task<IActionResult> MaterialCostByCode()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT product_code AS code,
                   SUM(ISNULL(price,0) * ISNULL(NULLIF(usage_qty,0),1)) AS cost,
                   MAX(currency) AS currency
            FROM dbo.po_items
            WHERE product_code IS NOT NULL AND product_code <> ''
            GROUP BY product_code");
        return Ok(rows);
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT po.*, COUNT(i.id) AS item_count, SUM(i.qty * i.price) AS total_amount
            FROM dbo.purchase_orders po
            LEFT JOIN dbo.po_items i ON i.po_id = po.id
            GROUP BY po.id, po.po_no, po.supplier, po.status, po.order_date, po.delivery_date, po.notes, po.created_at
            ORDER BY po.created_at DESC");
        return Ok(rows);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        using var c = factory.Create();
        var po = await c.QueryFirstOrDefaultAsync("SELECT * FROM dbo.purchase_orders WHERE id=@id", new { id });
        if (po == null) return NotFound(new { error = "not found" });
        var items = (await c.QueryAsync("SELECT * FROM dbo.po_items WHERE po_id=@id ORDER BY id", new { id })).ToList();
        var dict = (IDictionary<string, object?>)po!;
        dict["items"] = items;
        return Ok(dict);
    }

    public class PoBody
    {
        public string? po_no { get; set; }
        public string? supplier { get; set; }
        public string? status { get; set; }
        public DateTime? order_date { get; set; }
        public DateTime? delivery_date { get; set; }
        public string? notes { get; set; }
        public List<PoItemBody>? items { get; set; }
    }
    public class PoItemBody
    {
        public string? product_code { get; set; }
        public int? material_id { get; set; }
        public string? material_name { get; set; }
        public decimal? qty { get; set; }
        public decimal? price { get; set; }
        public string? currency { get; set; }
        public string? notes { get; set; }
        public string? category { get; set; }
        public string? spec { get; set; }
        public decimal? usage_qty { get; set; }
        public decimal? ordered_qty { get; set; }
        public decimal? material_qty { get; set; }
        public decimal? spoilage_qty { get; set; }
        public decimal? purchase_qty { get; set; }
        public string? purchase_unit { get; set; }
        public string? ship_unit { get; set; }
        public decimal? net_per_pc { get; set; }
        public string? eta { get; set; }
        public string? tomy_po { get; set; }   // 来源排期行的 TOMY PO（用于排期「已下单」关联）
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PoBody body)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var id = await c.ExecuteScalarAsync<int>(@"
INSERT INTO dbo.purchase_orders(po_no, supplier, status, order_date, delivery_date, notes)
OUTPUT INSERTED.id
VALUES (@po_no, @supplier, @status, @order_date, @delivery_date, @notes)",
                new { po_no = body.po_no ?? "", supplier = body.supplier ?? "",
                      status = body.status ?? "draft", order_date = body.order_date,
                      delivery_date = body.delivery_date, notes = body.notes ?? "" }, tx);
            foreach (var it in body.items ?? new())
            {
                await c.ExecuteAsync(@"
INSERT INTO dbo.po_items(po_id, product_code, material_id, material_name, qty, price, currency, notes,
                         category, spec, usage_qty, ordered_qty, material_qty, spoilage_qty, purchase_qty, purchase_unit,
                         ship_unit, net_per_pc, eta, tomy_po)
VALUES (@id, @pc, @mid, @mname, @qty, @price, @cur, @notes,
        @cat, @spec, @usage_qty, @ordered_qty, @material_qty, @spoilage_qty, @purchase_qty, @purchase_unit,
        @ship_unit, @net_per_pc, @eta, @tomy_po)",
                    new {
                        id,
                        pc = it.product_code ?? "",
                        mid = it.material_id,
                        mname = it.material_name,
                        qty = it.qty ?? 0,
                        price = it.price ?? 0,
                        cur = string.IsNullOrEmpty(it.currency) ? "¥" : it.currency,
                        notes = it.notes ?? "",
                        cat = it.category,
                        spec = it.spec,
                        usage_qty = it.usage_qty,
                        ordered_qty = it.ordered_qty,
                        material_qty = it.material_qty,
                        spoilage_qty = it.spoilage_qty,
                        purchase_qty = it.purchase_qty,
                        purchase_unit = it.purchase_unit,
                        ship_unit = it.ship_unit,
                        net_per_pc = it.net_per_pc,
                        eta = it.eta,
                        tomy_po = it.tomy_po,
                    }, tx);
            }
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] PoBody body)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var n = await c.ExecuteAsync(@"UPDATE dbo.purchase_orders SET po_no=@po_no, supplier=@supplier,
                status=@status, order_date=@order_date, delivery_date=@delivery_date, notes=@notes WHERE id=@id",
                new { id, po_no = body.po_no ?? "", supplier = body.supplier ?? "",
                      status = body.status ?? "draft", order_date = body.order_date,
                      delivery_date = body.delivery_date, notes = body.notes ?? "" }, tx);
            if (n == 0) { tx.Rollback(); return NotFound(new { error = "采购单不存在" }); }
            await c.ExecuteAsync("DELETE FROM dbo.po_items WHERE po_id=@id", new { id }, tx);
            foreach (var it in body.items ?? new())
            {
                await c.ExecuteAsync(@"
INSERT INTO dbo.po_items(po_id, product_code, material_id, material_name, qty, price, currency, notes,
                         category, spec, usage_qty, ordered_qty, material_qty, spoilage_qty, purchase_qty, purchase_unit,
                         ship_unit, net_per_pc, eta, tomy_po)
VALUES (@id, @pc, @mid, @mname, @qty, @price, @cur, @notes,
        @cat, @spec, @usage_qty, @ordered_qty, @material_qty, @spoilage_qty, @purchase_qty, @purchase_unit,
        @ship_unit, @net_per_pc, @eta, @tomy_po)",
                    new {
                        id,
                        pc = it.product_code ?? "",
                        mid = it.material_id,
                        mname = it.material_name,
                        qty = it.qty ?? 0,
                        price = it.price ?? 0,
                        cur = string.IsNullOrEmpty(it.currency) ? "¥" : it.currency,
                        notes = it.notes ?? "",
                        cat = it.category,
                        spec = it.spec,
                        usage_qty = it.usage_qty,
                        ordered_qty = it.ordered_qty,
                        material_qty = it.material_qty,
                        spoilage_qty = it.spoilage_qty,
                        purchase_qty = it.purchase_qty,
                        purchase_unit = it.purchase_unit,
                        ship_unit = it.ship_unit,
                        net_per_pc = it.net_per_pc,
                        eta = it.eta,
                        tomy_po = it.tomy_po,
                    }, tx);
            }
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Patch(int id, [FromBody] Dictionary<string, object?> body)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "po_no", "supplier", "status", "order_date", "notes" };
        body ??= new();
        var cols = body.Keys.Where(k => allowed.Contains(k)).ToList();
        if (cols.Count == 0) return Ok(new { ok = true });
        using var c = factory.Create();
        var sets = string.Join(",", cols.Select(k => $"[{k}]=@{k}"));
        var dyn = new DynamicParameters();
        foreach (var k in cols) dyn.Add(k, body[k]);
        dyn.Add("id", id);
        await c.ExecuteAsync($"UPDATE dbo.purchase_orders SET {sets} WHERE id=@id", dyn);
        return Ok(new { ok = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("DELETE FROM dbo.purchase_orders WHERE id=@id", new { id });
        return Ok(new { ok = true });
    }
}
