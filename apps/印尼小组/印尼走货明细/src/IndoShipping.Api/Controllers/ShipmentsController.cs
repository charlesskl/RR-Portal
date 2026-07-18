using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/shipments")]
public class ShipmentsController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT s.*, COUNT(si.id) AS item_count
            FROM dbo.shipments s LEFT JOIN dbo.shipment_items si ON si.shipment_id = s.id
            GROUP BY s.id, s.customer, s.container_no, s.container_count, s.ship_date, s.load_date, s.bl_no, s.rate, s.status, s.created_at
            ORDER BY s.ship_date DESC, s.id DESC");
        return Ok(rows);
    }

    // 已走货的物料 id（出现在任一走货明细行）：出库标"已走货"、拉料时过滤
    [HttpGet("shipped-material-ids")]
    public async Task<IActionResult> ShippedMaterialIds()
    {
        using var c = factory.Create();
        var ids = await c.QueryAsync<int>("SELECT DISTINCT material_id FROM dbo.shipment_items WHERE material_id IS NOT NULL");
        return Ok(ids);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        using var c = factory.Create();
        var sh = await c.QueryFirstOrDefaultAsync("SELECT * FROM dbo.shipments WHERE id=@id", new { id });
        if (sh == null) return NotFound(new { error = "not found" });
        var items = (await c.QueryAsync("SELECT * FROM dbo.shipment_items WHERE shipment_id=@id ORDER BY seq, id", new { id })).ToList();
        var dict = (IDictionary<string, object?>)sh!;
        dict["items"] = items;
        return Ok(dict);
    }

    public class ShBody
    {
        public string? customer { get; set; }
        public string? container_no { get; set; }
        public int? container_count { get; set; }
        public DateTime? ship_date { get; set; }
        public DateTime? load_date { get; set; }
        public string? bl_no { get; set; }
        public decimal? rate { get; set; }
        public string? status { get; set; }
        public List<ShItem>? items { get; set; }
    }
    public class ShItem
    {
        public int? material_id { get; set; }
        public decimal? kg { get; set; }
        public decimal? qty { get; set; }
        public int? cartons { get; set; }
        public string? qty_per_carton { get; set; }
        public string? pallet { get; set; }
        public decimal? price { get; set; }
        public string? currency { get; set; }
        public string? po_no { get; set; }
        public DateTime? po_date { get; set; }
        public string? supplier { get; set; }
        public string? customs_company { get; set; }
        public string? bl_head { get; set; }
        public string? contract_no { get; set; }
        public DateTime? contract_date { get; set; }
        public string? invoice_no { get; set; }
        public DateTime? invoice_date { get; set; }
        public decimal? invoice_price { get; set; }
        public string? product_use { get; set; }
        public string? formula_name { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ShBody s)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var id = await c.ExecuteScalarAsync<int>(@"
INSERT INTO dbo.shipments(customer, container_no, container_count, ship_date, load_date, bl_no, rate, status)
OUTPUT INSERTED.id
VALUES (@customer, @container_no, @container_count, @ship_date, @load_date, @bl_no, @rate, @status)",
                new {
                    customer = s.customer ?? "",
                    container_no = s.container_no ?? "",
                    container_count = s.container_count ?? 1,
                    s.ship_date,
                    s.load_date,
                    bl_no = s.bl_no ?? "",
                    rate = s.rate ?? 0.93m,
                    status = s.status ?? "draft"
                }, tx);
            var items = s.items ?? new();
            for (int i = 0; i < items.Count; i++)
            {
                var it = items[i];
                await c.ExecuteAsync(@"
INSERT INTO dbo.shipment_items(shipment_id, material_id, seq, kg, qty, cartons, qty_per_carton, pallet, price, currency,
    po_no, po_date, supplier, customs_company, bl_head, contract_no, contract_date,
    invoice_no, invoice_date, invoice_price, product_use, formula_name)
VALUES (@id, @material_id, @seq, @kg, @qty, @cartons, @qty_per_carton, @pallet, @price, @currency,
    @po_no, @po_date, @supplier, @customs_company, @bl_head, @contract_no, @contract_date,
    @invoice_no, @invoice_date, @invoice_price, @product_use, @formula_name)",
                    new
                    {
                        id, it.material_id, seq = i + 1,
                        kg = it.kg ?? 0, qty = it.qty ?? 0, cartons = it.cartons ?? 0,
                        qty_per_carton = it.qty_per_carton ?? "",
                        pallet = it.pallet ?? "",
                        price = it.price ?? 0,
                        currency = string.IsNullOrEmpty(it.currency) ? "¥" : it.currency,
                        po_no = it.po_no ?? "", it.po_date,
                        supplier = it.supplier ?? "", customs_company = it.customs_company ?? "",
                        bl_head = it.bl_head ?? "",
                        contract_no = it.contract_no ?? "", it.contract_date,
                        invoice_no = it.invoice_no ?? "", it.invoice_date,
                        invoice_price = it.invoice_price ?? 0,
                        product_use = it.product_use ?? "", formula_name = it.formula_name ?? ""
                    }, tx);
            }
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] ShBody s)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var n = await c.ExecuteAsync(@"UPDATE dbo.shipments SET customer=@customer, container_no=@container_no,
                container_count=@container_count, ship_date=@ship_date, load_date=@load_date, bl_no=@bl_no, rate=@rate, status=@status
                WHERE id=@id",
                new {
                    id,
                    customer = s.customer ?? "",
                    container_no = s.container_no ?? "",
                    container_count = s.container_count ?? 1,
                    s.ship_date,
                    s.load_date,
                    bl_no = s.bl_no ?? "",
                    rate = s.rate ?? 0.93m,
                    status = s.status ?? "draft"
                }, tx);
            if (n == 0) { tx.Rollback(); return NotFound(new { error = "走货不存在" }); }
            await c.ExecuteAsync("DELETE FROM dbo.shipment_items WHERE shipment_id=@id", new { id }, tx);
            var items = s.items ?? new();
            for (int i = 0; i < items.Count; i++)
            {
                var it = items[i];
                await c.ExecuteAsync(@"
INSERT INTO dbo.shipment_items(shipment_id, material_id, seq, kg, qty, cartons, qty_per_carton, pallet, price, currency,
    po_no, po_date, supplier, customs_company, bl_head, contract_no, contract_date,
    invoice_no, invoice_date, invoice_price, product_use, formula_name)
VALUES (@id, @material_id, @seq, @kg, @qty, @cartons, @qty_per_carton, @pallet, @price, @currency,
    @po_no, @po_date, @supplier, @customs_company, @bl_head, @contract_no, @contract_date,
    @invoice_no, @invoice_date, @invoice_price, @product_use, @formula_name)",
                    new
                    {
                        id, it.material_id, seq = i + 1,
                        kg = it.kg ?? 0, qty = it.qty ?? 0, cartons = it.cartons ?? 0,
                        qty_per_carton = it.qty_per_carton ?? "",
                        pallet = it.pallet ?? "",
                        price = it.price ?? 0,
                        currency = string.IsNullOrEmpty(it.currency) ? "¥" : it.currency,
                        po_no = it.po_no ?? "", it.po_date,
                        supplier = it.supplier ?? "", customs_company = it.customs_company ?? "",
                        bl_head = it.bl_head ?? "",
                        contract_no = it.contract_no ?? "", it.contract_date,
                        invoice_no = it.invoice_no ?? "", it.invoice_date,
                        invoice_price = it.invoice_price ?? 0,
                        product_use = it.product_use ?? "", formula_name = it.formula_name ?? ""
                    }, tx);
            }
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("DELETE FROM dbo.shipments WHERE id=@id", new { id });
        return Ok(new { ok = true });
    }
}
