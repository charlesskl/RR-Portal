namespace IndoShipping.Api.Features.Bootstrap;

public static class PurchaseReceiptQuantitySchema
{
    // Preserve every previously valid qty > 0 row; additionally allow positive spares
    // with qty = 0. Add the replacement before dropping the old check, atomically.
    public const string SchemaSql = """
        DO $$
        BEGIN
            LOCK TABLE po_receipts IN ACCESS EXCLUSIVE MODE;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid='po_receipts'::regclass
                  AND conname='CK_po_receipts_qty_or_spare_positive') THEN
                ALTER TABLE po_receipts
                    ADD CONSTRAINT "CK_po_receipts_qty_or_spare_positive"
                    CHECK (qty > 0 OR (qty = 0 AND spare_qty > 0));
            END IF;
            ALTER TABLE po_receipts DROP CONSTRAINT IF EXISTS "CK_po_receipts_qty_positive";
        END $$;
        """;
}
