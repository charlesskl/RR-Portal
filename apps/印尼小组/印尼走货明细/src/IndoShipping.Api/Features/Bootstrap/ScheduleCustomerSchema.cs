namespace IndoShipping.Api.Features.Bootstrap;

public static class ScheduleCustomerSchema
{
    // Do not rewrite raw_rows: historical completion hashes and line IDs depend on them.
    public const string SchemaSql = """
        ALTER TABLE schedules ADD COLUMN IF NOT EXISTS customer TEXT NOT NULL DEFAULT 'TOMY';
        DO $$
        DECLARE entry record;
        BEGIN
            FOR entry IN
                SELECT conname FROM pg_constraint
                WHERE conrelid='schedules'::regclass AND contype='u'
                  AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
                    WHERE attrelid='schedules'::regclass AND attname='week_label')]::smallint[]
            LOOP
                EXECUTE format('ALTER TABLE schedules DROP CONSTRAINT %I',entry.conname);
            END LOOP;
            FOR entry IN
                SELECT indexrelid::regclass AS index_name FROM pg_index
                WHERE indrelid='schedules'::regclass AND indisunique AND indnatts=1
                  AND indkey[0]=(SELECT attnum FROM pg_attribute
                    WHERE attrelid='schedules'::regclass AND attname='week_label')
            LOOP
                EXECUTE format('DROP INDEX %s',entry.index_name);
            END LOOP;
        END $$;
        CREATE UNIQUE INDEX IF NOT EXISTS ix_schedules_customer_week
            ON schedules(customer,week_label);
        """;
}
