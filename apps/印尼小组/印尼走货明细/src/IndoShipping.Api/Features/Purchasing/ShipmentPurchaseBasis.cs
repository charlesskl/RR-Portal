namespace IndoShipping.Api.Features.Purchasing;

public static class ShipmentPurchaseBasis
{
    // Keep the legacy ratio for older clients. New clients consume paid stock
    // first, using the remaining paid quantity for this PO line and shipment.
    public const string ReceiptBasisSql = @"
        SELECT po_item_id, SUM(qty) AS purchase_paid_qty, SUM(qty + spare_qty) AS purchase_received_qty,
               CASE WHEN SUM(qty + spare_qty) > 0
                    THEN SUM(qty) / SUM(qty + spare_qty)
                    ELSE 1 END AS purchase_charge_ratio
        FROM po_receipts GROUP BY po_item_id";

    // A paid unit can belong to only one container. Earlier containers consume
    // paid stock first; later allocations beyond that receipt quantity are free.
    // Unlinked imported declaration prices already include their source amount
    // and do not consume this derived outbound/purchase allocation basis.
    public const string AllocationsSql = @"
        SELECT si.id, si.shipment_id, si.xmin::text AS row_version,
               COALESCE(o.po_item_id, matched.id) AS po_item_id,
               GREATEST(COALESCE(si.qty, 0), 0) AS qty
        FROM shipment_items si
        LEFT JOIN outbound o ON o.id=si.outbound_id
        LEFT JOIN LATERAL (
            SELECT MIN(p.id) AS id FROM po_items p
            JOIN purchase_orders po ON po.id=p.po_id
            WHERE si.outbound_id IS NULL AND p.material_id=si.material_id AND po.po_no=si.po_no
            HAVING COUNT(*)=1
        ) matched ON TRUE
        WHERE si.outbound_id IS NOT NULL OR si.material_snapshot IS NULL";
}
