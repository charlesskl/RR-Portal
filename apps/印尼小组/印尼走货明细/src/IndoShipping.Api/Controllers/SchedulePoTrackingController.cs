using System.Data;
using Dapper;
using IndoShipping.Api.Features.Schedules;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/schedules/{id:int}/po-tracking")]
public class SchedulePoTrackingController(ISqlConnectionFactory factory) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(int id, [FromQuery] string? order_no, [FromQuery] string? code, [FromQuery] string? source)
    {
        if (string.IsNullOrWhiteSpace(order_no) || string.IsNullOrWhiteSpace(code) || order_no.Length > 256 || code.Length > 256 || source?.Length > 64)
            return BadRequest(new { error = "请选择包含订单 PO 和完整货号的排期行" });
        using var db = factory.Create();
        db.Open();
        using var tx = db.BeginTransaction(IsolationLevel.RepeatableRead);
        var snapshots = (await db.QueryAsync<(int id, string customer, string? raw)>(
            "SELECT id,customer,raw_rows::text FROM schedules", transaction: tx)).ToList();
        var selected = snapshots.FirstOrDefault(s => s.id == id);
        if (selected.id == 0) return NotFound(new { error = "排期不存在，请刷新后重试" });
        static string Field(System.Text.Json.Nodes.JsonObject row, string name) => ScheduleLineHistory.Field(row, name);
        static SchedulePoTracking.Identity Identity(System.Text.Json.Nodes.JsonObject row, string customer) => new(
            string.IsNullOrWhiteSpace(Field(row, "customer")) ? customer : Field(row, "customer"),
            Field(row, "source"), Field(row, "orderNo"), Field(row, "code"));
        var requested = SchedulePoTracking.Normalize(new(selected.customer, source ?? "", order_no, code));
        var selectedRow = ScheduleLineHistory.Parse(selected.raw).FirstOrDefault(row =>
            SchedulePoTracking.Normalize(Identity(row, selected.customer)) == requested);
        if (selectedRow is null) return NotFound(new { error = "该 PO、货号或来源不属于所选排期，请刷新后重试" });
        var history = snapshots.SelectMany(snapshot => ScheduleLineHistory.Parse(snapshot.raw)
            .Select(row => Identity(row, snapshot.customer))).ToList();
        var codeKey = code.Trim().ToLowerInvariant();
        var purchases = (await db.QueryAsync<SchedulePoTracking.PurchaseLine>("""
            SELECT i.id AS "Id",i.po_id AS "PoId",po.po_no AS "PoNo",i.source_po_no AS "SourcePoNo",
                i.product_code AS "ProductCode",i.tomy_po AS "OrderNos",i.material_id AS "MaterialId",
                COALESCE(NULLIF(i.material_name,''),m.name_zh) AS "MaterialName",COALESCE(i.spec,m.spec) AS "Spec",
                po.supplier AS "Supplier",COALESCE(NULLIF(trim(i.purchase_unit),''),'个') AS "Unit",
                COALESCE(i.purchase_qty,i.qty,0) AS "PurchaseQty",
                COALESCE((SELECT SUM(r.qty) FROM po_receipts r WHERE r.po_item_id=i.id),0) AS "ReceivedQty",
                COALESCE((SELECT SUM(r.spare_qty) FROM po_receipts r WHERE r.po_item_id=i.id),0) AS "SpareQty",
                COALESCE((SELECT SUM(o.qty) FROM outbound o WHERE o.po_item_id=i.id),0) AS "OutboundQty"
            FROM po_items i JOIN purchase_orders po ON po.id=i.po_id LEFT JOIN materials m ON m.id=i.material_id
            WHERE lower(trim(i.product_code))=@codeKey
               OR @codeKey=ANY(regexp_split_to_array(lower(trim(i.product_code)), '\s+/\s+'))
            ORDER BY po.id,i.id
            """, new { codeKey }, tx)).ToList();
        var itemIds = purchases.Select(p => p.Id).ToArray();
        var materialIds = purchases.Where(p => p.MaterialId.HasValue).Select(p => p.MaterialId!.Value).Distinct().ToArray();
        var poKeys = purchases.SelectMany(p => new[] { p.PoNo, p.SourcePoNo }).Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim().ToLowerInvariant()).Distinct().ToArray();
        var movements = (await db.QueryAsync<SchedulePoTracking.Movement>("""
            SELECT si.id AS "Id",si.shipment_id AS "ShipmentId",o.po_item_id AS "PoItemId",
                si.outbound_id AS "OutboundId",o.qty AS "OutboundQty",o.material_id AS "OutboundMaterialId",
                si.material_id AS "MaterialId",COALESCE(NULLIF(si.po_no,''),o.po_no) AS "PoNo",
                si.purchase_unit AS "Unit",COALESCE(si.qty,0) AS "Qty",si.qty IS NOT NULL AS "HasQuantity",s.status AS "Status",
                s.container_no AS "ContainerNo",s.ship_date AS "ShipDate",s.load_date AS "LoadDate",o.out_date AS "OutDate"
            FROM shipment_items si JOIN shipments s ON s.id=si.shipment_id LEFT JOIN outbound o ON o.id=si.outbound_id
            WHERE o.po_item_id=ANY(@itemIds)
               OR (o.po_item_id IS NULL AND si.material_id=ANY(@materialIds)
                   AND EXISTS (SELECT 1 FROM regexp_split_to_table(lower(COALESCE(NULLIF(si.po_no,''),o.po_no)), '[;；]') n
                               WHERE trim(n)=ANY(@poKeys)))
            ORDER BY s.id,si.id
            """, new { itemIds, materialIds, poKeys }, tx)).ToList();
        var materials = SchedulePoTracking.Build(requested, history, purchases, movements);
        tx.Commit();
        return Ok(new
        {
            schedule_id = id, customer = selected.customer, order_no = order_no.Trim(), code = code.Trim(), source = Field(selectedRow, "source"),
            product_name = Field(selectedRow, "productName"), eta = Field(selectedRow, "eta"), as_of = DateTime.UtcNow,
            materials, material_count = materials.Count, purchase_order_count = materials.Select(m => m.po_id).Distinct().Count(),
            completed_count = materials.Count(m => m.status == "complete"),
            review_count = materials.Count(m => m.status == "review"),
            outstanding_count = materials.Count(m => m.status is "partial" or "unshipped"),
        });
    }
}
