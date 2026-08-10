using Dapper;
using IndoShipping.Api.Auditing;
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
            WITH receipt_totals AS (
                SELECT po_item_id, SUM(qty) AS received_qty
                FROM po_receipts
                GROUP BY po_item_id
            ),
            outbound_totals AS (
                SELECT po_item_id, SUM(qty) AS total_out
                FROM outbound
                WHERE po_item_id IS NOT NULL
                GROUP BY po_item_id
            ),
            allocation_totals AS (
                SELECT outbound_id, SUM(qty) AS allocated_qty
                FROM shipment_items
                WHERE outbound_id IS NOT NULL
                GROUP BY outbound_id
            )
            SELECT o.*,
                   i.product_code,
                   COALESCE(i.material_name, m.name_zh) AS material_name,
                   po.supplier,
                   COALESCE(r.received_qty, 0) AS received_qty,
                   COALESCE(s.total_out, 0) AS total_out,
                   GREATEST(COALESCE(r.received_qty, 0) - COALESCE(s.total_out, 0), 0) AS available_qty,
                   COALESCE(a.allocated_qty, 0) AS allocated_qty,
                   GREATEST(COALESCE(o.qty, 0) - COALESCE(a.allocated_qty, 0), 0) AS unallocated_qty
            FROM outbound o
            LEFT JOIN po_items i ON i.id = o.po_item_id
            LEFT JOIN purchase_orders po ON po.id = i.po_id
            LEFT JOIN materials m ON m.id = o.material_id
            LEFT JOIN receipt_totals r ON r.po_item_id = o.po_item_id
            LEFT JOIN outbound_totals s ON s.po_item_id = o.po_item_id
            LEFT JOIN allocation_totals a ON a.outbound_id = o.id
            {where} ORDER BY o.out_date DESC, o.id DESC", new { po_no });
        return Ok(rows);
    }

    [HttpGet("available")]
    public async Task<IActionResult> Available()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            WITH receipt_totals AS (
                SELECT po_item_id, SUM(qty) AS received_qty
                FROM po_receipts
                GROUP BY po_item_id
            ),
            outbound_totals AS (
                SELECT po_item_id, SUM(qty) AS total_out
                FROM outbound
                WHERE po_item_id IS NOT NULL
                GROUP BY po_item_id
            )
            SELECT i.id AS po_item_id,
                   i.po_id, po.po_no, po.supplier,
                   i.material_id, i.product_code, i.material_name, i.spec,
                   COALESCE(i.purchase_qty, i.qty, 0) AS purchase_qty,
                   COALESCE(r.received_qty, 0) AS received_qty,
                   COALESCE(o.total_out, 0) AS total_out,
                   GREATEST(COALESCE(r.received_qty, 0) - COALESCE(o.total_out, 0), 0) AS available_qty,
                   i.purchase_unit
            FROM po_items i
            JOIN purchase_orders po ON po.id=i.po_id
            LEFT JOIN receipt_totals r ON r.po_item_id=i.id
            LEFT JOIN outbound_totals o ON o.po_item_id=i.id
            WHERE COALESCE(r.received_qty, 0) > COALESCE(o.total_out, 0)
            ORDER BY po.order_date DESC NULLS LAST, po.po_no, i.id");
        return Ok(rows);
    }

    public class CreateBody
    {
        public int? po_item_id { get; set; }
        public string? po_no { get; set; }
        public int? material_id { get; set; }
        public decimal? qty { get; set; }
        public DateTime? out_date { get; set; }
        public string? notes { get; set; }
    }

    public class BulkOutboundLine
    {
        public int po_item_id { get; set; }
        public decimal? qty { get; set; }
    }

    public class BulkOutboundBody
    {
        public int po_id { get; set; }
        public DateTime? out_date { get; set; }
        public string? notes { get; set; }
        public List<BulkOutboundLine>? items { get; set; }
    }

    private sealed class BulkOutboundStock
    {
        public int PoItemId { get; set; }
        public string PoNo { get; set; } = "";
        public int? MaterialId { get; set; }
        public decimal ReceivedQty { get; set; }
        public decimal OutboundQty { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateBody body)
    {
        var qty = body.qty ?? 0;
        if (body.po_item_id is null) return BadRequest(new { error = "请选择已入库的采购物料" });
        if (qty <= 0) return BadRequest(new { error = "出库数量必须大于 0" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var item = await c.QueryFirstOrDefaultAsync<StockItem>(@"
                SELECT i.id AS ""PoItemId"", po.po_no AS ""PoNo"", i.material_id AS ""MaterialId""
                FROM po_items i
                JOIN purchase_orders po ON po.id=i.po_id
                WHERE i.id=@poItemId
                FOR UPDATE OF i", new { poItemId = body.po_item_id }, tx);
            if (item is null)
            {
                tx.Rollback();
                return NotFound(new { error = "采购物料不存在" });
            }

            var received = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM po_receipts WHERE po_item_id=@poItemId",
                new { poItemId = item.PoItemId }, tx);
            var alreadyOut = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM outbound WHERE po_item_id=@poItemId",
                new { poItemId = item.PoItemId }, tx);
            var available = Math.Max(received - alreadyOut, 0);
            if (qty > available)
            {
                tx.Rollback();
                return BadRequest(new { error = $"本次出库 {qty:0.####} 超过可用库存 {available:0.####}" });
            }

            var id = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO outbound(po_item_id, po_no, material_id, qty, out_date, notes)
                VALUES (@poItemId, @poNo, @materialId, @qty, @outDate, @notes)
                RETURNING id",
                new
                {
                    poItemId = item.PoItemId,
                    poNo = item.PoNo,
                    materialId = item.MaterialId,
                    qty,
                    outDate = body.out_date?.Date ?? DateTime.Today,
                    notes = body.notes?.Trim() ?? ""
                }, tx);
            await this.WriteAsync(c, tx, "outbound", "create", "outbound", id,
                $"新增出库 {qty:0.####}",
                new { id, po_item_id = item.PoItemId, po_no = item.PoNo, qty });
            tx.Commit();
            return Ok(new { ok = true, id, available_qty = available - qty });
        }
        catch { tx.Rollback(); throw; }
    }

    // 同一采购单统一出库：一次提交多项物料，数据库仍保留逐项出库记录，便于库存和装柜精确分配。
    [HttpPost("bulk")]
    public async Task<IActionResult> CreateBulk([FromBody] BulkOutboundBody body)
    {
        var requested = (body.items ?? new())
            .Where(x => x.po_item_id > 0 && (x.qty ?? 0) > 0)
            .GroupBy(x => x.po_item_id)
            .Select(g => new { PoItemId = g.Key, Qty = g.Sum(x => x.qty ?? 0) })
            .ToList();
        if (body.po_id <= 0) return BadRequest(new { error = "请选择采购单" });
        if (requested.Count == 0) return BadRequest(new { error = "请至少填写一项出库数量" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var itemIds = requested.Select(x => x.PoItemId).ToArray();
            // 先单独加行锁，再用新语句读库存汇总：READ COMMITTED 下每条语句取新快照，
            // 锁等待期间其他事务提交的出库才能被 SUM 看到，否则会超发为负库存
            await c.ExecuteAsync(@"
                SELECT i.id FROM po_items i
                WHERE i.po_id=@poId AND i.id = ANY(@itemIds)
                FOR UPDATE", new { poId = body.po_id, itemIds }, tx);
            var stocks = (await c.QueryAsync<BulkOutboundStock>(@"
                SELECT i.id AS ""PoItemId"", po.po_no AS ""PoNo"", i.material_id AS ""MaterialId"",
                       COALESCE((SELECT SUM(r.qty) FROM po_receipts r WHERE r.po_item_id=i.id), 0) AS ""ReceivedQty"",
                       COALESCE((SELECT SUM(o.qty) FROM outbound o WHERE o.po_item_id=i.id), 0) AS ""OutboundQty""
                FROM po_items i
                JOIN purchase_orders po ON po.id=i.po_id
                WHERE i.po_id=@poId AND i.id = ANY(@itemIds)", new { poId = body.po_id, itemIds }, tx)).ToDictionary(x => x.PoItemId);
            if (stocks.Count != requested.Count)
            {
                tx.Rollback();
                return BadRequest(new { error = "提交内容包含不属于该采购单的物料" });
            }

            foreach (var line in requested)
            {
                var stock = stocks[line.PoItemId];
                var available = Math.Max(stock.ReceivedQty - stock.OutboundQty, 0);
                if (line.Qty > available)
                {
                    tx.Rollback();
                    return BadRequest(new
                    {
                        error = $"采购明细 #{line.PoItemId} 本次出库 {line.Qty:0.####} 超过可用库存 {available:0.####}"
                    });
                }
            }

            var outDate = body.out_date?.Date ?? DateTime.Today;
            var notes = body.notes?.Trim() ?? "";
            var ids = new List<int>();
            foreach (var line in requested)
            {
                var stock = stocks[line.PoItemId];
                var id = await c.ExecuteScalarAsync<int>(@"
                    INSERT INTO outbound(po_item_id, po_no, material_id, qty, out_date, notes)
                    VALUES (@poItemId, @poNo, @materialId, @qty, @outDate, @notes)
                    RETURNING id",
                    new { line.PoItemId, stock.PoNo, stock.MaterialId, line.Qty, outDate, notes }, tx);
                ids.Add(id);
            }

            var poNo = stocks.Values.First().PoNo;
            var totalQty = requested.Sum(x => x.Qty);
            await this.WriteAsync(c, tx, "outbound", "bulk_create", "purchase_order", body.po_id,
                $"采购单 {poNo} 统一出库 {requested.Count} 项 / {totalQty:0.####}",
                new { po_id = body.po_id, po_no = poNo, out_date = outDate, items = requested });
            tx.Commit();
            return Ok(new { ok = true, outbound_ids = ids, item_count = requested.Count, qty = totalQty });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] CreateBody body)
    {
        var qty = body.qty ?? 0;
        if (body.po_item_id is null) return BadRequest(new { error = "请选择已入库的采购物料" });
        if (qty <= 0) return BadRequest(new { error = "出库数量必须大于 0" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var current = await c.QueryFirstOrDefaultAsync<(int Id, int? PoItemId)>(
                "SELECT id AS Id, po_item_id AS PoItemId FROM outbound WHERE id=@id FOR UPDATE",
                new { id }, tx);
            if (current.Id == 0)
            {
                tx.Rollback();
                return NotFound(new { error = "出库记录不存在" });
            }
            var allocated = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM shipment_items WHERE outbound_id=@id",
                new { id }, tx);
            if (qty < allocated)
            {
                tx.Rollback();
                return BadRequest(new
                {
                    error = $"该出库已有 {allocated:0.####} 分配到柜，出库数量不能改为 {qty:0.####}"
                });
            }
            if (allocated > 0 && current.PoItemId != body.po_item_id)
            {
                tx.Rollback();
                return Conflict(new { error = "该出库已经分配到柜，不能更换采购物料" });
            }

            var item = await c.QueryFirstOrDefaultAsync<StockItem>(@"
                SELECT i.id AS ""PoItemId"", po.po_no AS ""PoNo"", i.material_id AS ""MaterialId""
                FROM po_items i
                JOIN purchase_orders po ON po.id=i.po_id
                WHERE i.id=@poItemId
                FOR UPDATE OF i", new { poItemId = body.po_item_id }, tx);
            if (item is null)
            {
                tx.Rollback();
                return NotFound(new { error = "采购物料不存在" });
            }

            var received = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM po_receipts WHERE po_item_id=@poItemId",
                new { poItemId = item.PoItemId }, tx);
            var otherOut = await c.ExecuteScalarAsync<decimal>(@"
                SELECT COALESCE(SUM(qty), 0)
                FROM outbound
                WHERE po_item_id=@poItemId AND id<>@id",
                new { poItemId = item.PoItemId, id }, tx);
            var availableForRecord = Math.Max(received - otherOut, 0);
            if (qty > availableForRecord)
            {
                tx.Rollback();
                return BadRequest(new
                {
                    error = $"修改后的出库量 {qty:0.####} 超过该记录可用库存 {availableForRecord:0.####}"
                });
            }

            var n = await c.ExecuteAsync(@"UPDATE outbound SET po_item_id=@poItemId, po_no=@poNo,
                material_id=@materialId, qty=@qty, out_date=@outDate, notes=@notes WHERE id=@id",
                new
                {
                    id,
                    poItemId = item.PoItemId,
                    poNo = item.PoNo,
                    materialId = item.MaterialId,
                    qty,
                    outDate = body.out_date?.Date ?? DateTime.Today,
                    notes = body.notes?.Trim() ?? ""
                }, tx);
            if (n == 0) { tx.Rollback(); return NotFound(new { error = "出库记录不存在" }); }
            await this.WriteAsync(c, tx, "outbound", "update", "outbound", id,
                $"修改出库数量为 {qty:0.####}",
                new { id, po_item_id = item.PoItemId, po_no = item.PoNo, qty, allocated_qty = allocated });
            tx.Commit();
            return Ok(new { ok = true, id, available_qty = availableForRecord - qty });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        var row = await c.QueryFirstOrDefaultAsync<(int Id, string PoNo, decimal Qty)>(@"
            SELECT id AS Id, COALESCE(po_no, '') AS PoNo, COALESCE(qty, 0) AS Qty
            FROM outbound
            WHERE id=@id
            FOR UPDATE", new { id }, tx);
        if (row.Id == 0)
        {
            tx.Rollback();
            return NotFound(new { error = "出库记录不存在" });
        }
        var allocated = await c.ExecuteScalarAsync<decimal>(
            "SELECT COALESCE(SUM(qty), 0) FROM shipment_items WHERE outbound_id=@id",
            new { id }, tx);
        if (allocated > 0)
        {
            tx.Rollback();
            return Conflict(new { error = $"该出库已有 {allocated:0.####} 分配到柜，请先从对应走货单移除" });
        }
        await c.ExecuteAsync("DELETE FROM outbound WHERE id=@id", new { id }, tx);
        await this.WriteAsync(c, tx, "outbound", "delete", "outbound", id,
            $"删除出库 {row.Qty:0.####}", new { id, po_no = row.PoNo, qty = row.Qty });
        tx.Commit();
        return Ok(new { ok = true });
    }

    [HttpGet("summary/by-po")]
    public async Task<IActionResult> SummaryByPo()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT po_no, material_id, SUM(qty) AS total_out
            FROM outbound GROUP BY po_no, material_id");
        return Ok(rows);
    }

    // 每一笔出库的可装柜余额；编辑走货时把本走货原分配量加回，便于重新分配。
    [HttpGet("allocatable")]
    public async Task<IActionResult> Allocatable([FromQuery] int? shipment_id)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            WITH allocations AS (
                SELECT outbound_id,
                       SUM(qty) FILTER (WHERE shipment_id <> COALESCE(@shipmentId, -1)) AS allocated_other,
                       SUM(qty) FILTER (WHERE shipment_id = @shipmentId) AS allocated_current
                FROM shipment_items
                WHERE outbound_id IS NOT NULL
                GROUP BY outbound_id
            )
            SELECT o.id AS outbound_id, o.po_item_id, o.po_no, o.material_id,
                   m.product_code AS code, COALESCE(i.material_name, m.name_zh) AS name_zh,
                   po.supplier, o.out_date, o.notes,
                   COALESCE(o.qty, 0) AS outbound_qty,
                   COALESCE(a.allocated_other, 0) AS allocated_other,
                   COALESCE(a.allocated_current, 0) AS allocated_current,
                   GREATEST(COALESCE(o.qty, 0) - COALESCE(a.allocated_other, 0), 0) AS allocatable_qty,
                   i.price, i.currency, po.order_date AS po_date, m.customs_company
            FROM outbound o
            LEFT JOIN allocations a ON a.outbound_id=o.id
            LEFT JOIN po_items i ON i.id=o.po_item_id
            LEFT JOIN purchase_orders po ON po.id=i.po_id
            LEFT JOIN materials m ON m.id=o.material_id
            WHERE COALESCE(o.qty, 0) > COALESCE(a.allocated_other, 0)
            ORDER BY o.out_date, o.id", new { shipmentId = shipment_id });
        return Ok(rows);
    }

    [HttpGet("ledger")]
    public async Task<IActionResult> Ledger([FromQuery] int? po_item_id)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            WITH movements AS (
                SELECT 'R-' || r.id AS movement_id, r.po_item_id, r.receipt_date AS movement_date,
                       r.created_at, 'receipt' AS movement_type, r.batch_no AS reference_no,
                       r.qty AS in_qty, 0::numeric AS out_qty, r.notes
                FROM po_receipts r
                UNION ALL
                SELECT 'O-' || o.id, o.po_item_id, o.out_date, o.created_at, 'outbound',
                       'OUT-' || o.id, 0::numeric, o.qty, o.notes
                FROM outbound o
                WHERE o.po_item_id IS NOT NULL
            )
            SELECT mv.*, po.po_no, i.product_code,
                   COALESCE(i.material_name, m.name_zh) AS material_name,
                   SUM(mv.in_qty - mv.out_qty) OVER (
                       PARTITION BY mv.po_item_id
                       ORDER BY mv.movement_date, mv.created_at, mv.movement_id
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
            FROM movements mv
            JOIN po_items i ON i.id=mv.po_item_id
            JOIN purchase_orders po ON po.id=i.po_id
            LEFT JOIN materials m ON m.id=i.material_id
            WHERE @poItemId IS NULL OR mv.po_item_id=@poItemId
            ORDER BY mv.movement_date DESC, mv.created_at DESC, mv.movement_id DESC",
            new { poItemId = po_item_id });
        return Ok(rows);
    }

    [HttpGet("audit-logs")]
    public async Task<IActionResult> AuditLogs([FromQuery] int limit = 200)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            SELECT id, occurred_at, username, module, action, entity_type, entity_id,
                   summary, details, ip_address
            FROM audit_logs
            WHERE module IN ('purchase', 'inventory', 'outbound', 'shipments')
            ORDER BY occurred_at DESC, id DESC
            LIMIT @limit", new { limit = Math.Clamp(limit, 1, 1000) });
        return Ok(rows);
    }

    private sealed class StockItem
    {
        public int PoItemId { get; init; }
        public string PoNo { get; init; } = "";
        public int? MaterialId { get; init; }
    }
}
