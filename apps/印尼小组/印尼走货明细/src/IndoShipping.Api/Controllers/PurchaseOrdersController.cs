using System.Text.Json;
using Dapper;
using IndoShipping.Api.Auditing;
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
        var raw = await c.ExecuteScalarAsync<string?>("SELECT value FROM settings WHERE \"key\"='purchaseOrders'");
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
            SELECT DISTINCT tomy_po, product_code FROM po_items
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
                   SUM(COALESCE(price,0) * COALESCE(NULLIF(usage_qty,0),1)) AS cost,
                   MAX(currency) AS currency
            FROM po_items
            WHERE product_code IS NOT NULL AND product_code <> ''
            GROUP BY product_code");
        return Ok(rows);
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            WITH receipt_totals AS (
                SELECT po_item_id, SUM(qty) AS received_qty
                FROM po_receipts
                GROUP BY po_item_id
            ),
            item_stats AS (
                SELECT i.po_id,
                       COUNT(i.id) AS item_count,
                       SUM(COALESCE(i.purchase_qty, i.qty, 0) * COALESCE(i.price, 0)) AS total_amount,
                       SUM(COALESCE(i.purchase_qty, i.qty, 0)) AS purchase_qty,
                       SUM(COALESCE(r.received_qty, 0)) AS received_qty
                FROM po_items i
                LEFT JOIN receipt_totals r ON r.po_item_id = i.id
                GROUP BY i.po_id
            )
            SELECT po.*,
                   COALESCE(s.item_count, 0) AS item_count,
                   COALESCE(s.total_amount, 0) AS total_amount,
                   COALESCE(s.received_qty, 0) AS received_qty,
                   GREATEST(COALESCE(s.purchase_qty, 0) - COALESCE(s.received_qty, 0), 0) AS shortage_qty
            FROM purchase_orders po
            LEFT JOIN item_stats s ON s.po_id = po.id
            ORDER BY po.created_at DESC");
        return Ok(rows);
    }

    [HttpGet("items")]
    public async Task<IActionResult> ListItems()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
            WITH receipt_totals AS (
                SELECT po_item_id,
                       SUM(qty) AS received_qty,
                       STRING_AGG(
                           TO_CHAR(receipt_date, 'MM/DD') || '入库' ||
                           TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM qty::text)) ||
                           CASE WHEN COALESCE(batch_no, '') = '' THEN '' ELSE ' [' || batch_no || ']' END,
                           '，' ORDER BY receipt_date, id
                       ) AS receipt_summary
                FROM po_receipts
                GROUP BY po_item_id
            )
            SELECT i.*,
                   po.po_no, po.supplier, po.status, po.order_date, po.delivery_date,
                   po.notes AS po_notes,
                   COALESCE(r.received_qty, 0) AS received_qty,
                   GREATEST(COALESCE(i.purchase_qty, i.qty, 0) - COALESCE(r.received_qty, 0), 0) AS shortage_qty,
                   COALESCE(r.receipt_summary, '') AS receipt_summary
            FROM po_items i
            JOIN purchase_orders po ON po.id = i.po_id
            LEFT JOIN receipt_totals r ON r.po_item_id = i.id
            ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC, i.id");
        return Ok(rows);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        using var c = factory.Create();
        var po = await c.QueryFirstOrDefaultAsync("SELECT * FROM purchase_orders WHERE id=@id", new { id });
        if (po == null) return NotFound(new { error = "not found" });
        var items = (await c.QueryAsync(@"
            WITH receipt_totals AS (
                SELECT po_item_id, SUM(qty) AS received_qty
                FROM po_receipts
                GROUP BY po_item_id
            )
            SELECT i.*,
                   COALESCE(r.received_qty, 0) AS received_qty,
                   GREATEST(COALESCE(i.purchase_qty, i.qty, 0) - COALESCE(r.received_qty, 0), 0) AS shortage_qty
            FROM po_items i
            LEFT JOIN receipt_totals r ON r.po_item_id = i.id
            WHERE i.po_id=@id
            ORDER BY i.id", new { id })).ToList();
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
        public int? id { get; set; }
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
INSERT INTO purchase_orders(po_no, supplier, status, order_date, delivery_date, notes)
VALUES (@po_no, @supplier, @status, @order_date, @delivery_date, @notes)
RETURNING id",
                new { po_no = body.po_no ?? "", supplier = body.supplier ?? "",
                      status = body.status ?? "draft", order_date = body.order_date,
                      delivery_date = body.delivery_date, notes = body.notes ?? "" }, tx);
            foreach (var it in body.items ?? new())
            {
                await c.ExecuteAsync(@"
INSERT INTO po_items(po_id, product_code, material_id, material_name, qty, price, currency, notes,
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
            await this.WriteAsync(c, tx, "purchase", "create", "purchase_order", id,
                $"新建采购单 {body.po_no ?? ""}",
                new { id, body.po_no, body.supplier, item_count = body.items?.Count ?? 0 });
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
            var n = await c.ExecuteAsync(@"UPDATE purchase_orders SET po_no=@po_no, supplier=@supplier,
                status=@status, order_date=@order_date, delivery_date=@delivery_date, notes=@notes WHERE id=@id",
                new { id, po_no = body.po_no ?? "", supplier = body.supplier ?? "",
                      status = body.status ?? "draft", order_date = body.order_date,
                      delivery_date = body.delivery_date, notes = body.notes ?? "" }, tx);
            if (n == 0) { tx.Rollback(); return NotFound(new { error = "采购单不存在" }); }
            var existingIds = (await c.QueryAsync<int>(
                "SELECT id FROM po_items WHERE po_id=@id FOR UPDATE", new { id }, tx)).ToHashSet();
            var keptIds = new List<int>();
            foreach (var it in body.items ?? new())
            {
                if (it.id is int itemId && existingIds.Contains(itemId))
                {
                    await c.ExecuteAsync(@"
UPDATE po_items
SET product_code=@pc, material_id=@mid, material_name=@mname, qty=@qty, price=@price,
    currency=@cur, notes=@notes, category=@cat, spec=@spec, usage_qty=@usage_qty,
    ordered_qty=@ordered_qty, material_qty=@material_qty, spoilage_qty=@spoilage_qty,
    purchase_qty=@purchase_qty, purchase_unit=@purchase_unit, ship_unit=@ship_unit,
    net_per_pc=@net_per_pc, eta=@eta, tomy_po=@tomy_po
WHERE id=@itemId AND po_id=@id",
                        ItemParameters(id, itemId, it), tx);
                    keptIds.Add(itemId);
                    continue;
                }

                var newItemId = await c.ExecuteScalarAsync<int>(@"
INSERT INTO po_items(po_id, product_code, material_id, material_name, qty, price, currency, notes,
                         category, spec, usage_qty, ordered_qty, material_qty, spoilage_qty, purchase_qty, purchase_unit,
                         ship_unit, net_per_pc, eta, tomy_po)
VALUES (@id, @pc, @mid, @mname, @qty, @price, @cur, @notes,
        @cat, @spec, @usage_qty, @ordered_qty, @material_qty, @spoilage_qty, @purchase_qty, @purchase_unit,
        @ship_unit, @net_per_pc, @eta, @tomy_po)
RETURNING id",
                    ItemParameters(id, null, it), tx);
                keptIds.Add(newItemId);
            }
            if (keptIds.Count == 0)
            {
                // 整单清空等同删除全部明细，同样要挡住已有入库/出库的情况
                var linkedAll = await c.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM (
                      SELECT r.po_item_id FROM po_receipts r JOIN po_items i ON i.id=r.po_item_id WHERE i.po_id=@id
                      UNION ALL
                      SELECT o.po_item_id FROM outbound o JOIN po_items i ON i.id=o.po_item_id WHERE i.po_id=@id
                    ) t", new { id }, tx);
                if (linkedAll > 0)
                {
                    tx.Rollback();
                    return Conflict(new { error = "采购单明细已有入库/出库记录，不能清空删除" });
                }
                await c.ExecuteAsync("DELETE FROM po_items WHERE po_id=@id", new { id }, tx);
            }
            else
            {
                var removedIds = existingIds.Where(x => !keptIds.Contains(x)).ToList();
                if (removedIds.Count > 0)
                {
                    var linked = await c.ExecuteScalarAsync<int>(@"
                        SELECT COUNT(*) FROM (
                          SELECT r.po_item_id FROM po_receipts r WHERE r.po_item_id = ANY(@ids)
                          UNION ALL
                          SELECT o.po_item_id FROM outbound o WHERE o.po_item_id = ANY(@ids)
                        ) t", new { ids = removedIds.ToArray() }, tx);
                    if (linked > 0)
                    {
                        tx.Rollback();
                        return Conflict(new { error = "部分明细已有入库/出库记录，不能从采购单删除，请先处理对应记录" });
                    }
                }
                await c.ExecuteAsync(
                    "DELETE FROM po_items WHERE po_id=@id AND NOT (id = ANY(@keptIds))",
                    new { id, keptIds = keptIds.ToArray() }, tx);
            }
            await this.WriteAsync(c, tx, "purchase", "update", "purchase_order", id,
                $"修改采购单 {body.po_no ?? ""}",
                new { id, body.po_no, body.supplier, item_count = keptIds.Count });
            tx.Commit();
            return Ok(new { ok = true, id });
        }
        catch { tx.Rollback(); throw; }
    }

    private static object ItemParameters(int poId, int? itemId, PoItemBody it) => new
    {
        id = poId,
        itemId,
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
    };

    public class ReceiptBody
    {
        public DateTime? receipt_date { get; set; }
        public decimal? qty { get; set; }
        public string? batch_no { get; set; }
        public string? notes { get; set; }
    }

    public class BulkReceiptLine
    {
        public int po_item_id { get; set; }
        public decimal? qty { get; set; }
    }

    public class BulkReceiptBody
    {
        public DateTime? receipt_date { get; set; }
        public string? batch_no { get; set; }
        public string? notes { get; set; }
        public List<BulkReceiptLine>? items { get; set; }
    }

    private sealed class BulkReceiptStock
    {
        public int PoItemId { get; set; }
        public decimal OrderedQty { get; set; }
        public decimal ReceivedQty { get; set; }
    }

    // 同一采购单统一入库：一次提交多项物料，但仍逐项写入库存流水，保证欠数可精确追踪。
    [HttpPost("{poId:int}/receipts/bulk")]
    public async Task<IActionResult> CreateBulkReceipt(int poId, [FromBody] BulkReceiptBody body)
    {
        var requested = (body.items ?? new())
            .Where(x => x.po_item_id > 0 && (x.qty ?? 0) > 0)
            .GroupBy(x => x.po_item_id)
            .Select(g => new { PoItemId = g.Key, Qty = g.Sum(x => x.qty ?? 0) })
            .ToList();
        if (requested.Count == 0) return BadRequest(new { error = "请至少填写一项入库数量" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var itemIds = requested.Select(x => x.PoItemId).ToArray();
            // 锁序与单条入库路径保持一致（po_items -> purchase_orders），避免 ABBA 死锁
            await c.ExecuteAsync(@"
                SELECT i.id FROM po_items i
                WHERE i.po_id=@poId AND i.id = ANY(@itemIds)
                FOR UPDATE", new { poId, itemIds }, tx);
            var poNo = await c.ExecuteScalarAsync<string?>(
                "SELECT po_no FROM purchase_orders WHERE id=@poId FOR UPDATE", new { poId }, tx);
            if (poNo is null)
            {
                tx.Rollback();
                return NotFound(new { error = "采购单不存在" });
            }

            var stocks = (await c.QueryAsync<BulkReceiptStock>(@"
                SELECT i.id AS ""PoItemId"",
                       COALESCE(i.purchase_qty, i.qty, 0) AS ""OrderedQty"",
                       COALESCE((SELECT SUM(r.qty) FROM po_receipts r WHERE r.po_item_id=i.id), 0) AS ""ReceivedQty""
                FROM po_items i
                WHERE i.po_id=@poId AND i.id = ANY(@itemIds)", new { poId, itemIds }, tx)).ToDictionary(x => x.PoItemId);
            if (stocks.Count != requested.Count)
            {
                tx.Rollback();
                return BadRequest(new { error = "提交内容包含不属于该采购单的物料" });
            }

            foreach (var line in requested)
            {
                var stock = stocks[line.PoItemId];
                var shortage = Math.Max(stock.OrderedQty - stock.ReceivedQty, 0);
                if (line.Qty > shortage)
                {
                    tx.Rollback();
                    return BadRequest(new
                    {
                        error = $"采购明细 #{line.PoItemId} 本批入库 {line.Qty:0.####} 超过欠数 {shortage:0.####}"
                    });
                }
            }

            var receiptDate = body.receipt_date?.Date ?? DateTime.Today;
            var batchNo = body.batch_no?.Trim() ?? "";
            var notes = body.notes?.Trim() ?? "";
            var ids = new List<int>();
            foreach (var line in requested)
            {
                var receiptId = await c.ExecuteScalarAsync<int>(@"
                    INSERT INTO po_receipts(po_item_id, receipt_date, qty, batch_no, notes)
                    VALUES (@poItemId, @receiptDate, @qty, @batchNo, @notes)
                    RETURNING id",
                    new { line.PoItemId, receiptDate, line.Qty, batchNo, notes }, tx);
                ids.Add(receiptId);
            }

            await c.ExecuteAsync(@"
                UPDATE purchase_orders po
                SET status='received'
                WHERE po.id=@poId
                  AND NOT EXISTS (
                      SELECT 1
                      FROM po_items i
                      LEFT JOIN (
                          SELECT po_item_id, SUM(qty) AS received_qty
                          FROM po_receipts GROUP BY po_item_id
                      ) r ON r.po_item_id=i.id
                      WHERE i.po_id=po.id
                        AND COALESCE(i.purchase_qty, i.qty, 0) > COALESCE(r.received_qty, 0)
                  )", new { poId }, tx);

            var totalQty = requested.Sum(x => x.Qty);
            await this.WriteAsync(c, tx, "inventory", "bulk_receipt", "purchase_order", poId,
                $"采购单 {poNo} 统一入库 {requested.Count} 项 / {totalQty:0.####}",
                new { po_id = poId, po_no = poNo, receipt_date = receiptDate, batch_no = batchNo, items = requested });
            tx.Commit();
            return Ok(new { ok = true, receipt_ids = ids, item_count = requested.Count, qty = totalQty });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpGet("items/{itemId:int}/receipts")]
    public async Task<IActionResult> ListReceipts(int itemId)
    {
        using var c = factory.Create();
        var exists = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM po_items WHERE id=@itemId", new { itemId });
        if (exists == 0) return NotFound(new { error = "采购明细不存在" });
        var rows = await c.QueryAsync(@"
            SELECT id, po_item_id, receipt_date, qty, batch_no, notes, created_at
            FROM po_receipts
            WHERE po_item_id=@itemId
            ORDER BY receipt_date, id", new { itemId });
        return Ok(rows);
    }

    [HttpPost("items/{itemId:int}/receipts")]
    public async Task<IActionResult> CreateReceipt(int itemId, [FromBody] ReceiptBody body)
    {
        var receiptQty = body.qty ?? 0;
        if (receiptQty <= 0) return BadRequest(new { error = "入库数量必须大于 0" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var item = await c.QueryFirstOrDefaultAsync<(int PoId, decimal OrderedQty)>(@"
                SELECT po_id AS PoId, COALESCE(purchase_qty, qty, 0) AS OrderedQty
                FROM po_items
                WHERE id=@itemId
                FOR UPDATE", new { itemId }, tx);
            if (item.PoId == 0)
            {
                tx.Rollback();
                return NotFound(new { error = "采购明细不存在" });
            }

            var receivedQty = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM po_receipts WHERE po_item_id=@itemId",
                new { itemId }, tx);
            var shortageQty = Math.Max(item.OrderedQty - receivedQty, 0);
            if (receiptQty > shortageQty)
            {
                tx.Rollback();
                return BadRequest(new
                {
                    error = $"本次入库 {receiptQty:0.####} 超过当前欠数 {shortageQty:0.####}"
                });
            }

            var receiptId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO po_receipts(po_item_id, receipt_date, qty, batch_no, notes)
                VALUES (@itemId, @receiptDate, @qty, @batchNo, @notes)
                RETURNING id",
                new
                {
                    itemId,
                    receiptDate = body.receipt_date?.Date ?? DateTime.Today,
                    qty = receiptQty,
                    batchNo = body.batch_no?.Trim() ?? "",
                    notes = body.notes?.Trim() ?? ""
                }, tx);

            var remaining = shortageQty - receiptQty;
            if (remaining <= 0)
            {
                await c.ExecuteAsync(@"
                    UPDATE purchase_orders po
                    SET status='received'
                    WHERE po.id=@poId
                      AND NOT EXISTS (
                          SELECT 1
                          FROM po_items i
                          LEFT JOIN (
                              SELECT po_item_id, SUM(qty) AS received_qty
                              FROM po_receipts
                              GROUP BY po_item_id
                          ) r ON r.po_item_id=i.id
                          WHERE i.po_id=po.id
                            AND COALESCE(i.purchase_qty, i.qty, 0) > COALESCE(r.received_qty, 0)
                      )", new { poId = item.PoId }, tx);
            }

            await this.WriteAsync(c, tx, "inventory", "receipt", "po_receipt", receiptId,
                $"采购明细 #{itemId} 入库 {receiptQty:0.####}",
                new
                {
                    receipt_id = receiptId,
                    po_item_id = itemId,
                    po_id = item.PoId,
                    qty = receiptQty,
                    receipt_date = body.receipt_date?.Date ?? DateTime.Today,
                    batch_no = body.batch_no?.Trim() ?? "",
                    shortage_qty = remaining
                });
            tx.Commit();
            return Ok(new { ok = true, id = receiptId, shortage_qty = remaining });
        }
        catch { tx.Rollback(); throw; }
    }

    [HttpDelete("receipts/{receiptId:int}")]
    public async Task<IActionResult> DeleteReceipt(int receiptId)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        var row = await c.QueryFirstOrDefaultAsync<(int PoId, int ReceiptId, int PoItemId, decimal Qty)>(@"
            SELECT i.po_id AS PoId, r.id AS ReceiptId, r.po_item_id AS PoItemId, r.qty AS Qty
            FROM po_receipts r
            JOIN po_items i ON i.id=r.po_item_id
            WHERE r.id=@receiptId
            FOR UPDATE OF r, i", new { receiptId }, tx);
        if (row.ReceiptId == 0)
        {
            tx.Rollback();
            return NotFound(new { error = "入库记录不存在" });
        }
        var totalOut = await c.ExecuteScalarAsync<decimal>(
            "SELECT COALESCE(SUM(qty), 0) FROM outbound WHERE po_item_id=@poItemId",
            new { row.PoItemId }, tx);
        var receivedAfterDelete = await c.ExecuteScalarAsync<decimal>(
            "SELECT COALESCE(SUM(qty), 0) - @qty FROM po_receipts WHERE po_item_id=@poItemId",
            new { row.PoItemId, qty = row.Qty }, tx);
        if (receivedAfterDelete < totalOut)
        {
            tx.Rollback();
            return Conflict(new
            {
                error = $"删除后累计入库 {receivedAfterDelete:0.####} 将小于累计出库 {totalOut:0.####}，请先处理出库记录"
            });
        }
        await c.ExecuteAsync("DELETE FROM po_receipts WHERE id=@receiptId", new { receiptId }, tx);
        await c.ExecuteAsync(
            "UPDATE purchase_orders SET status='sent' WHERE id=@poId AND status='received'",
            new { poId = row.PoId }, tx);
        await this.WriteAsync(c, tx, "inventory", "delete_receipt", "po_receipt", receiptId,
            $"删除入库 {row.Qty:0.####}",
            new { receipt_id = receiptId, po_item_id = row.PoItemId, po_id = row.PoId, qty = row.Qty });
        tx.Commit();
        return Ok(new { ok = true });
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
        c.Open();
        using var tx = c.BeginTransaction();
        var sets = string.Join(",", cols.Select(k => $"{k}=@{k}"));
        var dyn = new DynamicParameters();
        foreach (var k in cols) dyn.Add(k, ParamValues.Normalize(body[k]));
        dyn.Add("id", id);
        var n = await c.ExecuteAsync($"UPDATE purchase_orders SET {sets} WHERE id=@id", dyn, tx);
        if (n == 0)
        {
            tx.Rollback();
            return NotFound(new { error = "采购单不存在" });
        }
        await this.WriteAsync(c, tx, "purchase", "patch", "purchase_order", id,
            $"修改采购单字段：{string.Join("、", cols)}", new { id, fields = cols });
        tx.Commit();
        return Ok(new { ok = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        var poNo = await c.ExecuteScalarAsync<string?>(
            "SELECT po_no FROM purchase_orders WHERE id=@id FOR UPDATE", new { id }, tx);
        if (poNo is null)
        {
            tx.Rollback();
            return NotFound(new { error = "采购单不存在" });
        }
        // 与入库/出库的写路径同一把锁（po_items 行），防止检查与删除之间被并发写入
        await c.ExecuteAsync("SELECT id FROM po_items WHERE po_id=@id FOR UPDATE", new { id }, tx);
        var linked = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM (
              SELECT r.po_item_id FROM po_receipts r JOIN po_items i ON i.id=r.po_item_id WHERE i.po_id=@id
              UNION ALL
              SELECT o.po_item_id FROM outbound o JOIN po_items i ON i.id=o.po_item_id WHERE i.po_id=@id
            ) t", new { id }, tx);
        if (linked > 0)
        {
            tx.Rollback();
            return Conflict(new { error = "采购单已有入库/出库记录，不能删除，请先处理对应记录" });
        }
        var n = await c.ExecuteAsync("DELETE FROM purchase_orders WHERE id=@id", new { id }, tx);
        if (n == 0)
        {
            tx.Rollback();
            return NotFound(new { error = "采购单不存在" });
        }
        await this.WriteAsync(c, tx, "purchase", "delete", "purchase_order", id,
            $"删除采购单 {poNo ?? ""}", new { id, po_no = poNo });
        tx.Commit();
        return Ok(new { ok = true });
    }
}
