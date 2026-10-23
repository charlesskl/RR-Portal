using Dapper;
using IndoShipping.Api.Auditing;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

public partial class PurchaseOrdersController
{
    public sealed class UpdateReceiptBody
    {
        public decimal? qty { get; set; }
        public decimal? spare_qty { get; set; }
        public decimal? expected_qty { get; set; }
        public decimal? expected_spare_qty { get; set; }
    }

    private sealed class ReceiptForUpdate
    {
        public int Id { get; set; }
        public int PoItemId { get; set; }
        public int PoId { get; set; }
        public decimal OrderedQty { get; set; }
        public decimal Qty { get; set; }
        public decimal SpareQty { get; set; }
    }

    [HttpPut("receipts/{receiptId:int}")]
    public async Task<IActionResult> UpdateReceipt(int receiptId, [FromBody] UpdateReceiptBody body)
    {
        if (body.qty is null || body.spare_qty is null || body.expected_qty is null || body.expected_spare_qty is null)
            return BadRequest(new { error = "请提供修改前后的入库数量和备品入数" });
        var qty = body.qty.Value;
        var spareQty = body.spare_qty.Value;
        if (qty < 0 || spareQty < 0) return BadRequest(new { error = "入库数量和备品入数不能小于 0" });
        if (qty == 0 && spareQty == 0) return BadRequest(new { error = "入库数量或备品入数至少一项大于 0；取消整条记录请使用删除" });
        if (decimal.Round(qty, 4) != qty || decimal.Round(spareQty, 4) != spareQty
            || qty >= 100000000000000m || spareQty >= 100000000000000m)
            return BadRequest(new { error = "数量最多支持 14 位整数和 4 位小数" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            // 与删除入库使用相同的行锁；采购明细锁也与出库路径互斥。
            var row = await c.QueryFirstOrDefaultAsync<ReceiptForUpdate>(@"
                SELECT r.id AS ""Id"", r.po_item_id AS ""PoItemId"", i.po_id AS ""PoId"",
                       COALESCE(i.purchase_qty, i.qty, 0) AS ""OrderedQty"",
                       r.qty AS ""Qty"", r.spare_qty AS ""SpareQty""
                FROM po_receipts r JOIN po_items i ON i.id=r.po_item_id
                WHERE r.id=@receiptId FOR UPDATE OF r, i", new { receiptId }, tx);
            if (row is null)
            {
                tx.Rollback();
                return NotFound(new { error = "入库记录不存在或已删除，请刷新" });
            }
            if (row.Qty != body.expected_qty || row.SpareQty != body.expected_spare_qty)
            {
                tx.Rollback();
                return Conflict(new { error = "这条入库记录已被修改，请刷新后重新编辑" });
            }
            // 先锁订单再计算整单完成状态，串行化同单不同物料的并发保存。
            await c.ExecuteScalarAsync<int>("SELECT id FROM purchase_orders WHERE id=@PoId FOR UPDATE", new { row.PoId }, tx);
            var other = await c.QuerySingleAsync<(decimal Qty, decimal SpareQty)>(@"
                SELECT COALESCE(SUM(qty),0), COALESCE(SUM(spare_qty),0)
                FROM po_receipts WHERE po_item_id=@PoItemId AND id<>@receiptId",
                new { row.PoItemId, receiptId }, tx);
            var maxQty = Math.Max(row.OrderedQty - other.Qty, 0);
            if (qty > maxQty)
            {
                tx.Rollback();
                return BadRequest(new { error = $"本批入库最多可改为 {maxQty:0.####}，不能超过采购数量" });
            }
            var totalOut = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty),0) FROM outbound WHERE po_item_id=@PoItemId", new { row.PoItemId }, tx);
            var totalReceived = other.Qty + qty;
            var totalSpare = other.SpareQty + spareQty;
            if (totalReceived + totalSpare < totalOut)
            {
                tx.Rollback();
                return Conflict(new { error = $"修改后累计入库（含备品）{totalReceived + totalSpare:0.####} 小于已出库 {totalOut:0.####}，不能修改" });
            }
            await c.ExecuteAsync("UPDATE po_receipts SET qty=@qty, spare_qty=@spareQty WHERE id=@receiptId",
                new { qty, spareQty, receiptId }, tx);
            await c.ExecuteAsync(@"
                UPDATE purchase_orders po
                SET status=CASE WHEN EXISTS (
                    SELECT 1 FROM po_items i WHERE i.po_id=po.id
                      AND COALESCE(i.purchase_qty,i.qty,0) >
                          COALESCE((SELECT SUM(r.qty) FROM po_receipts r WHERE r.po_item_id=i.id),0)
                ) THEN CASE WHEN po.status='received' THEN 'sent' ELSE po.status END
                  ELSE 'received' END
                WHERE po.id=@PoId", new { row.PoId }, tx);
            await this.WriteAsync(c, tx, "inventory", "update_receipt", "po_receipt", receiptId,
                $"修改入库 #{receiptId}：数量 {row.Qty:0.####} → {qty:0.####}，备品 {row.SpareQty:0.####} → {spareQty:0.####}",
                new {
                    receipt_id=receiptId, po_item_id=row.PoItemId, po_id=row.PoId,
                    before=new { qty=row.Qty, spare_qty=row.SpareQty },
                    after=new { qty, spare_qty=spareQty },
                });
            tx.Commit();
            return Ok(new { ok=true, received_qty=totalReceived, spare_qty=totalSpare,
                shortage_qty=Math.Max(row.OrderedQty-totalReceived,0) });
        }
        catch { tx.Rollback(); throw; }
    }
}
