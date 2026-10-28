namespace IndoShipping.Api.Features.Bootstrap;

public static class PurchasePricePrecision
{
    // Widen only legacy columns. Shipment rows retain the original PO-unit price.
    // Preserve custom schemas with higher precision.
    // Both definitions retain 14 integer digits; existing values are unchanged.
    public const string SchemaSql = """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid=to_regclass('po_items') AND attname='price'
                  AND format_type(atttypid, atttypmod)='numeric(18,4)') THEN
                ALTER TABLE po_items ALTER COLUMN price TYPE NUMERIC(22,8);
            END IF;
            IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid=to_regclass('shipment_items') AND attname='price'
                  AND format_type(atttypid, atttypmod)='numeric(18,4)') THEN
                ALTER TABLE shipment_items ALTER COLUMN price TYPE NUMERIC(22,8);
            END IF;
        END $$;
        """;
}
