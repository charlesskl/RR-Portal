namespace IndoShipping.Api.Features.Purchasing;

public static class ShipmentPurchaseBasis
{
    // Outbound batches do not distinguish paid stock from free spares. Spread
    // the receipt's paid fraction across allocations; physical qty/kg stay intact.
    // Derive on read so existing shipments and corrected receipts need no backfill.
    public const string ReceiptBasisSql = @"
        SELECT po_item_id,
               CASE WHEN SUM(qty + spare_qty) > 0
                    THEN SUM(qty) / SUM(qty + spare_qty)
                    ELSE 1 END AS purchase_charge_ratio
        FROM po_receipts GROUP BY po_item_id";
}
